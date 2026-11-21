import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  Fingerprint,
  FlaskConical,
  Gauge,
  Layers3,
  Loader2,
  LogOut,
  Moon,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import { loadExample, type PromptExample } from "./examples";
import { BenchmarkGuard, ResponseComparison, showsBenchmarkGuard, type GuardInfo } from "./ResponseComparison";
import { ModeExplanation } from "./ModeExplanation";
import { distributePromptSources, PromptDistribution, type PromptSourceGroup } from "./PromptDistribution";
import { VisualInput, requiresSingleImage, type MediaImage, type ModelInputFormat } from "./VisualInput";
import { PerformanceChart as Chart } from "./PerformanceChart";
import { api } from "./api";
import { MAX_CONCURRENT_REQUESTS, REQUESTS_PER_PAGE, RequestCount, RequestPage, parseRequestCount } from "./RequestCount";
import {
  SavedInputs,
  type SavedInput,
  type SavedInputSummary,
  type InputDraft,
  lengthLabel,
} from "./SavedInputs";
import "./saved-inputs.css";
import "./dark.css";
import "./dark-accent.css";
import "./workbench.css";
import { MetricGuide } from "./MetricGuide";

type Model = {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string;
  metrics_url: string;
  color: string;
  demo: boolean;
  has_key?: boolean;
  key_requires_reentry?: boolean;
  has_ca_certificate?: boolean;
  use_shared_ca?: boolean;
  input_format?: ModelInputFormat;
  empty_guard_enabled?: boolean;
};
type Context = { id: string; name: string; category: string; content: string };
type PromptAssignment = { content: string; source: string; images?: MediaImage[] };

function shiftInactiveSlots<T>(slots: Record<number, T>, previousCount: number, nextCount: number) {
  return Object.fromEntries(Object.entries(slots).flatMap(([key, value]) => {
    const index = Number(key);
    return index >= previousCount ? [[index - previousCount + nextCount, value]] : [];
  }));
}
type Row = {
  index: number;
  status: string;
  text: string;
  input_tokens: number | null;
  output_tokens: number | null;
  ttft_s: number | null;
  e2e_s: number | null;
  stream_tps: number | null;
  tpot_s: number | null;
  chunk_gap_p95_s: number | null;
  error: string | null;
  content_chunks: number;
  guard?: GuardInfo;
};
type Summary = Record<string, number | null>;
type Target = Model & {
  status: string;
  summary: Summary | null;
  requests: Row[];
  history: {
    time_s: number;
    tokens: number | null;
    throughput: number | null;
  }[];
};
type Phase = { name: string; models: Target[] };
type Config = {
  mode: string;
  prompts: string[];
  prompt_images?: Record<number, MediaImage[]>;
  prompt_uuid_parts?: number[];
  max_tokens: number;
  temperature: number;
  timeout: number;
  model_schedule: string;
  demo: boolean;
  stream?: boolean;
};
type Report = {
  id: string;
  name: string;
  created_at: string;
  finished_at: string | null;
  status: string;
  config: Config;
  models: Model[];
  phases?: Phase[];
  warnings?: string[];
  fingerprint?: string;
};
type ReportSummary = Omit<Report, "config"> & {
  config: Omit<Config, "prompts" | "prompt_images"> & { prompt_count: number };
};
const promptUuidPositions = ["Başlangıç", "Yaklaşık %25", "Yaklaşık %50", "Yaklaşık %75"];

async function fetchBenchmarkReport(path: string, method = "GET", body?: unknown): Promise<Report> {
  const report = await api<Report & { config: Config & { prompt_indices?: number[] } }>(path + "?compact=1", method, body);
  const { prompt_indices: indices, ...config } = report.config;
  return { ...report, config: { ...config, prompts: indices ? indices.map(index => config.prompts[index]) : config.prompts } };
}

function packBenchmarkInputs(inputs: string[]) {
  const lookup = new Map(Array.from(new Set(inputs), (input, index) => [input, index] as const));
  return lookup.size === inputs.length
    ? { prompts: inputs }
    : { prompts: [...lookup.keys()], prompt_indices: inputs.map(input => lookup.get(input)) };
}
type Page = "benchmark" | "reports" | "contexts" | "inputs" | "settings" | "guide";
const titles: Record<Page, string> = {
  benchmark: "Model karşılaştırma",
  reports: "Kayıtlı raporlar",
  contexts: "Bağlam kütüphanesi",
  inputs: "Kayıtlı girdiler",
  settings: "Yönetici ayarları",
  guide: "Ölçüm rehberi",
};
const statusLabels: Record<string, string> = {
  queued: "Bekliyor",
  running: "Çalışıyor",
  stopping: "Durduruluyor",
  completed: "Tamamlandı",
  partial: "Kısmi sonuç",
  cancelled: "Durduruldu",
  failed: "Başarısız",
  interrupted: "Kesintiye uğradı",
};
const active = (run: Pick<Report, "status"> | null) =>
  !!run && ["running", "stopping", "queued"].includes(run.status);
const fmt = (value: number | null | undefined, digits = 2) =>
  value == null
    ? "—"
    : value.toLocaleString("tr-TR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const date = (value: string) =>
  new Date(value).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <div className="brand-mark">
        <Layers3 size={23} strokeWidth={1.8} />
      </div>
      <div>
        inference
        <span>
          lab<span className="brand-dot">.</span>
        </span>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", "POST", { username, password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-story">
        <Logo />
        <div className="login-copy">
          <h1>
            Performansı ölç.
            <br />
            Farkı gör.
          </h1>
          <p>
            Aynı girdiler. Farklı modeller.
            <br />
            Karar vermek için ihtiyacın olan ölçümler.
          </p>
          <div className="login-plot" aria-hidden="true">
            <svg viewBox="0 0 500 170">
              <path d="M0 150H500M0 100H500M0 50H500" stroke="#3b4e5b" />
              <path
                d="M0 150L75 146L140 127L220 113L280 89L345 84L430 52L500 45"
                stroke="#91b5ff"
                fill="none"
                strokeWidth="3"
              />
              <path
                d="M0 150L75 140L140 115L220 90L280 72L345 55L430 23L500 7"
                stroke="#eb885b"
                fill="none"
                strokeWidth="3"
              />
            </svg>
          </div>
        </div>
        <div className="login-foot">
          <FlaskConical size={16} /> Çıkarım performansı çalışma alanı
        </div>
      </div>
      <div className="login-form">
        <div className="login-form-inner">
          <div className="login-symbol">
            <ShieldCheck size={25} />
          </div>
          <h2>Çalışma alanına giriş</h2>
          <p>Modelleri hazırla, testleri çalıştır ve sonuçlarını incele.</p>
          <form onSubmit={submit}>
            <label>
              Kullanıcı adı
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Şifre
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Şifrenizi girin"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              Giriş yap
            </button>
          </form>
          <div className="dev-note">
            <span className="dot" /> Geliştirme sürümü ·{" "}
            <code>admin / admin</code>
          </div>
        </div>
      </div>
    </div>
  );
}

const metrics: [string, string, string, boolean][] = [
  ["throughput", "Toplam verim", "tok/sn", true],
  ["ttft_avg_s", "Ort. ilk token (TTFT)", "sn", false],
  ["ttft_p95_s", "p95 ilk token", "sn", false],
  ["ttft_p99_s", "p99 ilk token", "sn", false],
  ["stream_avg_tps", "Ort. akış hızı¹", "tok/sn", true],
  ["e2e_avg_s", "Ort. uçtan uca", "sn", false],
  ["e2e_p95_s", "p95 uçtan uca", "sn", false],
  ["wall_s", "Duvar süresi", "sn", false],
  ["output_tokens", "Toplam çıktı tokenı", "token", true],
  ["input_tokens", "Toplam giriş tokenı", "token", false],
  ["tpot_avg_s", "Ort. token süresi¹", "sn", false],
  ["chunk_gap_p95_s", "p95 parça aralığı", "sn", false],
  ["requests_per_s", "İstek verimi", "istek/sn", true],
  ["drafted_per_step", "Drafted / adım", "token", true],
  ["acceptance_pct", "Ortalama kabul", "%", true],
];

const metricHelp: Record<string, string> = {
  throughput: "Başarılı isteklerde üretilen toplam çıktı tokenı, testin toplam süresine bölünür. Birden fazla isteğin toplam üretim kapasitesini gösterir; yüksek olması iyidir.",
  ttft_avg_s: "İstek gönderildikten sonra ilk içerik veya düşünme parçası gelene kadar geçen sürelerin ortalaması. Kullanıcının yanıtın başlamasını ne kadar beklediğini gösterir; düşük olması iyidir.",
  ttft_p95_s: "İlk token sürelerinin yüzde 95'inin altında kaldığı yaklaşık süre. Yavaş başlayan istekleri ortalamadan daha görünür kılar; düşük olması iyidir.",
  ttft_p99_s: "İlk token sürelerinin yüzde 99'unun altında kaldığı yaklaşık süre. Az sayıda istekte tek bir yavaş sonuçtan çok etkilenebilir; düşük olması iyidir.",
  stream_avg_tps: "İlk yanıttan sonra saniyede üretilen çıktı tokenı sayısının istekler arası ortalaması. Sağlayıcının toplam token sayısıyla tahmin edilir; yüksek olması iyidir.",
  e2e_avg_s: "İstek gönderiminden yanıtın tamamlanmasına kadar geçen sürenin ortalaması. Kullanıcının tüm cevabı ne kadar beklediğini gösterir; düşük olması iyidir.",
  e2e_p95_s: "Yanıtların yüzde 95'inin tamamlandığı yaklaşık süre. Yavaş istekleri görmeye yardımcı olur; düşük olması iyidir.",
  wall_s: "Bu modelin test fazının başından sonuna kadar geçen gerçek süre. Eşzamanlı isteklerin süreleri toplanmaz; düşük olması genellikle iyidir.",
  output_tokens: "Başarılı yanıtlarda üretilen toplam çıktı tokenı. Token, metnin model tarafından işlenen parçasıdır; sağlayıcı bildirmezse bu değer bilinmez.",
  input_tokens: "Başarılı isteklere gönderilen toplam giriş tokenı. Aynı girdi birden fazla isteğe gönderilirse her istek ayrı sayılır; sağlayıcı bildirmezse bilinmez.",
  tpot_avg_s: "İlk yanıttan sonra çıktı tokenı başına geçen tahmini sürenin istekler arası ortalaması. Düşük değer, yanıtın daha hızlı üretildiğini gösterir.",
  chunk_gap_p95_s: "Yanıtın art arda gelen parçaları arasındaki gecikmelerin her istekteki p95 değerlerinden hesaplanan p95. Parçalar token ile aynı şey değildir; düşük olması iyidir.",
  requests_per_s: "Başarıyla tamamlanan istek sayısının testin gerçek süresine bölümü. Saniyede kaç isteğin tamamlandığını gösterir; yüksek olması iyidir.",
  drafted_per_step: "Tahminli üretimde her adım için önerilen ortalama token sayısı. Yalnızca sağlayıcının ilgili sayaçları varsa ölçülür; sayaçlar sunucudaki diğer trafikten etkilenebilir.",
  acceptance_pct: "Tahminli üretimde önerilen tokenların kabul edilen yüzdesi. Yalnızca ilgili sayaçlar varsa hesaplanır; diğer sunucu trafiği sonucu etkileyebilir.",
};

