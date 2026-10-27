import { useEffect, useState } from "react";
import { Play, Square, FileText, ArrowDownToLine, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api";
import "./duration-tests.css";

type Model = { id: string; name: string; model: string; base_url: string; demo: boolean };
type Context = { id: string; name: string; content: string };
type Saved = { id: string; name: string };
type Guard = { result?: string | null; attempts?: number | null; version?: string; policy?: string };
type Row = { index: number; lane: number; status: string; started_at: string; e2e_s: number | null; tokens_per_s?: number | null; output_tokens: number | null; http_status?: number; guard?: Guard; empty_answer?: boolean; error?: string; text?: string; reasoning?: string };
type Summary = { total: number; completed: number; failed: number; cancelled: number; active: number; guard_pass: number; guard_other: number; guard_missing: number; retried: number; attempts_unknown: number; empty: number; all_success: boolean; all_guard_pass: boolean };
type Run = { id: string; name: string; status: string; created_at: string; config: { concurrency: number; duration_s: number; interval_s: number; demo: boolean; timeout: number; request_payload: object }; summary: Summary; elapsed_s: number; requests: Row[]; warnings: string[]; models: Model[]; offset: number; limit: number };
type Past = { id: string; name: string; created_at: string; status: string; summary: Summary };
const labels: Record<string, string> = { running: "Çalışıyor", stopping: "Durduruluyor", completed: "Tamamlandı", partial: "Hatalı istek var", failed: "Başarısız", cancelled: "Durduruldu", interrupted: "Kesintiye uğradı" };
const isActive = (r: Run | null) => !!r && ["running", "stopping", "queued"].includes(r.status);
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

function RequestItem({ row, id }: { row: Row; id: string }) {
  const [detail, setDetail] = useState<Row | null>(null);
  const [error, setError] = useState("");
  async function load(open: boolean) {
    if (!open) return;
    try { setDetail(await api<Row>(`/duration-runs/${id}/requests/${row.index}`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  const g = row.guard;
  return <details className="duration-request" onToggle={e => load(e.currentTarget.open)}>
    <summary>
      <span className="duration-request-id"><b>İstek {row.index + 1}</b><small>Paralel döngü {row.lane} · {new Date(row.started_at).toLocaleTimeString("tr-TR")}</small></span>
      <span className="duration-request-metrics"><b>{number(row.e2e_s)} sn</b><span>{number(row.tokens_per_s)} token/sn</span></span>
      <span className="duration-request-checks"><span className={`status ${row.status}`}>{labels[row.status] || row.status}{row.http_status && ` · HTTP ${row.http_status}`}</span><span className={`status ${g?.result === "pass" ? "completed" : g?.result ? "failed" : "partial"}`}>Guard: {g?.result || "bilinmiyor"}</span><span className={`status ${g?.attempts != null && g.attempts > 1 ? "partial" : ""}`}>Attempts: {g?.attempts ?? "—"}{g?.attempts != null && g.attempts > 1 && " · tekrar denendi"}</span></span>
    </summary>
    <div className="duration-request-body">
      {row.error && <p className="error-message">{row.error}</p>}
      {row.empty_answer && <p className="error-message">Kullanıcı cevabı boş; reasoning tek başına başarılı cevap sayılmaz.</p>}
      <p>Guard sürümü: {g?.version || "—"} · Politika: {g?.policy || "—"} · Çıktı: {row.output_tokens ?? "—"} token</p>
      {error ? <p role="alert">{error}</p> : detail ? <><pre>{detail.text || (row.status === "running" ? "Yanıt devam ediyor; güncel metin için detayı kapatıp açabilirsiniz." : "Cevap metni alınmadı.")}</pre>{detail.reasoning && <details><summary>Reasoning metnini göster</summary><pre>{detail.reasoning}</pre></details>}</> : <p>Yanıt yükleniyor…</p>}
    </div>
  </details>;
}

export function DurationTests({ models, contexts, savedInputs, onSettings }: { models: Model[]; contexts: Context[]; savedInputs: Saved[]; onSettings: () => void }) {
  const [modelId, setModelId] = useState(models.find(m => !m.demo)?.id || models[0]?.id || "");
  const [concurrency, setConcurrency] = useState(1);
  const [duration, setDuration] = useState(60);
  const [interval, setIntervalValue] = useState(1);
  const [timeout, setTimeoutValue] = useState(150);
  const [demo, setDemo] = useState(true);
  const [inputMode, setInputMode] = useState("prompt");
  const [prompt, setPrompt] = useState("Selam, tek cümleyle yanıtla.");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [stream, setStream] = useState(true);
  const [raw, setRaw] = useState(JSON.stringify({ messages: [{ role: "user", content: "Selam, tek cümleyle yanıtla." }], stream: true, stream_options: { include_usage: true }, max_tokens: 1024, chat_template_kwargs: { enable_thinking: true, reasoning_effort: "medium" } }, null, 2));
  const [preview, setPreview] = useState<{ payload: Record<string, unknown>; url: string | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [past, setPast] = useState<Past[]>([]);
  const [offset, setOffset] = useState(0);
  const model = models.find(m => m.id === modelId);
  const running = isActive(run);
  const locked = busy || running;

  useEffect(() => { if (!modelId && models.length) setModelId(models.find(m => !m.demo)?.id || models[0].id); }, [models, modelId]);

  async function refreshPast() { setPast(await api<Past[]>("/duration-runs")); }
  useEffect(() => {
    let cancelled = false;
    api<Past[]>("/duration-runs").then(async items => {
      if (cancelled) return;
      setPast(items);
      const id = sessionStorage.getItem("duration_run") || items.find(i => ["running", "stopping"].includes(i.status))?.id;
      if (id) { const next = await api<Run>(`/duration-runs/${id}`); if (!cancelled) setRun(next); }
    }).catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Run>(`/duration-runs/${run!.id}?offset=${offset}`);
        if (cancelled) return;
        setRun(next);
        if (isActive(next)) timer = setTimeout(poll, 500);
        else await refreshPast();
      } catch (e) { if (!cancelled) { setError((e as Error).message); if (running) timer = setTimeout(poll, 1500); } }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [run?.id, offset, running]);

  async function importInput() {
    setBusy(true); setError("");
    try {
      const parsed = await api<{ payload: Record<string, unknown>; url: string | null; timeout: number | null }>("/request-input", "POST", { text: raw });
      setPreview(parsed);
      const matching = models.find(m => m.model === parsed.payload.model && !m.demo);
      if (matching) setModelId(matching.id);
      if (parsed.timeout != null && parsed.timeout >= 1 && parsed.timeout <= 600) setTimeoutValue(parsed.timeout);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function useSaved(source: string) {
    setError("");
    try {
      if (source.startsWith("context:")) setPrompt(contexts.find(c => c.id === source.slice(8))?.content || "");
      else if (source) { setBusy(true); const item = await api<{ content: string }>(`/inputs/${source}`); setPrompt(item.content); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError("");
    try {
      const payload = inputMode === "prompt" ? { messages: [{ role: "user", content: prompt }], stream, max_tokens: maxTokens } : preview?.payload;
      if (!payload) throw new Error("Önce JSON/curl gövdesini doğrulayın.");
      const next = await api<Run>("/duration-runs", "POST", { model_id: modelId, concurrency, duration_s: duration, interval_s: interval, timeout, demo, payload });
      setOffset(0); setRun(next); sessionStorage.setItem("duration_run", next.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!run) return;
    setBusy(true); setError("");
    try { await api(`/duration-runs/${run.id}/stop`, "POST", {}); setRun(await api<Run>(`/duration-runs/${run.id}?offset=${offset}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setError("");
    try { setOffset(0); setRun(await api<Run>(`/duration-runs/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }
  return <div className="duration-page">
    <section className="duration-setup panel">
      <div className="duration-intro"><h2>İsteği tekrar gönder, her sonucu kontrol et</h2><p>{concurrency} bağımsız döngü aynı modele istek gönderir. Her döngü kendi cevabını aldıktan sonra {interval} sn bekler. {duration} sn dolunca yeni istek başlamaz; devam edenler sonuçlanır veya {timeout} sn zaman aşımına uğrar. Eşzamanlılık hiçbir anda {concurrency} isteği aşmaz.</p></div>
      <div className="duration-fields">
        <label className="duration-model">Model<select value={modelId} disabled={locked} onChange={e => { setModelId(e.target.value); }}><option value="" disabled>Model seçin</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.model}{m.demo ? " · DEMO" : ""}</option>)}</select></label>
        <label>Eşzamanlılık<select value={concurrency} disabled={locked} onChange={e => setConcurrency(Number(e.target.value))}>{Array.from({length:8}, (_, i) => <option key={i} value={i+1}>{i+1} paralel döngü</option>)}</select></label>
        <label>Test süresi (sn)<input type="number" min="1" max="3600" value={duration} disabled={locked} onChange={e => setDuration(Number(e.target.value))} /></label>
        <label>Yanıt sonrası bekleme (sn)<input type="number" min="0.1" max="600" step="0.1" value={interval} disabled={locked} onChange={e => setIntervalValue(Number(e.target.value))} /></label>
        <label>İstek zaman aşımı (sn)<input type="number" min="1" max="600" value={timeout} disabled={locked} onChange={e => setTimeoutValue(Number(e.target.value))} /></label>
      </div>
      <div className="duration-endpoint"><span>Sağlayıcı: {model?.base_url || "Demo · bağlantı yok"}</span><button className="text-button" type="button" onClick={onSettings}>Model ayarları</button></div>
      <div className="duration-editor">
        <div className="segmented compact"><button type="button" disabled={locked} className={inputMode === "prompt" ? "active" : ""} onClick={() => setInputMode("prompt")}>Metin girdisi</button><button type="button" disabled={locked} className={inputMode === "raw" ? "active" : ""} onClick={() => setInputMode("raw")}>JSON / curl</button></div>
        {inputMode === "prompt" ? <>
          <label>Hazır girdi<select defaultValue="" disabled={locked} onChange={e => useSaved(e.target.value)}><option value="">Kayıtlı girdi veya bağlam seç</option>{savedInputs.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}{contexts.map(c => <option value={`context:${c.id}`} key={c.id}>{c.name}</option>)}</select></label>
          <label>Her istekte gönderilecek metin<textarea value={prompt} disabled={locked} onChange={e => setPrompt(e.target.value)} rows={5} /></label>
          <div className="duration-generation"><label>Çıktı limiti (token)<input type="number" min="1" max="32768" value={maxTokens} disabled={locked} onChange={e => setMaxTokens(Number(e.target.value))}/></label><label>Yanıt biçimi<select value={stream ? "stream" : "normal"} disabled={locked} onChange={e => setStream(e.target.value === "stream")}><option value="stream">Stream</option><option value="normal">Normal JSON</option></select></label></div>
        </> : <>
          <label>Chat/completions JSON gövdesi veya curl<textarea className="duration-json" rows={13} value={raw} disabled={locked} onChange={e => { setRaw(e.target.value); setPreview(null); }} spellCheck={false}/></label>
          <p>curl çalıştırılmaz; yalnızca JSON gövdesi ve --max-time okunur. Komuttaki başlıklar ve API anahtarı kullanılmaz. İstek, seçilen kayıtlı modelin sağlayıcısına ve kayıtlı anahtarıyla gönderilir. chat_template_kwargs korunur.</p>
          <button type="button" className="button" disabled={locked} onClick={importInput}><FileText size={16}/>Gövdeyi doğrula</button>
          {preview && <div className="duration-preview"><strong>Gövde hazır · model: {String(preview.payload.model || model?.model || "seçilmedi")}</strong>{preview.url && <p>curl adresi (bilgi): {preview.url}</p>}<p>Gönderilecek sağlayıcı: {model?.base_url || "Demo"}. JSON model kimliği, seçilen modelle eşleşmelidir. Stream isteklerinde usage istenir.</p><details><summary>Gönderilecek JSON’u incele</summary><pre>{JSON.stringify({...preview.payload, model: preview.payload.model || model?.model}, null, 2)}</pre></details></div>}
        </>}
      </div>
      <div className="duration-launch"><label className="duration-demo"><input type="checkbox" checked={demo} disabled={locked} onChange={e => setDemo(e.target.checked)}/>Demo · gerçek API çağrısı yapılmaz</label><button className="button primary" disabled={locked || !modelId || (inputMode === "raw" ? !preview : !prompt.trim())} onClick={start}><Play size={16}/>{demo ? "Demo testi başlat" : "Süreli testi başlat"}</button></div>
      <p className="duration-limit">En fazla 1 saat ve 10.000 istek. Sonuçlar otomatik kaydedilir. HTTP başarısı, dolu cevap ve guard başlıkları ayrı kontrol edilir.</p>
    </section>
    {error && <div className="error-message" role="alert">{error}</div>}
    {run && <section className="panel duration-results" aria-label="Süreli test sonuçları">
      <div className="duration-result-title"><div><h2>{run.name}</h2><p>{run.models[0]?.name} · {run.config.concurrency} döngü · {run.config.interval_s} sn bekleme · {number(run.elapsed_s)} / {run.config.duration_s} sn</p></div><span className={`status ${run.status}`}>{labels[run.status]}</span>{running ? <button className="button" disabled={busy || run.status === "stopping"} onClick={stop}><Square size={14}/>Durdur</button> : <a className="button" href={`/api/runs/${run.id}/export?format=json`} download><ArrowDownToLine size={16}/>JSON indir</a>}</div>
      {run.config.demo && <p className="duration-warning">SENTETİK DEMO: yanıtlar, süreler ve guard sonuçları gerçek servis ölçümü değildir.</p>}
      <div className="duration-verdict"><h3>{running ? "İstekler kontrol ediliyor" : run.summary.all_success ? "Gönderilen tüm istekler başarılı ve cevapları dolu" : "Testte incelenecek sonuçlar var"}</h3><p>{run.summary.completed} başarılı / {run.summary.total} gönderildi · {run.summary.failed} başarısız · {run.summary.cancelled} durduruldu · {run.summary.active} devam ediyor</p></div>
      <div className="duration-guard-summary"><span><b>{run.summary.guard_pass}</b> guard pass</span><span><b>{run.summary.retried}</b> attempts &gt; 1</span><span><b>{run.summary.guard_other}</b> pass dışı guard</span><span><b>{run.summary.guard_missing}</b> guard başlığı yok</span><span><b>{run.summary.attempts_unknown}</b> attempts bilinmiyor</span><span><b>{run.summary.empty}</b> boş cevap</span></div>
      <p className="duration-metric-note">Token/sn = sağlayıcının completion_tokens sayısı / isteğin toplam yanıt süresi; reasoning tokenları usage’a dahilse sayılır. Usage yoksa hız “—” kalır. Eksik guard başlığı pass sayılmaz. Detayı açarak cevabı ve reasoning’i inceleyebilirsin.</p>
      {run.warnings.filter(w => !w.startsWith("Demo:")).map((w,i) => <p className="duration-warning" key={i}>{w}</p>)}
      <div className="duration-log">{run.requests.map(row => <RequestItem key={`${run.id}:${row.index}`} row={row} id={run.id}/>)}</div>
      <div className="duration-pagination"><span>Son gönderilenler önce · {run.summary.total ? offset + 1 : 0}–{Math.min(offset + run.requests.length, run.summary.total)} / {run.summary.total}</span><button className="button" disabled={offset === 0} aria-label="Daha yeni istekler" onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft size={16}/></button><button className="button" disabled={offset + 50 >= run.summary.total} aria-label="Daha eski istekler" onClick={() => setOffset(offset + 50)}><ChevronRight size={16}/></button></div>
    </section>}
    <section className="panel duration-history"><h2>Önceki süreli testler</h2>{past.length ? past.map(item => <button type="button" key={item.id} className="duration-history-item" disabled={running && run?.id !== item.id} onClick={() => open(item.id)}><span><b>{item.name}</b><small>{new Date(item.created_at).toLocaleString("tr-TR")} · {item.summary.completed}/{item.summary.total} başarılı · {item.summary.retried} tekrar</small></span><span className={`status ${item.status}`}>{labels[item.status]}</span></button>) : <p>Henüz süreli test kaydı yok.</p>}</section>
  </div>;
}