function MetricHelp({metric, label}: {metric: string; label: string}) {
  const id = useId();
  const [position, setPosition] = useState<{left: number; top: number; above: boolean} | null>(null);
  function show(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const width = Math.min(310, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 170;
    setPosition({left, top: above ? rect.top - 8 : rect.bottom + 8, above});
  }
  useEffect(() => {
    const close = () => setPosition(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, []);
  return <>
    <button type="button" className="metric-help-button" aria-label={`${label} hakkında bilgi`} aria-describedby={position ? id : undefined}
      onMouseEnter={e => show(e.currentTarget)} onMouseLeave={() => setPosition(null)}
      onFocus={e => show(e.currentTarget)} onBlur={() => setPosition(null)}
      onClick={e => show(e.currentTarget)} onKeyDown={e => { if (e.key === 'Escape') setPosition(null); }}><CircleHelp size={15} aria-hidden="true" /></button>
    {position && createPortal(<div id={id} role="tooltip" className="metric-help-popover" style={{left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined}}>{metricHelp[metric]}</div>, document.body)}
  </>;
}

function RequestMatrix({ phase }: { phase: Phase }) {
  const metrics = [
    ["input_tokens", "Giriş tok"],
    ["ttft_s", "İlk token sn"],
    ["stream_tps", "Akış tok/sn¹"],
    ["e2e_s", "E2E sn"],
    ["output_tokens", "Çıktı tok"],
  ] as const;
  const models = phase.models.map(model => ({model, showGuard: showsBenchmarkGuard(model)}));
  return (
    <div className="request-matrix">
      <h3>Girdi bazında karşılaştırma</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Girdi</th>
              {models.map(({model: m, showGuard}) => (
                <th scope="colgroup" colSpan={metrics.length + Number(showGuard)} key={m.id}>
                  <div>
                    <i style={{ background: m.color }} />
                    {m.name}
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              {models.map(({model: m, showGuard}) => (
                <React.Fragment key={m.id}>
                  {metrics.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}
                  {showGuard && <th scope="col">Empty Guard</th>}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {phase.models[0]?.requests.map((request, i) => (
              <tr key={i}>
                <td>
                  <b>#{String(i + 1).padStart(2, "0")}</b>
                </td>
                {models.map(({model: m, showGuard}) => {
                  const row = m.requests[i];
                  return (
                    <React.Fragment key={m.id}>
                      {metrics.map(([key]) => (
                        <td key={key} className={!showGuard && key === "output_tokens" ? "model-request-end" : undefined}
                          title={row?.error || (row && statusLabels[row.status])}>
                          {fmt(row?.[key], key.includes("tokens") ? 0 : 2)}
                        </td>
                      ))}
                      {showGuard && <td className="model-request-end"><BenchmarkGuard row={row} /></td>}
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Results({
  run,
  onStop,
  historical = false,
}: {
  run: Report;
  onStop: () => void;
  historical?: boolean;
}) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [tab, setTab] = useState("summary");
  const [printError, setPrintError] = useState("");
  function printReport(event: React.MouseEvent<HTMLButtonElement>) {
    const report = event.currentTarget.closest('.results');
    const preview = window.open('', '_blank');
    if (!report || !preview) {
      if (preview) preview.close();
      setPrintError('Yazdırma sekmesi açılamadı. Tarayıcının açılır pencerelere izin verdiğini kontrol edin.');
      return;
    }
    setPrintError('');
    preview.opener = null;
    const doc = preview.document;
    doc.title = 'Inference Lab · Rapor';
    doc.documentElement.lang = 'tr';
    doc.documentElement.dataset.theme = 'light';
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    doc.head.append(viewport);
    const loads: Promise<void>[] = [];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((style) => {
      const copy = doc.importNode(style, true);
      if (style.tagName === 'LINK') {
        loads.push(new Promise(resolve => {
          copy.addEventListener('load', () => resolve(), { once: true });
          copy.addEventListener('error', () => resolve(), { once: true });
        }));
      }
      doc.head.append(copy);
    });
    const controls = doc.createElement('div');
    controls.className = 'print-preview-controls';
    const button = doc.createElement('button');
    button.className = 'button primary';
    button.textContent = 'PDF / Yazdır';
    button.addEventListener('click', () => preview.print());
    controls.append(button);
    const copy = doc.importNode(report, true);
    copy.querySelector('.result-actions')?.remove();
    doc.body.className = 'print-preview';
    doc.body.append(controls, copy);
    void Promise.all(loads).then(() => doc.fonts.ready).then(() => {
      if (!preview.closed) { preview.focus(); preview.print(); }
    });
  }
  const phases = run.phases || [];
  const phase = phases[Math.min(phaseIndex, phases.length - 1)];
  const running = active(run);
  const [baselineId, setBaselineId] = useState(run.models[0]?.id);
  const baseline =
    phase?.models.find((m) => m.id === baselineId) || phase?.models[0];
  const complete =
    phase?.models.reduce(
      (n, m) =>
        n +
        m.requests.filter((r) =>
          ["completed", "failed", "cancelled"].includes(r.status),
        ).length,
      0,
    ) || 0;
  const total = phase?.models.reduce((n, m) => n + m.requests.length, 0) || 0;
  const winners =
    phase?.models
      .filter(
        (m) =>
          m.summary?.throughput != null &&
          !m.summary.failed &&
          !m.summary.cancelled,
      )
      .sort(
        (a, b) => (b.summary?.throughput || 0) - (a.summary?.throughput || 0),
      ) || [];
  function delta(m: Target, key: string, higher: boolean) {
    const base = baseline?.summary?.[key];
    const value = m.summary?.[key];
    if (
      !base ||
      value == null ||
      m.id === baseline?.id ||
      m.summary?.completed !== baseline?.summary?.completed ||
      m.summary?.failed ||
      baseline?.summary?.failed ||
      m.summary?.cancelled ||
      baseline?.summary?.cancelled
    )
      return null;
    const d = (value / base - 1) * 100;
    return (
      <span
        className={`delta ${higher ? (d >= 0 ? "good" : "bad") : d <= 0 ? "good" : "bad"}`}
      >
        {d > 0 ? "+" : ""}
        {fmt(d, 1)}%
      </span>
    );
  }
  return (
    <section className="results" aria-label="Test sonuçları">
      <div className="section-heading">
        <div>
          <h2>{historical ? run.name : "Karşılaştırma sonuçları"}</h2>
          <p>
            {running
              ? "Akışlar çalışıyor. Her model aynı girdilerle ölçülüyor."
              : `${date(run.created_at)} · ${run.config.prompts.length} girdi · ${run.models.length} model`}
          </p>
        </div>
        <div className="result-actions">
          <span className={`status ${run.status}`}>
            <span className="dot" />
            {statusLabels[run.status]}
          </span>
          {running ? (
            <button
              className="button danger-outline"
              onClick={onStop}
              disabled={run.status === "stopping"}
            >
              <Square size={14} /> Durdur
            </button>
          ) : (
            <details className="export-menu">
              <summary className="button">
                <ArrowDownToLine size={16} /> Dışa aktar{" "}
                <ChevronDown size={14} />
              </summary>
              <div>
                {["md", "csv", "json"].map((f) => (
                  <a
                    key={f}
                    href={`/api/runs/${run.id}/export?format=${f}`}
                    download
                  >
                    {f === "md"
                      ? "Markdown raporu"
                      : f.toUpperCase() + " dosyası"}
                  </a>
                ))}
                <button onClick={printReport}>PDF / Yazdır</button>
              </div>
            </details>
          )}
        </div>
      </div>
      {printError && <p className="print-error" role="alert">{printError}</p>}
      {run.config.demo && (
        <div className="demo-banner">
          <FlaskConical size={16} />
          <b>Demo sonuçları</b>
          <span>
            Bu koşu sentetik verilerle çalıştı. Gerçek performans ölçümü
            değildir.
          </span>
        </div>
      )}
      <div className="result-toolbar">
        <div className="tabs" role="group" aria-label="Sonuç görünümü">
          {[
            ["summary", "Genel bakış"],
            ["answers", "Cevaplar"],
            ["requests", "İstek detayları"],
            ["method", "Ölçüm bilgileri"],
          ].map(([id, label]) => (
            <button
              type="button"
              className={tab === id ? "active" : ""}
              aria-pressed={tab === id}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {phases.length > 1 && (
          <div className="segmented compact result-phases" role="group" aria-label="Ölçüm fazı">
            {phases.map((p, i) => (
              <button
                type="button"
                key={p.name}
                className={phaseIndex === i ? "active" : ""}
                aria-pressed={phaseIndex === i}
                onClick={() => setPhaseIndex(i)}
              >
                {p.name === "serial"
                  ? "Sırayla (C1)"
                  : `Aynı anda (C${run.config.prompts.length})`}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === "summary" && phase && (
        <>
          <div className="result-overview">
            <div className="chart-panel">
              <Chart phase={phase} />
            </div>
            <div className="run-progress">
              <div className="progress-top">
                <Activity size={18} />
                <span>
                  {phases.length > 1 ? "Seçili fazın özeti" : "Koşu özeti"}
                </span>
              </div>
              <strong>
                {complete}
                <span> / {total}</span>
              </strong>
              <p>istek sonuçlandı</p>
              <div className="progress-track" role="progressbar" aria-label="Sonuçlanan istekler" aria-valuenow={complete} aria-valuemax={total || 1}>
                <div
                  style={{
                    transform: `scaleX(${total ? complete / total : 0})`,
                  }}
                />
              </div>
              {winners.length > 1 && !running ? (
                <div className="leader">
                  <span
                    style={{ background: winners[0].color }}
                    className="dot"
                  />
                  <div>
                    <b>{winners[0].name}</b>
                    <small>En yüksek toplam verim</small>
                  </div>
                  <ArrowUpRight size={17} />
                </div>
              ) : (
                <div className="leader">
                  <Clock3 size={16} />
                  <small>
                    {running
                      ? "Ölçüm devam ediyor"
                      : "Rapor otomatik kaydedildi"}
                  </small>
                </div>
              )}
              <div className="progress-meta">
                <span>Çıktı limiti</span>
                <b>{run.config.max_tokens} token</b>
                <span>Çalışma düzeni</span>
                <b>
                  {run.config.model_schedule === "parallel"
                    ? "Modeller paralel"
                    : "Modeller sırayla"}
                </b>
              </div>
            </div>
          </div>
          <section className="model-metric-overview" aria-labelledby="model-summary-title">
            <h3 id="model-summary-title">Model özetleri</h3>
            {phase.models.map((model) => (
              <div className="model-metric-summary" key={model.id} style={{"--summary-color": model.color} as React.CSSProperties}>
                <div className="model-metric-title"><span><i style={{background: model.color}} />{model.name}</span><small>{model.summary ? `${model.summary.completed} / ${model.summary.total} başarılı` : statusLabels[model.status]}</small></div>
                <div className="model-metric-values">
                  {([
                    ["throughput", "Toplam verim", "tok/sn"],
                    ["ttft_avg_s", "İlk token · ort.", "sn"],
                    ["stream_avg_tps", "Akış hızı · ort.¹", "tok/sn"],
                    ["e2e_avg_s", "Uçtan uca · ort.", "sn"],
                  ] as const).map(([key, label, unit]) => (
                    <div key={key}><span>{label} <MetricHelp metric={key} label={label} /></span><strong>{fmt(model.summary?.[key], 2)} <small>{unit}</small></strong></div>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <div className="table-heading">
            <h3 id="benchmark-metrics-title">Metrik karşılaştırması</h3>
            {phase.models.length > 1 && <label className="inline-label">
              Referans model
              <select
                value={baseline?.id || ""}
                onChange={(e) => setBaselineId(e.target.value)}
              >
                {phase.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>}
          </div>
          <div className="table-scroll metrics-scroll" role="region" aria-labelledby="benchmark-metrics-title" tabIndex={0}>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th scope="col">Metrik</th>
                  {phase.models.map(m => <th scope="col" key={m.id}><div><i style={{background: m.color}} />{m.name}</div><small>{m.summary ? `${m.summary.completed} / ${m.summary.total} başarılı` : statusLabels[m.status]}</small></th>)}
                </tr>
              </thead>
              <tbody>
                {metrics.map(([key, label, unit, higher]) => (
                  <tr key={key}>
                    <th scope="row" className="metric-row-label"><div className="metric-column-heading"><span>{label}</span><MetricHelp metric={key} label={label} /></div>{!['output_tokens','input_tokens','drafted_per_step','acceptance_pct'].includes(key) && <small>{higher ? 'Yüksek daha iyi' : 'Düşük daha iyi'}</small>}</th>
                    {phase.models.map((m) => (
                      <td key={m.id}>
                        <div className="metric-value">
                          <b>
                            {fmt(
                              m.summary?.[key],
                              key.includes("tokens")
                                ? 0
                                : key === "tpot_avg_s"
                                  ? 4
                                  : 2,
                            )}
                          </b>
                          <span>{unit}</span>
                          {[
                            "output_tokens",
                            "input_tokens",
                            "drafted_per_step",
                          ].includes(key)
                            ? null
                            : delta(m, key, higher)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-footnote">
            ¹ Akış hızı ve token süresi, sağlayıcı token sayısından türetilen
            tahminlerdir. “—” ölçülmeyen veya sağlayıcı tarafından sunulmayan
            değerdir.
          </p>
          {phases.length === 2 &&
            phases.every((p) => p.models.some((m) => m.summary)) && (
              <div className="load-comparison">
                <h3>Seri → eşzamanlı yük etkisi</h3>
                {run.models.map((m) => {
                  const serial = phases[0].models.find(
                    (t) => t.id === m.id,
                  )?.summary;
                  const concurrent = phases[1].models.find(
                    (t) => t.id === m.id,
                  )?.summary;
                  return (
                    <div key={m.id}>
                      <span>
                        <i style={{ background: m.color }} />
                        {m.name}
                      </span>
                      <b>
                        {serial?.throughput &&
                        concurrent?.throughput &&
                        serial.completed === concurrent.completed &&
                        !serial.failed &&
                        !concurrent.failed &&
                        !serial.cancelled &&
                        !concurrent.cancelled
                          ? fmt(concurrent.throughput / serial.throughput) + "×"
                          : "—"}
                      </b>
                      <small>toplam verim oranı</small>
                    </div>
                  );
                })}
              </div>
            )}
        </>
      )}
      {(tab === "summary" || tab === "answers") && phase && (
        <ResponseComparison phase={phase} prompts={run.config.prompts} images={run.config.prompt_images} stream={run.config.stream !== false} />
      )}
      {tab === "requests" && phase && (
        <div className="request-results">
          <RequestMatrix phase={phase} />
        </div>
      )}
      {tab === "method" && (
        <div className="method-info">
          <h3>Bu koşu nasıl ölçüldü?</h3>
          <dl>
            <dt>Toplam verim</dt>
            <dd>
              Başarıyla tamamlanan çıktı tokenları / model fazının duvar süresi.
              Başarısız isteklerin zamanı duvar süresine dahildir.
            </dd>
            <dt>İlk token (TTFT)</dt>
            <dd>
              HTTP isteğinin başlangıcından ilk içerik veya reasoning parçasına
              kadar geçen süre. Normal JSON yanıtta bu süre ölçülmez; değer boş kalır.
            </dd>
            <dt>Akış hızı / TPOT</dt>
            <dd>
              Sağlayıcının completion_tokens sayısı ve ilk–son içerik parçası
              aralığı kullanılır. SSE parçaları tek tek token olarak sayılmaz.
            </dd>
            <dt>p95 / p99</dt>
            <dd>
              Başarılı istekler üzerinde doğrusal interpolasyon. Değerler bu
              koşuyu özetler, genelleme için tekrarlı koşular gerekir.
            </dd>
            <dt>Draft / kabul</dt>
            <dd>
              Yapılandırılan Prometheus metrics URL’sinin koşu öncesi ve sonrası
              sayaç farkları. Sunucu trafiği ve yayın gecikmesi sonucu
              etkileyebilir.
            </dd>
            {run.config.prompt_uuid_parts && run.config.prompts.some((_, index) => !run.config.prompt_images?.[index]?.length) && (
              <>
                <dt>Metin UUID konumları</dt>
                <dd>{run.config.prompt_uuid_parts.map(part => `${part}/4`).join(", ")}</dd>
              </>
            )}
            <dt>Koşu kimliği</dt>
            <dd>
              <code>{run.id}</code>
            </dd>
            <dt>Yapılandırma izi</dt>
            <dd>
              <code>{run.fingerprint}</code>
            </dd>
          </dl>
          <h3>Koşu notları</h3>
          {[...new Set(run.warnings || [])].map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          {!run.warnings?.length && <p>Bu koşu için ek not yok.</p>}
          <h3>Girdiler ve ayarlar</h3>
          <pre>{JSON.stringify(run.config, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}

function SharedCaForm({
  configured,
  onSave,
}: {
  configured: boolean;
  onSave: (configured: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError("");
    setBusy(true);
    try {
      let certificate = "";
      if (!clear) {
        if (!file?.size || file.size > 65536) {
          throw new Error("Boş olmayan ve en fazla 64 KB boyutunda bir PEM dosyası seçin.");
        }
        certificate = await file.text();
      }
      const settings = await api<{configured: boolean}>("/settings/shared-ca", "POST", {
        ca_certificate: certificate,
        clear_ca_certificate: clear,
      });
      form.reset();
      setFile(null);
      setClear(false);
      onSave(settings.configured);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="edit-panel shared-ca-panel" aria-labelledby="shared-ca-heading">
      <div className="section-heading">
        <h2 id="shared-ca-heading">Ortak HTTPS sertifikası</h2>
        <small>{configured ? "CA sertifikası kayıtlı" : "CA sertifikası yüklenmedi"}</small>
      </div>
      <p>Kurum içi HTTPS sağlayıcılarınızın CA sertifikasını bir kez yükleyin. Ortak CA kullanımı açık modeller yeni bağlantılarda bu sertifikayı kullanır.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="full">
            CA sertifikası (PEM)
            <input
              type="file"
              accept=".pem,.crt,.cer"
              disabled={busy || clear}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {configured && (
            <label className="checkbox-label full">
              <input type="checkbox" checked={clear} disabled={busy} onChange={e => setClear(e.target.checked)} />
              Ortak CA sertifikasını kaldır
            </label>
          )}
        </div>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="form-actions">
          <button className="button primary" disabled={busy || (!file && !clear)}>
            {busy ? "Kaydediliyor…" : "Sertifika ayarını kaydet"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ModelForm({
  model,
  sharedCaConfigured,
  onSave,
  onClose,
}: {
  model: Model | null;
  sharedCaConfigured: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    id: model?.id,
    name: model?.name || "",
    provider: "OpenAI uyumlu",
    input_format: model?.input_format ?? "auto",
    empty_guard_enabled: model?.empty_guard_enabled ?? false,
    model: model?.model || "",
    base_url: model?.base_url || "",
    api_key: "",
    metrics_url: model?.metrics_url || "",
    clear_key: false,
    clear_ca_certificate: false,
    use_shared_ca: model?.use_shared_ca ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: string | boolean) =>
    setForm({ ...form, [key]: value });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/models", "POST", form);
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="edit-panel">
      <div className="section-heading">
        <h2>{model ? "Modeli düzenle" : "Yeni model ekle"}</h2>
        <button
          className="icon-button"
          aria-label="Model formunu kapat"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <p>OpenAI uyumlu Chat Completions API kullanan bir sağlayıcı bağlayın.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Görünen ad
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Örn. vLLM H200"
              required
            />
          </label>
          <label>
            API protokolü
            <select
              value={form.provider}
              onChange={(e) => update("provider", e.target.value)}
            >
              <option value="OpenAI uyumlu">OpenAI uyumlu · Chat Completions</option>
            </select>
            <small>vLLM ve bu protokolü sunan diğer sağlayıcılar desteklenir.</small>
          </label>
          <label className="full">
            Model kimliği
            <input
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="Qwen/Qwen3.5-122B-A10B-FP8"
              required
            />
          </label>
          <label className="full">
            Girdi profili
            <select value={form.input_format} onChange={e => update("input_format", e.target.value)}>
              <option value="auto">Otomatik · LightOnOCR kimliğini tanır</option>
              <option value="vision">Vision · metin ve görsel</option>
              <option value="ocr">LightOnOCR · istek başına tek görsel</option>
            </select>
            <small>LightOnOCR’u özel bir model adıyla yayınlıyorsanız OCR profilini seçin.</small>
          </label>
          <label className="full">
            Sağlayıcı API URL
            <input
              type="url"
              value={form.base_url}
              onChange={(e) => update("base_url", e.target.value)}
              placeholder="https://model.example.com/v1"
              required
            />
            <small>
              Temel URL'yi veya tam /v1/chat/completions adresini girebilirsiniz.
            </small>
          </label>
          <div className="full">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.empty_guard_enabled}
                disabled={busy}
                onChange={e => update("empty_guard_enabled", e.target.checked)}
                aria-describedby="model-empty-guard-help"
              />
              Bu sağlayıcı Empty Guard ile yeniden deneme yapıyor
            </label>
            <small id="model-empty-guard-help">Açıldığında sağlayıcının bildirdiği guard sonucu ve deneme sayısı kaydedilir.</small>
          </div>
          <label className="full">
            API anahtarı
            <input
              type="password"
              autoComplete="new-password"
              value={form.api_key}
              onChange={(e) => update("api_key", e.target.value)}
              placeholder={
                model?.key_requires_reentry
                  ? "Eski şifreli anahtarı yeniden girin"
                  : model?.has_key
                  ? "Kayıtlı anahtarı korumak için boş bırakın"
                  : "Anahtar gerekmiyorsa boş bırakın"
              }
            />
            <small>
              {model?.key_requires_reentry
                ? "Eski şifreli kayıt korunuyor. Kullanmak için API anahtarını yeniden girip kaydedin."
                : "Anahtar sunucuda yalnızca uygulama kullanıcısının okuyabildiği dosyada tutulur; şifrelenmez ve tarayıcıya geri gönderilmez."}
            </small>
          </label>
          {model?.has_key && (
            <label className="checkbox-label full">
              <input
                type="checkbox"
                checked={form.clear_key}
                onChange={(e) => update("clear_key", e.target.checked)}
              />{" "}
              Kayıtlı API anahtarını kaldır
            </label>
          )}
          <div className="full">
            <label className="checkbox-label">
              <input
                type="checkbox"
                role="switch"
                checked={form.use_shared_ca}
                disabled={busy}
                onChange={e => update("use_shared_ca", e.target.checked)}
                aria-describedby="model-ca-help"
              />
              Ortak CA sertifikasını kullan
            </label>
            <small id="model-ca-help">
              {sharedCaConfigured
                ? "Yönetici ayarlarında yüklenen sertifika HTTPS bağlantılarında kullanılır."
                : "Yönetici ayarlarına ortak sertifika yüklendiğinde bu seçim devreye girer."}
            </small>
          </div>
          {model?.has_ca_certificate && (
            <label className="checkbox-label full">
              <input
                type="checkbox"
                checked={form.clear_ca_certificate}
                disabled={busy}
                onChange={(e) => update("clear_ca_certificate", e.target.checked)}
              />{" "}
              Daha önce bu modele özel yüklenen CA sertifikasını kaldır
            </label>
          )}
          <label className="full">
            Metrics URL <span className="optional">isteğe bağlı</span>
            <input
              type="url"
              value={form.metrics_url}
              onChange={(e) => update("metrics_url", e.target.value)}
              placeholder="http://127.0.0.1:8000/metrics"
            />
            <small>
              Drafted ve kabul oranı için vLLM Prometheus uç noktası.
            </small>
          </label>
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Vazgeç
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            Modeli kaydet
          </button>
        </div>
      </form>
    </section>
  );
}

function ContextForm({
  context,
  onSave,
  onClose,
}: {
  context: Context | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    id: context?.id,
    name: context?.name || "",
    category: context?.category || "",
    content: context?.content || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/contexts", "POST", form);
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function file(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) {
      setError("Dosya 1 MB altında olmalıdır.");
      return;
    }
    setForm({
      ...form,
      content: await f.text(),
      name: form.name || f.name.replace(/\.txt$/, ""),
    });
  }
  return (
    <section className="edit-panel">
      <div className="section-heading">
        <h2>{context ? "Bağlamı düzenle" : "Yeni bağlam"}</h2>
        <button
          className="icon-button"
          aria-label="Bağlam formunu kapat"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Bağlam adı
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Örn. 16K hasar değerlendirmesi"
            />
          </label>
          <label>
            Kategori
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Örn. Sigorta"
            />
          </label>
          <label className="full">
            İçerik
            <textarea
              rows={12}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              required
              placeholder="Testte kullanılacak bağlamı ve soruyu yazın."
            />
          </label>
          <label className="file-label full">
            <ArrowDownToLine size={16} /> .txt dosyasından al
            <input type="file" accept=".txt,text/plain" onChange={file} />
          </label>
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Vazgeç
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} /> Bağlamı kaydet
          </button>
        </div>
      </form>
    </section>
  );
}

function App() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("inference-lab-theme");
      return stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("inference-lab-theme", dark ? "dark" : "light"); } catch { /* Theme still works for this session. */ }
  }, [dark]);
  const [session, setSession] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>(() => {
    const value = window.location.hash.slice(1);
    return Object.hasOwn(titles, value) ? value as Page : "benchmark";
  });
  const [models, setModels] = useState<Model[]>([]);
  const [sharedCaConfigured, setSharedCaConfigured] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelChecks, setModelChecks] = useState<Record<string, {ok: boolean; message: string; elapsed_s?: number}>>({});
  const [examples, setExamples] = useState<PromptExample[]>([]);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [savedInputs, setSavedInputs] = useState<SavedInputSummary[]>([]);
  const [inputDraft, setInputDraft] = useState<InputDraft | null>(null);
  const [promptSources, setPromptSources] = useState<Record<number, string>>(
    {},
  );
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>(["", "", "", ""]);
  const [promptImages, setPromptImages] = useState<Record<number, MediaImage[]>>({});
  const [promptUuidParts, setPromptUuidParts] = useState<number[]>([1]);
  const [requestCount, setRequestCount] = useState("4");
  const [requestCountEdited, setRequestCountEdited] = useState(false);
  const [promptPage, setPromptPage] = useState(0);
  const [mode, setMode] = useState("concurrent");
  const [stream, setStream] = useState(true);
  const [schedule, setSchedule] = useState("parallel");
  const [maxTokens, setMaxTokens] = useState('');
  const [temperature, setTemperature] = useState('0.1');
  const [timeout, setTimeoutValue] = useState('120');
  const [name, setName] = useState("");
  const [run, setRun] = useState<Report | null>(null);
  const [historic, setHistoric] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modelEdit, setModelEdit] = useState<Model | null | undefined>(
    undefined,
  );
  const [contextEdit, setContextEdit] = useState<Context | null | undefined>(
    undefined,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const resultsRef = useRef<HTMLDivElement>(null);
  const initial = useRef(true);
  useEffect(() => {
    api<{ authenticated: boolean }>("/session")
      .then((s) => setSession(s.authenticated))
      .catch((e) => {
        setError((e as Error).message);
        setSession(false);
      });
  }, []);
  async function load() {
    const [m, c, r, saved, exampleList, sharedCa] = await Promise.all([
      api<Model[]>("/models"),
      api<Context[]>("/contexts"),
      api<ReportSummary[]>("/reports?summary=1"),
      api<SavedInputSummary[]>("/inputs"),
      api<PromptExample[]>("/examples"),
      api<{configured: boolean}>("/settings/shared-ca"),
    ]);
    setModels(m);
    setContexts(c);
    setReports(r);
    setSavedInputs(saved);
    setExamples(exampleList);
    setSharedCaConfigured(sharedCa.configured);
    setSelected((prev) =>
      prev.length
        ? prev.filter((id) => m.some((model) => model.id === id))
        : m.slice(0, 2).map((model) => model.id),
    );
    if (initial.current) {
      initial.current = false;
      const current = r.find(active);
      const id = current?.id || sessionStorage.getItem("lab_run");
      if (id) {
        try {
          setRun(await fetchBenchmarkReport("/runs/" + id));
        } catch {
          sessionStorage.removeItem("lab_run");
        }
      }
    }
  }
  useEffect(() => {
    if (session) load().catch((e) => setError((e as Error).message));
  }, [session]);
  useEffect(() => {
    if (!active(run)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await fetchBenchmarkReport("/runs/" + run!.id);
        if (stopped) return;
        setRun(next);
        if (active(next)) timer = setTimeout(poll, 400);
        else {
          setToast("Test sonuçları raporlara kaydedildi.");
          api<ReportSummary[]>("/reports?summary=1")
            .then(setReports)
            .catch(() => {});
        }
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          timer = setTimeout(poll, 1500);
        }
      }
    }
    timer = setTimeout(poll, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const chosen = models.filter((m) => selected.includes(m.id));
  const running = active(run);
  const inputCount = mode === "single" ? 1 : parseRequestCount(requestCount);
  const effectivePrompts = Array.from({length: inputCount ?? 1}, (_, index) => prompts[index] ?? "");
  const effectiveImages = Object.fromEntries(Object.entries(promptImages)
    .filter(([index, images]) => Number(index) < effectivePrompts.length && images.length));
  const defaultMaxTokens = Object.keys(effectiveImages).length ? 4096 : 20000;
  const outputLimit = maxTokens.trim() === "" ? defaultMaxTokens : Number(maxTokens);
  const temperatureValue = temperature.trim() === "" ? 0.1 : Number(temperature);
  const timeoutValue = timeout.trim() === "" ? 120 : Number(timeout);
  const validOutputLimit = Number.isInteger(outputLimit) && outputLimit >= 1 && outputLimit <= 32768;
  const validTemperature = Number.isFinite(temperatureValue) && temperatureValue >= 0 && temperatureValue <= 2;
  const validTimeout = Number.isFinite(timeoutValue) && timeoutValue >= 1 && timeoutValue <= 600;
  const hasOcrModel = chosen.some(requiresSingleImage);
  const ocrIssues = hasOcrModel ? effectivePrompts.flatMap((prompt, index) => {
    const images = effectiveImages[index]?.length ?? 0;
    return images === 1 ? [] : [{ index, images, blank: !images && !prompt.trim() }];
  }) : [];
  const invalidOcrInputs = ocrIssues.length > 0;
  const missingOcrImages = ocrIssues.filter(issue => issue.images === 0).length;
  const multiImageOcrSlots = ocrIssues.length - missingOcrImages;
  const blankOcrSlots = ocrIssues.filter(issue => issue.blank).length;
  const repairedOcrCount = effectivePrompts.reduce((total, prompt, index) =>
    total + (effectiveImages[index]?.length || Number(!!prompt.trim())), 0);
  const modelFactor = schedule === "parallel" ? Math.max(1, selected.length) : 1;
  const parallelCount = selected.length ? effectivePrompts.length * modelFactor : 0;
  const overParallelLimit = parallelCount > MAX_CONCURRENT_REQUESTS;
  const filledCount = effectivePrompts.filter((prompt, index) => prompt.trim() || effectiveImages[index]?.length).length;
  const readyCount = hasOcrModel ? effectivePrompts.length - ocrIssues.length : filledCount;
  const totalRequests = parallelCount ? selected.length * effectivePrompts.length * (mode === "compare" ? 2 : 1) : 0;
  const launchBlocker = !chosen.length ? "Başlamak için en az bir model seç."
    : inputCount === null ? "Model başına 1–1.024 arasında bir istek sayısı gir."
    : overParallelLimit ? "Eşzamanlı istek sınırı aşıldı. Girdi sayısını azalt veya modelleri sırayla çalıştır."
    : invalidOcrInputs ? `LightOnOCR için ${ocrIssues.length} kutuda tam bir görsel olmalı.`
    : filledCount < effectivePrompts.length ? `${effectivePrompts.length - filledCount} boş girdiyi doldur.`
    : !validOutputLimit ? "Çıktı limiti 1–32.768 arasında bir tam sayı olmalı."
    : !validTemperature ? "Temperature 0–2 arasında olmalı."
    : !validTimeout ? "Zaman aşımı 1–600 saniye arasında olmalı."
    : "";
  const shownPromptPage = Math.min(promptPage, Math.ceil(effectivePrompts.length / REQUESTS_PER_PAGE) - 1);
  const promptOffset = shownPromptPage * REQUESTS_PER_PAGE;
  const visiblePrompts = effectivePrompts.slice(promptOffset, promptOffset + REQUESTS_PER_PAGE)
    .map((prompt, index) => ({prompt, index: promptOffset + index}));
  const promptSourceGroups: PromptSourceGroup[] = [
    { label: "Kayıtlı girdiler", options: savedInputs.map(item => ({
      key: "input:" + item.id,
      label: `${item.name} · ${item.image_count ? `${item.image_count} görsel` : lengthLabel(item.target_tokens)}`,
      imageCount: item.image_count,
    })) },
    { label: "Kayıtlı bağlamlar", options: contexts.map(item => ({
      key: "context:" + item.id, label: item.name,
    })) },
    { label: "Hazır örnekler", options: examples.map(item => ({
      key: "example:" + item.id, label: item.name,
    })) },
  ];
  const promptSourceKeys = new Set(promptSourceGroups.flatMap(group => group.options.map(option => option.key)));
  function navigate(next: Page) {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (next === "benchmark" ? "" : "#" + next),
    );
    setPage(next);
    setHistoric(null);
    setQuery("");
    setError("");
    setModelEdit(undefined);
    setContextEdit(undefined);
    if (next !== page) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
        document.getElementById("workspace-page-title")?.focus({ preventScroll: true });
      });
    }
  }
  function setPrompt(index: number, content: string, source = "", images?: MediaImage[]) {
    setPrompts((prev) => {
      const next = prev.slice();
      next[index] = content;
      return next;
    });
    setPromptSources((prev) => ({ ...prev, [index]: source }));
    if (images) setPromptImages(prev => ({ ...prev, [index]: images }));
  }
  function replaceActivePrompts(assignments: PromptAssignment[], previousCount = assignments.length) {
    setPrompts(prev => [...assignments.map(item => item.content), ...prev.slice(previousCount)]);
    setPromptSources(prev => ({
      ...shiftInactiveSlots(prev, previousCount, assignments.length),
      ...Object.fromEntries(assignments.map((item, index) => [index, item.source])),
    }));
    setPromptImages(prev => ({
      ...shiftInactiveSlots(prev, previousCount, assignments.length),
      ...Object.fromEntries(assignments.map((item, index) => [index, item.images ?? []])),
    }));
  }
  function fillPrompts(content: string, source = "", images: MediaImage[] = []) {
    replaceActivePrompts(effectivePrompts.map(() => ({content, source, images})));
  }
  function editRequestCount(value: string) {
    setRequestCountEdited(true);
    setRequestCount(value);
  }
  function setPreparedCount(count: number) {
    if (mode !== "single" || count > 1) setRequestCount(String(count));
    if (mode === "single" && count > 1) setMode("concurrent");
  }
  function prepareOcrInputs() {
    if (!repairedOcrCount || repairedOcrCount * modelFactor > MAX_CONCURRENT_REQUESTS) return;
    const assignments = effectivePrompts.flatMap((content, index): PromptAssignment[] => {
      const images = effectiveImages[index] ?? [];
      const source = promptSources[index] ?? "";
      if (images.length > 1) return images.map(image => ({content, source: "", images: [image]}));
      return images.length || content.trim() ? [{content, source, images}] : [];
    });
    replaceActivePrompts(assignments, effectivePrompts.length);
    setPreparedCount(assignments.length);
    setPromptPage(0);
    setToast(`OCR için ${assignments.length} istek kutusu hazırlandı.`);
  }
  function goToPrompt(index: number) {
    setPromptPage(Math.floor(index / REQUESTS_PER_PAGE));
    requestAnimationFrame(() => {
      const box = document.getElementById(`benchmark-input-${index}`);
      box?.focus({ preventScroll: true });
      box?.scrollIntoView({ block: "center" });
    });
  }
  function planVisualSplit(index: number, imageCount: number, saved?: {content: string; source: string}) {
    const maxSlots = Math.floor(MAX_CONCURRENT_REQUESTS / modelFactor);
    const slots: number[] = [];
    for (let slot = index; slot < maxSlots && slots.length < imageCount; slot++) {
      if (slot === index && saved) slots.push(slot);
      else if (!promptImages[slot]?.length && (slot === index || !prompts[slot]?.trim())) slots.push(slot);
    }
    if (slots.length !== imageCount)
      throw new Error("Görseller için yeterli boş istek kutusu yok. Daha erken bir kutu veya modeller için sırayla çalışma seçin.");
    const occupied = effectivePrompts.reduce((last, prompt, slot) =>
      prompt.trim() || effectiveImages[slot]?.length ? slot + 1 : last, 0);
    const retainedCount = hasOcrModel && !requestCountEdited ? occupied : effectivePrompts.length;
    const count = Math.max(retainedCount, slots[slots.length - 1] + 1);
    const text = saved?.content ?? prompts[index] ?? "";
    const source = saved?.source ?? "";
    return (images: MediaImage[], format: "pdf" | "images") => {
      setPrompts(prev => {
        const draft = prev.slice();
        for (const slot of slots) draft[slot] = text;
        return draft;
      });
      setPromptImages(prev => ({ ...prev, ...Object.fromEntries(images.map((image, i) => [slots[i], [image]])) }));
      setPromptSources(prev => ({ ...prev, ...Object.fromEntries(slots.map(slot => [slot, source])) }));
      if (count !== effectivePrompts.length) setPreparedCount(count);
      setPromptPage(Math.floor(slots[0] / REQUESTS_PER_PAGE));
      setToast(`${images.length} ${format === "pdf" ? "PDF sayfası" : "görsel"} ayrı istek kutularına eklendi.`);
    };
  }
  function checkOcrDistributionCount(count: number) {
    if (count * modelFactor > MAX_CONCURRENT_REQUESTS)
      throw new Error(`Model başına ${count} girdiyle toplam ${MAX_CONCURRENT_REQUESTS} eşzamanlı istek sınırı aşılır. Daha az görsel seçin veya modelleri sırayla çalıştırın.`);
  }
  async function distributePrompts(sources: string[]) {
    if (busy || running || inputCount === null || !sources.length) return;
    setBusy(true);
    setError("");
    try {
      const assignments = hasOcrModel ? sources : distributePromptSources(sources, inputCount);
      const uniqueSources = [...new Set(assignments)];
      const resolved = await Promise.all(uniqueSources.map(async source => {
        const [kind, id] = source.split(":", 2);
        const item = kind === "input"
          ? await api<SavedInput>("/inputs/" + encodeURIComponent(id))
          : { content: kind === "example"
            ? (await loadExample(id)).content
            : contexts.find(item => item.id === id)?.content, images: undefined };
        if (!item.content?.trim() && !item.images?.length)
          throw new Error("Seçilen kaynaklardan biri boş veya artık bulunamıyor. Kaynakları kontrol edin.");
        return [source, {content: item.content ?? "", source, images: item.images}] as const;
      }));
      if (hasOcrModel) {
        if (resolved.some(([, item]) => !item.images?.length))
          throw new Error("LightOnOCR için görsel içeren kaynaklar seçin.");
        const pages = resolved.flatMap(([, item]) =>
          (item.images ?? []).map(image => ({ ...item, images: [image] })));
        const count = Math.max(inputCount, pages.length);
        checkOcrDistributionCount(count);
        replaceActivePrompts(distributePromptSources(pages, count), effectivePrompts.length);
        setPreparedCount(count);
        setPromptPage(0);
        setToast(`${pages.length} görsel ${count} girdi kutusuna rastgele dağıtıldı.`);
        return;
      }
      const bySource = new Map(resolved);
      replaceActivePrompts(assignments.map(source => bySource.get(source)!));
      setPromptPage(0);
      setToast(`${uniqueSources.length} kaynak ${assignments.length} girdiye rastgele dağıtıldı.`);
    } finally {
      setBusy(false);
    }
  }
  async function refreshInputs() {
    const next = await api<SavedInputSummary[]>("/inputs");
    setPromptSources((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([, source]) => {
          if (!source.startsWith("input:")) return true;
          const id = source.slice(6);
          const before = savedInputs.find((item) => item.id === id);
          const after = next.find((item) => item.id === id);
          // Loaded text remains a copy. Clear its selection label if the archive version changed.
          return !!after && (!before || before.updated_at === after.updated_at);
        }),
      ),
    );
    setSavedInputs(next);
  }
  async function applySavedInput(id: string, target: number | "all") {
    if (running)
      throw new Error("Çalışan test tamamlanmadan girdiler değiştirilemez.");
    setBusy(true);
    try {
      const record = await api<SavedInput>("/inputs/" + id);
      const source = "input:" + id;
      const images = record.images ?? [];
      if (hasOcrModel && images.length > 1) {
        if (target === "all") {
          const count = Math.max(effectivePrompts.length, images.length);
          checkOcrDistributionCount(count);
          const assignments = Array.from({length: count}, (_, index) =>
            ({content: record.content, source, images: [images[index % images.length]]}));
          replaceActivePrompts(assignments, effectivePrompts.length);
          setPreparedCount(count);
          setPromptPage(0);
          setToast(`${images.length} görsel ${count} ayrı istek kutusuna eklendi.`);
        } else {
          planVisualSplit(target, images.length, {content: record.content, source})(images, "images");
        }
        navigate("benchmark");
        return;
      }
      if (target === "all") fillPrompts(record.content, source, images);
      else {
        setPrompt(target, record.content, source, images);
        setPromptPage(Math.floor(target / REQUESTS_PER_PAGE));
      }
      navigate("benchmark");
      setToast(
        `${record.name}, ${target === "all" ? "tüm girdilere" : `Girdi ${String(target + 1).padStart(2, "0")}'e`} yüklendi.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function choosePrompt(source: string, index: number) {
    setError("");
    if (source.startsWith("example:")) {
      setBusy(true);
      try { const item = await loadExample(source.slice(8)); setPrompt(index, item.content, source, []); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    } else if (source.startsWith("input:")) {
      setBusy(true);
      try {
        await applySavedInput(source.slice(6), index);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    } else {
      const context = contexts.find(
        (c) => c.id === source.replace("context:", ""),
      );
      if (context) setPrompt(index, context.content, source, []);
    }
  }
  async function loadExampleIntoAll(id: string) {
    if (!id || running || busy) return;
    setBusy(true); setError("");
    try {
      const item = await loadExample(id);
      fillPrompts(item.content, "example:" + id);
      setToast(`${item.name}, tüm etkin girdilere yüklendi. Henüz istek gönderilmedi.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function exampleDraft(id: string) {
    const item = await loadExample(id);
    setInputDraft({name: item.name, category: item.category, target_tokens: item.target_tokens, context: item.content, question: ""});
  }
  function archivePrompt(index: number) {
    navigate("inputs");
    setInputDraft({ context: prompts[index], question: "", target_tokens: 0, images: promptImages[index] });
  }
  function toggleModel(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev,
    );
  }
  async function testModel(id: string) {
    setTestingModel(id);
    setModelChecks(prev => { const next = {...prev}; delete next[id]; return next; });
    try {
      const result = await api<{ok: boolean; message: string; elapsed_s?: number}>(`/models/${id}/test`, 'POST', {});
      setModelChecks(prev => ({...prev, [id]: result}));
    } catch (e) {
      setModelChecks(prev => ({...prev, [id]: {ok: false, message: (e as Error).message}}));
    } finally { setTestingModel(null); }
  }
  async function start() {
    if (launchBlocker || busy || running) return;
    setBusy(true);
    setError("");
    try {
      const next = await fetchBenchmarkReport("/runs", "POST", {
        model_ids: selected,
        ...packBenchmarkInputs(effectivePrompts),
        prompt_images: effectiveImages,
        prompt_uuid_parts: promptUuidParts,
        mode,
        demo: false,
        max_tokens: outputLimit,
        temperature: temperatureValue,
        timeout: timeoutValue,
        reset_prefix_cache: false,
        model_schedule: schedule,
        stream,
        name,
      });
      setRun(next);
      sessionStorage.setItem("lab_run", next.id);
      setTimeout(
        () =>
          resultsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        100,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!run) return;
    try {
      setRun(await fetchBenchmarkReport(`/runs/${run.id}/stop`, "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function openReport(report: ReportSummary) {
    setBusy(true);
    try {
      setHistoric(await fetchBenchmarkReport("/runs/" + report.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteReport(report: Pick<Report, "id" | "name">) {
    if (!window.confirm(`“${report.name}” raporu silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    try {
      await api(`/reports/${report.id}`, "DELETE");
      setReports(prev => prev.filter(item => item.id !== report.id));
      if (historic?.id === report.id) setHistoric(null);
      if (run?.id === report.id) { setRun(null); sessionStorage.removeItem("lab_run"); }
      setToast("Rapor silindi.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(kind: "models" | "contexts", id: string) {
    try {
      await api(`/${kind}/${id}`, "DELETE");
      await load();
      setToast(kind === "models" ? "Model kaldırıldı." : "Bağlam kaldırıldı.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    await load();
    setModelChecks({});
    setModelEdit(undefined);
    setContextEdit(undefined);
    setToast("Değişiklikler kaydedildi.");
  }
  async function logout() {
    if (running) {
      setError(
        "Çıkış yapmadan önce çalışan testi durdurun veya tamamlanmasını bekleyin.",
      );
      return;
    }
    await api("/logout", "POST", {});
    setSession(false);
  }
  if (session === null)
    return (
      <div className="loading-screen">
        <Logo />
        <Loader2 className="spin" size={24} />
        <p>Çalışma alanı hazırlanıyor…</p>
      </div>
    );
  if (!session)
    return (
      <>
        <Login onLogin={() => setSession(true)} />
        {error && (
          <div className="connection-error" role="alert">
            Backend bağlantısı kurulamadı. Python sunucusunu 8787 portunda
            başlatın.
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">
            <FlaskConical size={16} />
          </span>
          <div>
            <b>Inference workspace</b>
            <small>Yerel geliştirme</small>
          </div>
          <span className="workspace-badge">DEV</span>
        </div>
        <div className="nav-label">ÇALIŞMA ALANI</div>
        <nav aria-label="Çalışma alanı">
          {(
            [
              ["benchmark", Gauge, "Benchmark"],
              ["reports", FileText, "Raporlar"],
              ["inputs", FileText, "Kayıtlı girdiler"],
              ["contexts", Database, "Bağlam kütüphanesi"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              className={page === id ? "active" : ""}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span className="nav-title">{label}</span>
              <span className="nav-short">
                {id === "contexts"
                  ? "Bağlam"
                  : id === "inputs"
                    ? "Girdiler"
                    : label}
              </span>
              {id === "reports" && reports.length > 0 && (
                <span className="nav-count">{reports.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label settings-label">YÖNETİM</div>
        <nav aria-label="Yönetim">
          <button
            className={page === "settings" ? "active" : ""}
            aria-label="Yönetici ayarları"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            <span className="nav-title">Yönetici ayarları</span>
            <span className="nav-short">Ayarlar</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className={`help-link${page === "guide" ? " active" : ""}`} aria-current={page === "guide" ? "page" : undefined} onClick={() => navigate("guide")}>
            <CircleHelp size={17} />
            Ölçüm rehberi
            <ArrowUpRight size={14} />
          </button>
          <div className="local-status">
            <span className="dot" />
            <span>
              Yerel çalışma alanı<small>Veriler bu cihazda saklanır</small>
            </span>
          </div>
          <div className="user">
            <div className="avatar">A</div>
            <span>
              <b>Admin</b>
              <small>Yönetici</small>
            </span>
            <button
              onClick={logout}
              className="icon-button"
              aria-label="Çıkış yap"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Çalışma alanı</span>
            <ChevronRight size={13} />
            <b>{page === "benchmark" ? "Benchmark" : titles[page]}</b>
          </div>
          <div className="topbar-right">
            <button className="icon-button theme-toggle" aria-label={dark ? "Açık temaya geç" : "Koyu temaya geç"} title={dark ? "Açık temaya geç" : "Koyu temaya geç"} onClick={() => setDark(!dark)}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="local-chip">
              <span className="dot" />
              Yerel
            </span>
            <span className="version">v0.1</span>
            <button
              className="icon-button mobile-tool"
              aria-label="Ölçüm rehberini aç"
              onClick={() => navigate("guide")}
            >
              <CircleHelp size={16} />
            </button>
            <button
              className="icon-button mobile-tool"
              aria-label="Çıkış yap"
              onClick={logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1 id="workspace-page-title" tabIndex={-1}>{historic ? "Rapor detayları" : titles[page]}</h1>
              <p>
                {page === "benchmark"
                  ? "Modellerini aynı girdilerle karşılaştır. Tek istekte ve yük altında farkı ölç."
                  : page === "reports"
                    ? "Her koşu kaydedilir. Önceki ölçümlere dön, sonuçları birlikte değerlendir."
                    : page === "contexts"
                      ? "Referans metinlerini sakla ve farklı sorularla yeniden kullan."
                      : page === "inputs"
                        ? "Metin, soru ve görselleri bir girdi olarak sakla ve Benchmark’ta tekrar kullan."
                        : page === "guide"
                          ? "Metriklerin nasıl hesaplandığını, örneklerini ve ölçüm sınırlarını incele."
                          : "Model sağlayıcılarını bağla ve karşılaştırmaya hazır hale getir."}
              </p>
            </div>
            {page === "settings" && modelEdit === undefined ? (
              <button
                className="button primary"
                onClick={() => setModelEdit(null)}
              >
                <Plus size={17} /> Model ekle
              </button>
            ) : page === "contexts" && contextEdit === undefined ? (
              <button
                className="button primary"
                onClick={() => setContextEdit(null)}
              >
                <Plus size={17} /> Bağlam ekle
              </button>
            ) : null}
          </div>
          {page === "guide" && <MetricGuide />}
          {error && (
            <div className="error-message global-error" role="alert">
              <span>{error}</span>
              <button
                aria-label="Hata mesajını kapat"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "benchmark" && (
            <>
              <section className="setup-panel" aria-label="Benchmark hazırlığı">
                <div className="setup-top">
                  <h2 id="benchmark-mode">Test türü</h2>
                  <div className="segmented mode-tabs" role="group" aria-labelledby="benchmark-mode">
                    {([
                      ["single", "Tek istek", "Her modele bir girdi", Zap],
                      ["concurrent", "Eşzamanlı yük", "Girdileri birlikte gönder", Layers3],
                      ["compare", "Seri ve eşzamanlı", "Aynı girdileri iki fazda ölç", Activity],
                    ] as const).map(([id, label, description, Icon]) => (
                        <button
                          disabled={running || busy}
                          className={mode === id ? "active" : ""}
                          aria-pressed={mode === id}
                          key={id}
                          onClick={() => setMode(id)}
                        >
                          <Icon size={18} aria-hidden="true" />
                          <span><b>{label}</b><small>{description}</small></span>
                        </button>
                    ))}
                  </div>
                  <ModeExplanation mode={mode} count={effectivePrompts.length} schedule={schedule} />
                </div>
                <div className="setup-content">
                  <div className="block-heading">
                    <div className="block-title">
                      <h2>Modeller</h2>
                      <span className="muted">
                        {selected.length} / 4 seçildi
                      </span>
                    </div>
                    {!!models.length && <button
                      className="text-button"
                      disabled={running || busy}
                      onClick={() => navigate("settings")}
                    >
                      Modelleri yönet
                      <ArrowUpRight size={15} />
                    </button>}
                  </div>
                  <div className="model-grid">
                    {models.map((m) => (
                      <button
                        key={m.id}
                        className={`model-choice ${selected.includes(m.id) ? "selected" : ""}`}
                        style={
                          { "--model-color": m.color } as React.CSSProperties
                        }
                        onClick={() => toggleModel(m.id)}
                        disabled={
                          running || busy ||
                          (!selected.includes(m.id) && selected.length >= 4)
                        }
                        aria-pressed={selected.includes(m.id)}
                      >
                        <div className="model-choice-top">
                          <span className="model-symbol">
                            <Layers3 size={17} />
                          </span>
                          <span
                            className={`check-box ${selected.includes(m.id) ? "checked" : ""}`}
                          >
                            {selected.includes(m.id) && <Check size={12} />}
                          </span>
                        </div>
                        <b>{m.name}</b>
                        <span className="model-id" title={m.model}>
                          {m.model}
                        </span>
                        <div className="model-choice-bottom">
                          <span>
                            <i className="dot" />
                            {requiresSingleImage(m) ? "LightOnOCR · 1 görsel / istek" : m.input_format === "vision" ? "Vision" : "OpenAI uyumlu"}
                          </span>
                        </div>
                      </button>
                    ))}
                    {!models.length && (
                      <div className="empty-state">
                        <Layers3 size={25} />
                        <p>Henüz model yok.</p>
                        <button
                          className="button"
                          onClick={() => navigate("settings")}
                        >
                          İlk modeli ekle
                        </button>
                      </div>
                    )}
                  </div>
                  {!!models.length && <div className="model-notice">
                    <label>
                      Modellerin çalışma sırası
                      <select
                        value={schedule}
                        disabled={running || busy}
                        onChange={(e) => setSchedule(e.target.value)}
                      >
                        <option value="sequential">Sırayla çalışsın</option>
                        <option value="parallel">Aynı anda çalışsın</option>
                      </select>
                    </label>
                    <small>{schedule === "parallel" ? "Seçilen modeller her fazda birlikte başlar." : "Her model önceki modelin fazı bittiğinde başlar."}</small>
                  </div>}
                  <div className="input-section">
                    <div className="block-heading">
                      <div className="block-title">
                        <h2>İstek girdileri</h2>
                        <span className="muted">
                          {readyCount.toLocaleString("tr-TR")} / {effectivePrompts.length.toLocaleString("tr-TR")} hazır
                        </span>
                      </div>
                      <div className="input-actions">
                        {effectivePrompts.length > 1 && (
                          <button type="button" className="text-button"
                            disabled={running || busy || (hasOcrModel ? promptImages[0]?.length !== 1 : !effectivePrompts[0].trim() && !promptImages[0]?.length)}
                            onClick={() => fillPrompts(effectivePrompts[0], promptSources[0], promptImages[0])}>
                            İlk girdiyi tümüne kopyala
                          </button>
                        )}
                        {!hasOcrModel && <select aria-label="Tüm etkin girdilere örnek prompt yükle" title="32K / 64K etiketleri hedef uzunluktur. Gerçek token sayısı modelin tokenizer’ına bağlıdır." value="" disabled={running || busy || !examples.length} onChange={e => void loadExampleIntoAll(e.target.value)}>
                          <option value="">Tüm girdilere örnek yükle</option>
                          {examples.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>}
                        <button
                          className="icon-button"
                          title="Girdileri boşalt"
                          aria-label="Tüm girdileri boşalt"
                          disabled={running || busy}
                          onClick={() => {
                            setPrompts([]);
                            setPromptSources({});
                            setPromptImages({});
                            setToast("");
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {mode !== "single" && <div className="input-config">
                        <div className="request-controls">
                          <div className="count-control">
                            <span>Hızlı seçim</span>
                            {[1, 2, 4, 8, 16, 24, 64, 128, 256, 512, MAX_CONCURRENT_REQUESTS].map(n => (
                              <button type="button" key={n} disabled={running || busy}
                                className={inputCount === n ? "active" : ""}
                                aria-pressed={inputCount === n}
                                onClick={() => editRequestCount(String(n))}>{n}</button>
                            ))}
                          </div>
                          <RequestCount label="Model başına istek" value={requestCount}
                            onChange={editRequestCount} disabled={running || busy} />
                          {overParallelLimit && (
                            <small className="request-limit" role="status">
                              {parallelCount.toLocaleString("tr-TR")} eşzamanlı istek seçili. Sınır 1.024. Girdi sayısını azalt veya modelleri sırayla çalıştır.
                            </small>
                          )}
                        </div>
                    </div>}
                    {!hasOcrModel && (
                      <details className="uuid-settings">
                        <summary>
                          <Fingerprint size={16} aria-hidden="true" />
                          UUID konumları
                          <small>{promptUuidParts.map(part => `${part}/4`).join(", ")}</small>
                          <ChevronDown size={15} aria-hidden="true" />
                        </summary>
                        <fieldset disabled={running || busy} aria-describedby="uuid-position-help">
                          <legend>Metin isteğindeki ekleme noktaları</legend>
                          <p id="uuid-position-help">Her metin isteğinde seçili noktalara yeni birer UUID eklenir. Konumlar metnin karakter uzunluğuna göre belirlenir. Görselli girdiler kendi içeriğiyle gönderilir.</p>
                          <div className="uuid-positions">
                            {promptUuidPositions.map((label, index) => {
                              const part = index + 1;
                              return (
                                <label key={part}>
                                  <input type="checkbox" checked={promptUuidParts.includes(part)} disabled={part === 1}
                                    onChange={e => {
                                      const checked = e.target.checked;
                                      setPromptUuidParts(parts => checked
                                        ? [...parts, part].sort((a, b) => a - b)
                                        : parts.filter(value => value !== part));
                                    }} />
                                  <span><b>{part}/4</b><small>{label}</small></span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </details>
                    )}
                    {(mode !== "single" || hasOcrModel) && (
                      <PromptDistribution
                        groups={promptSourceGroups}
                        count={effectivePrompts.length}
                        disabled={running || busy || inputCount === null}
                        prefersOcr={hasOcrModel}
                        maxCount={Math.floor(MAX_CONCURRENT_REQUESTS / modelFactor)}
                        onDistribute={distributePrompts}
                      />
                    )}
                    {invalidOcrInputs && (
                      <div className="ocr-input-notice">
                        <div role="status">
                          <b>LightOnOCR · Her kutuya bir görsel</b>
                          <p>{[
                            missingOcrImages ? `${missingOcrImages} kutuda görsel yok` : "",
                            multiImageOcrSlots ? `${multiImageOcrSlots} kutuda birden fazla görsel var` : "",
                          ].filter(Boolean).join(" · ")}.</p>
                          {(blankOcrSlots > 0 || multiImageOcrSlots > 0) && repairedOcrCount * modelFactor > MAX_CONCURRENT_REQUESTS && (
                            <p>Düzenleme toplam {MAX_CONCURRENT_REQUESTS} eşzamanlı istek sınırını aşar. Model sayısını azaltın veya modelleri sırayla çalıştırın.</p>
                          )}
                        </div>
                        <div className="ocr-input-actions">
                          <button className="button small-button" type="button" onClick={() => goToPrompt(ocrIssues[0].index)}>
                            Girdi {ocrIssues[0].index + 1} kutusuna git
                          </button>
                          {!!repairedOcrCount && (blankOcrSlots > 0 || multiImageOcrSlots > 0) && (
                            <button className="button small-button" type="button" onClick={prepareOcrInputs}
                              disabled={running || busy || inputCount === null || repairedOcrCount * modelFactor > MAX_CONCURRENT_REQUESTS}>
                              {multiImageOcrSlots ? (blankOcrSlots ? "Boşları kaldır ve görselleri ayır" : "Görselleri ayrı kutulara ayır") : "Boş kutuları kaldır"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <RequestPage label="Girdi aralığı" total={effectivePrompts.length} page={shownPromptPage} onChange={setPromptPage} />
                    <div className="prompt-grid">
                      {visiblePrompts.map(({prompt, index: i}) => (
                        <div className="prompt-box" id={`benchmark-input-${i}`} key={i} tabIndex={-1} aria-label={`Girdi ${i + 1}`}>
                          <div className="prompt-header">
                            <span>
                              <span className="prompt-number">
                                {String(i + 1).padStart(2, "0")}
                              </span>{" "}
                              Girdi
                            </span>
                            <select
                              aria-label={`Girdi ${i + 1} için kayıtlı girdi veya bağlam`}
                              disabled={running || busy}
                              value={promptSourceKeys.has(promptSources[i]) ? promptSources[i] : ""}
                              onChange={(e) => {
                                void choosePrompt(e.target.value, i);
                              }}
                            >
                              <option value="">
                                Girdi / bağlam / örnek seç
                              </option>
                              {promptSourceGroups.filter(group => group.options.length).map(group => (
                                <optgroup key={group.label} label={group.label}>
                                  {group.options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <textarea
                            aria-label={`Girdi ${i + 1} metni`}
                            value={prompt}
                            readOnly={running || busy}
                            onChange={(e) => setPrompt(i, e.target.value)}
                            placeholder={hasOcrModel ? "İsteğe bağlı görev metni" : "Metin yaz veya kayıtlı bir girdi seç…"}
                          />
                          <VisualInput label={`Girdi ${i + 1} için görsel veya PDF sayfası ekle`}
                            images={promptImages[i] ?? []} disabled={running || busy} onBusyChange={setBusy}
                            singleImage={hasOcrModel} showPreview planVisualSplit={count => planVisualSplit(i, count)}
                            onChange={images => {
                              setPromptImages(prev => ({ ...prev, [i]: images }));
                              setPromptSources(prev => ({ ...prev, [i]: "" }));
                            }} />
                          {hasOcrModel && promptImages[i]?.length !== 1 && (
                            <small className="ocr-slot-issue request-limit">{promptImages[i]?.length ? `${promptImages[i].length} görsel var. LightOnOCR bu kutuda bir görsel bekliyor.` : "Bu kutuda görsel yok."}</small>
                          )}
                          <div className="prompt-footer">
                            <span>
                              {prompt.length.toLocaleString("tr-TR")} karakter
                            </span>
                            <button
                              className="prompt-save"
                              disabled={running || busy || (!prompt.trim() && !promptImages[i]?.length)}
                              onClick={() => archivePrompt(i)}
                              aria-label={`Girdi ${i + 1} arşive kaydet`}
                            >
                              <Plus size={11} />
                              Girdiyi kaydet
                            </button>
                            <span title="Token tahmini karakter sayısı / 3; gerçek token sayısı sağlayıcıdan gelir.">
                              ~
                              {Math.ceil(prompt.length / 3).toLocaleString(
                                "tr-TR",
                              )}{" "}
                              token <CircleHelp size={11} />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <details className="generation-panel">
                    <summary><Settings2 size={16} aria-hidden="true" /> Üretim ayarları <ChevronDown size={15} aria-hidden="true" /></summary>
                    <div className="generation-settings">
                    <label>
                      Çıktı limiti
                      <span>
                        <input
                          type="number"
                          min="1"
                          max="32768"
                          value={maxTokens}
                          aria-invalid={!validOutputLimit}
                          disabled={running || busy}
                          placeholder={String(defaultMaxTokens)}
                          onChange={(e) => setMaxTokens(e.target.value)}
                        />
                        <small>token</small>
                      </span>
                    </label>
                    <label>
                      Temperature
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={temperature}
                        aria-invalid={!validTemperature}
                        disabled={running || busy}
                        placeholder="0.1"
                        onChange={(e) => setTemperature(e.target.value)}
                      />
                    </label>
                    <label>
                      Zaman aşımı
                      <span>
                        <input
                          type="number"
                          min="1"
                          max="600"
                          value={timeout}
                          aria-invalid={!validTimeout}
                          disabled={running || busy}
                          placeholder="120"
                          onChange={(e) => setTimeoutValue(e.target.value)}
                        />
                        <small>sn</small>
                      </span>
                    </label>
                    <label>
                      Yanıt biçimi
                      <select value={stream ? "stream" : "normal"} disabled={running || busy} onChange={(e) => setStream(e.target.value === "stream")}>
                        <option value="stream">Stream · geldikçe göster</option>
                        <option value="normal">Normal · tamamlanınca göster</option>
                      </select>
                    </label>
                    <label className="run-name">
                      Koşu adı <small>isteğe bağlı</small>
                      <input
                        value={name}
                        disabled={running || busy}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Örn. 16K · 4 concurrent"
                      />
                    </label>
                    </div>
                    <p className="generation-defaults">Varsayılanlar {defaultMaxTokens.toLocaleString("tr-TR")} token, temperature 0,1 ve 120 sn. Seçtiğin ayarlar tüm modellere uygulanır.</p>
                    <p className="cache-note">Prefix cache sıfırlama vLLM geliştirme modu gerektirir.</p>
                  </details>
                </div>
                <div className="launch-bar">
                  <div className="launch-plan">
                    <dl className="launch-counts">
                      <div><dt>Model başına girdi</dt><dd>{inputCount?.toLocaleString("tr-TR") ?? "—"}</dd></div>
                      <div><dt>Toplam API isteği</dt><dd>{inputCount === null ? "—" : totalRequests.toLocaleString("tr-TR")}</dd></div>
                      <div><dt>En çok eşzamanlı</dt><dd className={overParallelLimit ? "request-limit" : undefined}>{inputCount === null ? "—" : parallelCount.toLocaleString("tr-TR")}</dd></div>
                    </dl>
                    <p className="launch-config">
                      {validOutputLimit ? outputLimit.toLocaleString("tr-TR") : "—"} token · Temperature {validTemperature ? temperatureValue.toLocaleString("tr-TR") : "—"} · {validTimeout ? timeoutValue.toLocaleString("tr-TR") : "—"} sn zaman aşımı · {stream ? "Stream" : "Normal yanıt"}
                    </p>
                    {launchBlocker && <p id="launch-blocker" className="launch-blocker" role="status">{launchBlocker}</p>}
                  </div>
                  <button
                    className="button primary launch-button"
                    aria-describedby={launchBlocker ? "launch-blocker" : undefined}
                    disabled={busy || running || !!launchBlocker}
                    onClick={start}
                  >
                    {busy || running ? (
                      <Loader2 size={17} className="spin" />
                    ) : (
                      <Play size={17} />
                    )}{" "}
                    {running ? "Test çalışıyor" : "Karşılaştırmayı başlat"}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </section>
              <div ref={resultsRef}>
                {run && <Results key={run.id} run={run} onStop={stop} />}
              </div>
            </>
          )}
          {page === "reports" &&
            (historic ? (
              <>
                <button
                  className="text-button back-link"
                  onClick={() => setHistoric(null)}
                >
                  <ArrowLeft size={16} />
                  Tüm raporlara dön
                </button>
                <Results
                  key={historic.id}
                  run={historic}
                  historical
                  onStop={stop}
                />
              </>
            ) : (
              <section className="list-panel">
                <div className="list-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Rapor ara"
                      placeholder="Koşu adı veya model ara…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Rapor türünü filtrele"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Tüm koşular</option>
                    <option value="real">Gerçek API</option>
                    <option value="demo">Demo</option>
                  </select>
                  <span className="muted">{reports.length} kayıtlı koşu</span>
                </div>
                {reports.length ? (
                  <div className="table-scroll">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>Koşu</th>
                          <th>Modeller</th>
                          <th>Yük</th>
                          <th>Tarih</th>
                          <th>Durum</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {reports
                          .filter(
                            (r) =>
                              (filter === "all" ||
                                (filter === "demo") === r.config.demo) &&
                              `${r.name} ${r.models.map((m) => m.name).join(" ")}`
                                .toLocaleLowerCase("tr")
                                .includes(query.toLocaleLowerCase("tr")),
                          )
                          .map((r) => (
                            <tr key={r.id}>
                              <td>
                                <button
                                  className="report-name"
                                  disabled={busy}
                                  onClick={() => openReport(r)}
                                >
                                  {r.name}
                                </button>
                                <small>
                                  {r.config.demo ? "Demo · " : ""}
                                  {r.id.slice(0, 8)}
                                </small>
                              </td>
                              <td>
                                <div className="report-models">
                                  {r.models.map((m) => (
                                    <span key={m.id}>
                                      <i style={{ background: m.color }} />
                                      {m.name}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>
                                {r.config.prompt_count} istek
                                <small>
                                  {r.config.mode === "compare"
                                    ? "Seri + concurrent"
                                    : r.config.mode === "single"
                                      ? "Tek istek"
                                      : "Concurrent"}
                                </small>
                              </td>
                              <td>{date(r.created_at)}</td>
                              <td>
                                <span className={`status ${r.status}`}>
                                  <span className="dot" />
                                  {statusLabels[r.status]}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                <button
                                  aria-label={`${r.name} raporunu aç`}
                                  className="icon-button"
                                  disabled={busy}
                                  onClick={() => openReport(r)}
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                                <button aria-label={`${r.name} raporunu sil`} title="Raporu sil" className="icon-button" disabled={busy || active(r)} onClick={() => deleteReport(r)}><Trash2 size={17} /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!reports.some(
                      (r) =>
                        (filter === "all" ||
                          (filter === "demo") === r.config.demo) &&
                        `${r.name} ${r.models.map((m) => m.name).join(" ")}`
                          .toLocaleLowerCase("tr")
                          .includes(query.toLocaleLowerCase("tr")),
                    ) && (
                      <div className="empty-state">
                        <Search size={26} />
                        <h3>Eşleşen rapor yok</h3>
                        <p>Arama terimini veya filtreyi değiştir.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    <FileText size={32} />
                    <h3>İlk raporun burada seni bekliyor</h3>
                    <p>
                      Bir test tamamlandığında sonuçları otomatik kaydedilir.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => navigate("benchmark")}
                    >
                      Benchmark oluştur
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </section>
            ))}
          {page === "settings" &&
            (modelEdit !== undefined ? (
              <ModelForm
                key={modelEdit?.id || "new"}
                model={modelEdit}
                sharedCaConfigured={sharedCaConfigured}
                onSave={save}
                onClose={() => setModelEdit(undefined)}
              />
            ) : (
              <>
                <SharedCaForm
                  configured={sharedCaConfigured}
                  onSave={configured => {
                    setSharedCaConfigured(configured);
                    setModelChecks({});
                    setToast(configured ? "Ortak CA sertifikası kaydedildi." : "Ortak CA sertifikası kaldırıldı.");
                  }}
                />
                <section className="list-panel">
                  <div className="panel-title">
                    <h2>Model sağlayıcıları</h2>
                    <span>{models.length} model</span>
                  </div>
                  <p className="model-test-help">Bağlantıyı test et, kayıtlı modele kısa bir gerçek istek gönderir; sağlayıcıya göre ücret veya kota kullanabilir.</p>
                  <div className="table-scroll">
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>API URL</th>
                          <th>Anahtar</th>
                          <th>Tür</th>
                          <th>İşlemler</th>
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <div className="model-table-name">
                                <i style={{ background: m.color }} />
                                <b>{m.name}</b>
                              </div>
                              <small>{m.model}</small>
                            </td>
                            <td>
                              <code>{m.base_url || "Henüz bağlanmadı"}</code>
                              <small>
                                {m.metrics_url
                                  ? "Metrics yapılandırıldı"
                                  : "Metrics URL yok"}
                              </small>
                              {m.has_ca_certificate && <small>Özel CA sertifikası kayıtlı</small>}
                              {sharedCaConfigured && <small>Ortak CA {m.use_shared_ca === false ? "kapalı" : "açık"}</small>}
                            </td>
                            <td>
                              <span className="key-status">
                                <ShieldCheck size={14} />
                                {m.has_key ? "Kayıtlı" : "Yok"}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`type-tag ${m.demo ? "" : "real"}`}
                              >
                                OpenAI uyumlu
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button className="button small-button" disabled={testingModel !== null} onClick={() => testModel(m.id)}>
                                  {testingModel === m.id ? "Test ediliyor…" : "Bağlantıyı test et"}
                                </button>
                                <button
                                  className="button small-button"
                                  onClick={() => setModelEdit(m)}
                                >
                                  Düzenle
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`${m.name} modelini kaldır`}
                                  onClick={() => remove("models", m.id)}
                                  disabled={running || busy}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              {modelChecks[m.id] && <small role="status" className={modelChecks[m.id].ok ? "model-test-success" : "model-test-error"}>
                                {modelChecks[m.id].message}{modelChecks[m.id].elapsed_s !== undefined ? ` · ${modelChecks[m.id].elapsed_s} sn` : ""}
                              </small>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <div className="settings-info">
                  <ShieldCheck size={19} />
                  <div>
                    <h3>Anahtarlar sunucuda tutulur</h3>
                    <p>
                      API anahtarları yalnızca uygulama kullanıcısının okuyabildiği
                      dosyalarda tutulur; şifrelenmez ve raporlara eklenmez.
                      Bu ilk sürümde yönetici hesabı admin / admin;
                      sunucu ortam değişkenleriyle değiştirilebilir.
                    </p>
                  </div>
                </div>
              </>
            ))}
          {page === "inputs" && (
            <SavedInputs
              examples={examples}
              onExample={exampleDraft}
              items={savedInputs}
              draft={inputDraft}
              onDraftUsed={() => setInputDraft(null)}
              onRefresh={refreshInputs}
              onApply={applySavedInput}
              slots={effectivePrompts.length}
              prefersOcr={hasOcrModel}
              running={running}
              onMessage={setToast}
            />
          )}
          {page === "contexts" &&
            (contextEdit !== undefined ? (
              <ContextForm
                key={contextEdit?.id || "new"}
                context={contextEdit}
                onSave={save}
                onClose={() => setContextEdit(undefined)}
              />
            ) : (
              <section className="list-panel">
                <div className="list-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Bağlam ara"
                      placeholder="Bağlam veya kategori ara…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <span className="muted">{contexts.length} hazır bağlam</span>
                </div>
                <div className="context-list">
                  {contexts
                    .filter((c) =>
                      `${c.name} ${c.category}`
                        .toLocaleLowerCase("tr")
                        .includes(query.toLocaleLowerCase("tr")),
                    )
                    .map((c) => (
                      <article key={c.id}>
                        <div className="context-symbol">
                          <FileText size={22} />
                        </div>
                        <div className="context-content">
                          <h3>
                            {c.name}
                            <span>{c.category}</span>
                          </h3>
                          <p>{c.content}</p>
                          <small>
                            {c.content.length.toLocaleString("tr-TR")} karakter
                            · ~
                            {Math.ceil(c.content.length / 3).toLocaleString(
                              "tr-TR",
                            )}{" "}
                            token (tahmini)
                          </small>
                        </div>
                        <div className="row-actions">
                          <button
                            className="button small-button"
                            onClick={() => {
                              fillPrompts(c.content, "context:" + c.id);
                              navigate("benchmark");
                              setToast("Bağlam tüm girdilere uygulandı.");
                            }}
                          >
                            Testte kullan
                            <ArrowRight size={14} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${c.name} bağlamını düzenle`}
                            onClick={() => setContextEdit(c)}
                          >
                            <Settings2 size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${c.name} bağlamını kaldır`}
                            onClick={() => remove("contexts", c.id)}
                            disabled={running || busy}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  {!contexts.some((c) =>
                    `${c.name} ${c.category}`
                      .toLocaleLowerCase("tr")
                      .includes(query.toLocaleLowerCase("tr")),
                  ) && (
                    <div className="empty-state">
                      <Database size={28} />
                      <h3>Bağlam bulunamadı</h3>
                      <p>Yeni bir bağlam ekle veya arama terimini değiştir.</p>
                    </div>
                  )}
                </div>
              </section>
            ))}
          <footer className="main-footer">
            <span>
              Inference Lab <span>·</span> Daha iyi kararlar, ölçülen veriler.
            </span>
            <span>Yerel geliştirme sürümü</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
