import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  FlaskConical,
  Gauge,
  Layers3,
  Loader2,
  LogOut,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import { DurationTests } from "./DurationTests";
import { ResponseComparison } from "./ResponseComparison";
import { ModeExplanation } from "./ModeExplanation";
import { PerformanceChart as Chart } from "./PerformanceChart";
import { api } from "./api";
import {
  SavedInputs,
  type SavedInput,
  type SavedInputSummary,
  type InputDraft,
  lengthLabel,
} from "./SavedInputs";
import "./saved-inputs.css";

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
};
type Context = { id: string; name: string; category: string; content: string };
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
type Page = "duration" | "benchmark" | "reports" | "contexts" | "inputs" | "settings";
const titles: Record<Page, string> = {
  benchmark: "Model karşılaştırma",
  duration: "Süreli test",
  reports: "Kayıtlı raporlar",
  contexts: "Bağlam kütüphanesi",
  inputs: "Kayıtlı girdiler",
  settings: "Yönetici ayarları",
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
const active = (run: Report | null) =>
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

function RequestMatrix({ phase }: { phase: Phase }) {
  return (
    <div className="request-matrix">
      <h3>Girdi bazında karşılaştırma</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Girdi</th>
              {phase.models.map((m) => (
                <th colSpan={5} key={m.id}>
                  <div>
                    <i style={{ background: m.color }} />
                    {m.name}
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              {phase.models.flatMap((m) =>
                [
                  "Giriş tok",
                  "İlk token sn",
                  "Akış tok/sn¹",
                  "E2E sn",
                  "Çıktı tok",
                ].map((label) => <th key={m.id + label}>{label}</th>),
              )}
            </tr>
          </thead>
          <tbody>
            {phase.models[0]?.requests.map((request, i) => (
              <tr key={i}>
                <td>
                  <b>#{String(i + 1).padStart(2, "0")}</b>
                </td>
                {phase.models.flatMap((m) => {
                  const row = m.requests[i];
                  return (
                    [
                      "input_tokens",
                      "ttft_s",
                      "stream_tps",
                      "e2e_s",
                      "output_tokens",
                    ] as const
                  ).map((key) => (
                    <td
                      key={m.id + key}
                      title={row.error || statusLabels[row.status]}
                    >
                      {fmt(row[key], key.includes("tokens") ? 0 : 2)}
                    </td>
                  ));
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
                <button onClick={() => window.print()}>PDF / Yazdır</button>
              </div>
            </details>
          )}
        </div>
      </div>
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
        <div className="tabs">
          {[
            ["summary", "Genel bakış"],
            ["answers", "Cevaplar"],
            ["requests", "İstek detayları"],
            ["method", "Ölçüm bilgileri"],
          ].map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {phases.length > 1 && (
          <div className="segmented compact">
            {phases.map((p, i) => (
              <button
                key={p.name}
                className={phaseIndex === i ? "active" : ""}
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
              <div className="progress-track">
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
          <div className="table-heading">
            <h3>Metrik karşılaştırması</h3>
            <label className="inline-label">
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
            </label>
          </div>
          <div className="table-scroll">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Metrik</th>
                  {phase.models.map((m) => (
                    <th key={m.id}>
                      <div>
                        <i style={{ background: m.color }} />
                        {m.name}
                      </div>
                      <small>
                        {m.summary
                          ? `${m.summary.completed} / ${m.summary.total} başarılı`
                          : statusLabels[m.status]}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map(([key, label, unit, higher]) => (
                  <tr key={key}>
                    <td>
                      {label}
                      <small>
                        {[
                          "output_tokens",
                          "input_tokens",
                          "drafted_per_step",
                          "acceptance_pct",
                        ].includes(key)
                          ? ""
                          : higher
                            ? "Yüksek daha iyi"
                            : "Düşük daha iyi"}
                      </small>
                    </td>
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
        <ResponseComparison phase={phase} prompts={run.config.prompts} stream={run.config.stream !== false} />
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
              Başarılı istekler üzerinde doğrusal interpolasyon. 1–8 örneklik
              ilk sürüm; istatistiksel genelleme için tekrarlı koşular gerekir.
            </dd>
            <dt>Draft / kabul</dt>
            <dd>
              Yapılandırılan Prometheus metrics URL’sinin koşu öncesi ve sonrası
              sayaç farkları. Sunucu trafiği ve yayın gecikmesi sonucu
              etkileyebilir.
            </dd>
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

function ModelForm({
  model,
  onSave,
  onClose,
}: {
  model: Model | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    id: model?.id,
    name: model?.name || "",
    provider: model?.provider || "OpenAI uyumlu",
    model: model?.model || "",
    base_url: model?.base_url || "",
    api_key: "",
    metrics_url: model?.metrics_url || "",
    clear_key: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: string | boolean) =>
    setForm({ ...form, [key]: value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
            Sağlayıcı
            <input
              value={form.provider}
              onChange={(e) => update("provider", e.target.value)}
              placeholder="Örn. vLLM / CBOT"
              required
            />
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
            Sağlayıcı API URL
            <input
              type="url"
              value={form.base_url}
              onChange={(e) => update("base_url", e.target.value)}
              placeholder="http://127.0.0.1:8000/v1"
              required
            />
            <small>
              /v1/chat/completions yolu otomatik eklenir. /v1 ile veya olmadan
              yazabilirsiniz.
            </small>
          </label>
          <label className="full">
            API anahtarı
            <input
              type="password"
              autoComplete="new-password"
              value={form.api_key}
              onChange={(e) => update("api_key", e.target.value)}
              placeholder={
                model?.has_key
                  ? "Kayıtlı anahtarı korumak için boş bırakın"
                  : "Anahtar gerekmiyorsa boş bırakın"
              }
            />
            <small>
              Anahtar sunucuda şifrelenir; tarayıcıya geri gönderilmez.
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
  const [session, setSession] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>(() => {
    const value = window.location.hash.slice(1);
    return ["benchmark", "duration", "reports", "contexts", "inputs", "settings"].includes(
      value,
    )
      ? (value as Page)
      : "benchmark";
  });
  const [models, setModels] = useState<Model[]>([]);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [savedInputs, setSavedInputs] = useState<SavedInputSummary[]>([]);
  const [inputDraft, setInputDraft] = useState<InputDraft | null>(null);
  const [promptSources, setPromptSources] = useState<Record<number, string>>(
    {},
  );
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>(["", "", "", ""]);
  const [mode, setMode] = useState("concurrent");
  const [demo, setDemo] = useState(true);
  const [stream, setStream] = useState(true);
  const [schedule, setSchedule] = useState("sequential");
  const [maxTokens, setMaxTokens] = useState(512);
  const [temperature, setTemperature] = useState(0);
  const [timeout, setTimeoutValue] = useState(120);
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
  const [help, setHelp] = useState(false);
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
    const [m, c, r, saved] = await Promise.all([
      api<Model[]>("/models"),
      api<Context[]>("/contexts"),
      api<Report[]>("/reports"),
      api<SavedInputSummary[]>("/inputs"),
    ]);
    setModels(m);
    setContexts(c);
    setReports(r);
    setSavedInputs(saved);
    setSelected((prev) =>
      prev.length
        ? prev.filter((id) => m.some((model) => model.id === id))
        : m.slice(0, 2).map((model) => model.id),
    );
    if (initial.current) {
      initial.current = false;
      if (c[0]) setPrompts(Array(4).fill(c[0].content));
      const current = r.find(active);
      const id = current?.id || sessionStorage.getItem("lab_run");
      if (id) {
        try {
          setRun(await api<Report>("/runs/" + id));
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
        const next = await api<Report>("/runs/" + run!.id);
        if (stopped) return;
        setRun(next);
        if (active(next)) timer = setTimeout(poll, 400);
        else {
          setToast("Test sonuçları raporlara kaydedildi.");
          api<Report[]>("/reports")
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
  const effectivePrompts = mode === "single" ? prompts.slice(0, 1) : prompts;
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
  }
  function count(n: number) {
    setPrompts((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? ""));
    setPromptSources((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => Number(key) < n),
      ),
    );
  }
  function setPrompt(index: number, content: string, source = "") {
    setPrompts((prev) => prev.map((p, i) => (i === index ? content : p)));
    setPromptSources((prev) => ({ ...prev, [index]: source }));
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
      if (target === "all") {
        setPrompts((prev) =>
          prev.map((p, i) => (mode === "single" && i > 0 ? p : record.content)),
        );
        setPromptSources(
          Object.fromEntries(
            effectivePrompts.map((_, i) => [i, "input:" + id]),
          ),
        );
      } else setPrompt(target, record.content, "input:" + id);
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
    if (source.startsWith("input:")) {
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
      if (context) setPrompt(index, context.content);
    }
  }
  function archivePrompt(index: number) {
    navigate("inputs");
    setInputDraft({ context: prompts[index], question: "", target_tokens: 0 });
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
  async function start() {
    setBusy(true);
    setError("");
    try {
      const next = await api<Report>("/runs", "POST", {
        model_ids: selected,
        prompts: effectivePrompts,
        mode,
        demo,
        max_tokens: maxTokens,
        temperature,
        timeout,
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
      setRun(await api<Report>(`/runs/${run.id}/stop`, "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function openReport(report: Report) {
    setBusy(true);
    try {
      setHistoric(await api<Report>("/runs/" + report.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
        <nav>
          {(
            [
              ["benchmark", Gauge, "Benchmark"],
              ["duration", Clock3, "Süreli test"],
              ["reports", FileText, "Raporlar"],
              ["inputs", FileText, "Kayıtlı girdiler"],
              ["contexts", Database, "Bağlam kütüphanesi"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              className={page === id ? "active" : ""}
              aria-label={label}
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
        <nav>
          <button
            className={page === "settings" ? "active" : ""}
            aria-label="Yönetici ayarları"
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            <span className="nav-title">Yönetici ayarları</span>
            <span className="nav-short">Ayarlar</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="help-link" onClick={() => setHelp(!help)}>
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
            <span className="local-chip">
              <span className="dot" />
              Yerel
            </span>
            <span className="version">v0.1</span>
            <button
              className="icon-button mobile-tool"
              aria-label="Ölçüm rehberini aç"
              onClick={() => setHelp(!help)}
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
              <h1>{historic ? "Rapor detayları" : titles[page]}</h1>
              <p>
                {page === "benchmark"
                  ? "Modellerini aynı girdilerle karşılaştır. Tek istekte ve yük altında farkı ölç."
                  : page === "duration"
                    ? "Tek modele süre boyunca aralıklı istek gönder; her cevabı ve empty-guard sonucunu kontrol et."
                  : page === "reports"
                    ? "Her koşu kaydedilir. Önceki ölçümlere dön, sonuçları birlikte değerlendir."
                    : page === "contexts"
                      ? "Tekrar kullanabileceğin girdileri hazırla. Testlerini aynı bağlamla tekrarla."
                      : page === "inputs"
                        ? "Uzun bağlam ve sorularını kaydet. Her testte aynı girdiyi yeniden seç."
                        : "Model sağlayıcılarını bağla ve karşılaştırmaya hazır hale getir."}
              </p>
            </div>
            {page === "benchmark" ? (
              <span className="heading-tag">
                <FlaskConical size={15} /> Benchmark studio
              </span>
            ) : page === "settings" && modelEdit === undefined ? (
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
          {help && (
            <section className="help-panel">
              <div className="section-heading">
                <h2>Doğru karşılaştırma için</h2>
                <button
                  aria-label="Rehberi kapat"
                  className="icon-button"
                  onClick={() => setHelp(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <p>
                Aynı girdileri, çıktı limitini ve temperature değerini kullan.
                Paylaşılan GPU kullanıyorsan modelleri sırayla çalıştır. “Seri
                vs. eşzamanlı” modu aynı girdileri önce tek tek, sonra birlikte
                gönderir. Farklı çıktı uzunluklarını ve başarısız istekleri
                sonuçlarla birlikte değerlendir.
              </p>
              <p>
                Demo modu arayüzü denemek içindir. Gerçek ölçümde token sayısı
                sağlayıcı usage yanıtından gelir. Draft ve kabul oranı için
                model ayarlarına metrics URL ekle.
              </p>
            </section>
          )}
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
              <section className="setup-panel">
                <div className="setup-top">
                  <div className="segmented mode-tabs">
                    {[
                      ["single", "Tek istek", Zap],
                      ["concurrent", "Eşzamanlı yük", Layers3],
                      ["compare", "Sırayla → aynı anda", Activity],
                    ].map(([id, label, Icon]) => {
                      const I = Icon as typeof Zap;
                      return (
                        <button
                          disabled={running || busy}
                          className={mode === id ? "active" : ""}
                          key={id as string}
                          onClick={() => setMode(id as string)}
                        >
                          <I size={16} />
                          {label as string}
                        </button>
                      );
                    })}
                  </div>
                  <label className="demo-switch">
                    <span>{demo ? "Demo modu" : "Gerçek API"}</span>
                    <input
                      type="checkbox"
                      checked={demo}
                      disabled={running || busy}
                      onChange={(e) => setDemo(e.target.checked)}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
                <ModeExplanation
                  mode={mode}
                  count={effectivePrompts.length}
                  models={selected.length}
                  schedule={schedule}
                />
                <div className="setup-content">
                  <div className="block-heading">
                    <div className="block-title">
                      <span className="step-index">1</span>
                      <h2>Karşılaştırılacak modeller</h2>
                      <span className="muted">
                        {selected.length} / 4 seçildi
                      </span>
                    </div>
                    <button
                      className="text-button"
                      disabled={running || busy}
                      onClick={() => navigate("settings")}
                    >
                      Modelleri yönet
                      <ArrowUpRight size={15} />
                    </button>
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
                          running ||
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
                            {m.provider.split(" · ")[0]}
                          </span>
                          <small>{m.demo ? "DEMO" : "API"}</small>
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
                  <div className="model-notice">
                    <ShieldCheck size={14} />
                    {demo
                      ? "Demo modunda gerçek API çağrısı yapılmaz."
                      : "Gerçek API modu seçili. İstekler seçili sağlayıcılara gönderilir."}
                    <label>
                      Modeller
                      <select
                        value={schedule}
                        disabled={running || busy}
                        onChange={(e) => setSchedule(e.target.value)}
                      >
                        <option value="sequential">Sırayla çalışsın</option>
                        <option value="parallel">Aynı anda çalışsın</option>
                      </select>
                    </label>
                  </div>
                  <div className="input-section">
                    <div className="block-heading">
                      <div className="block-title">
                        <span className="step-index">2</span>
                        <h2>İstek girdileri</h2>
                        <span className="muted">
                          {effectivePrompts.length}{" "}
                          {mode === "compare"
                            ? "ortak"
                            : mode === "concurrent"
                              ? "eşzamanlı"
                              : ""}{" "}
                          istek
                        </span>
                      </div>
                      <div className="input-actions">
                        <button
                          className="text-button"
                          disabled={running || busy || !contexts.length}
                          onClick={() => {
                            setPrompts(prompts.map(() => contexts[0].content));
                            setPromptSources({});
                          }}
                        >
                          Örneklerle doldur
                        </button>
                        <button
                          className="icon-button"
                          title="Girdileri boşalt"
                          aria-label="Tüm girdileri boşalt"
                          disabled={running || busy}
                          onClick={() => {
                            setPrompts(prompts.map(() => ""));
                            setPromptSources({});
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="input-config">
                      <p>
                        {mode === "compare"
                          ? "Aynı girdiler önce seri (C1), ardından eşzamanlı çalıştırılır."
                          : mode === "single"
                            ? "Bir girdi, seçtiğin tüm modellerde ölçülür."
                            : "Her girdi, seçtiğin tüm modellere aynı ayarlarla gönderilir."}
                      </p>
                      {mode !== "single" && (
                        <div className="count-control">
                          <span>İstek sayısı</span>
                          {[1, 2, 4, 8].map((n) => (
                            <button
                              key={n}
                              disabled={running || busy}
                              className={prompts.length === n ? "active" : ""}
                              onClick={() => count(n)}
                            >
                              {n}
                            </button>
                          ))}
                          <select
                            value={prompts.length}
                            aria-label="İstek sayısını seç"
                            disabled={running || busy}
                            onChange={(e) => count(Number(e.target.value))}
                          >
                            {Array.from({ length: 8 }, (_, i) => (
                              <option key={i + 1}>{i + 1}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="prompt-grid">
                      {effectivePrompts.map((prompt, i) => (
                        <div className="prompt-box" key={i}>
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
                              value={
                                promptSources[i] &&
                                savedInputs.some(
                                  (s) => "input:" + s.id === promptSources[i],
                                )
                                  ? promptSources[i]
                                  : contexts.find((c) => c.content === prompt)
                                    ? "context:" +
                                      contexts.find(
                                        (c) => c.content === prompt,
                                      )!.id
                                    : ""
                              }
                              onChange={(e) => {
                                void choosePrompt(e.target.value, i);
                              }}
                            >
                              <option value="">
                                Kayıtlı girdi / bağlam seç
                              </option>
                              {savedInputs.length > 0 && (
                                <optgroup label="Kayıtlı girdiler">
                                  {savedInputs.map((item) => (
                                    <option
                                      key={item.id}
                                      value={"input:" + item.id}
                                    >
                                      {item.name} ·{" "}
                                      {lengthLabel(item.target_tokens)}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="Hazır bağlamlar">
                                {contexts.map((c) => (
                                  <option key={c.id} value={"context:" + c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </div>
                          <textarea
                            aria-label={`Girdi ${i + 1} metni`}
                            value={prompt}
                            readOnly={running || busy}
                            onChange={(e) => setPrompt(i, e.target.value)}
                            placeholder="İsteğini yaz veya hazır bir bağlam seç…"
                          />
                          <div className="prompt-footer">
                            <span>
                              {prompt.length.toLocaleString("tr-TR")} karakter
                            </span>
                            <button
                              className="prompt-save"
                              disabled={running || busy || !prompt.trim()}
                              onClick={() => archivePrompt(i)}
                              aria-label={`Girdi ${i + 1} metnini arşive kaydet`}
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
                  <div className="generation-settings">
                    <label>
                      Çıktı limiti
                      <span>
                        <input
                          type="number"
                          min="1"
                          max="32768"
                          value={maxTokens}
                          disabled={running || busy}
                          onChange={(e) => setMaxTokens(Number(e.target.value))}
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
                        disabled={running || busy}
                        onChange={(e) => setTemperature(Number(e.target.value))}
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
                          disabled={running || busy}
                          onChange={(e) =>
                            setTimeoutValue(Number(e.target.value))
                          }
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
                </div>
                <div className="launch-bar">
                  <div>
                    <span className="launch-icon">
                      <Activity size={19} />
                    </span>
                    <span>
                      <b>
                        {selected.length} model × {effectivePrompts.length}{" "}
                        girdi{mode === "compare" ? " × 2 faz" : ""}
                      </b>
                      <small>
                        {demo ? "Sentetik demo" : "Gerçek API ölçümü"} ·{" "}
                        {mode === "compare"
                          ? "Seri + eşzamanlı"
                          : mode === "single"
                            ? "Tek istek"
                            : "Eşzamanlı yük"}
                      </small>
                    </span>
                  </div>
                  <button
                    className="button primary launch-button"
                    disabled={
                      busy ||
                      running ||
                      !selected.length ||
                      effectivePrompts.some((p) => !p.trim())
                    }
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
                {run ? (
                  <Results key={run.id} run={run} onStop={stop} />
                ) : (
                  <section className="results initial-results">
                    <div className="section-heading">
                      <div>
                        <h2>Sonuçlar için her şey hazır</h2>
                        <p>
                          İlk token süresi, akış hızı ve toplam verimi tek yerde
                          izle.
                        </p>
                      </div>
                      <span className="ready-state">
                        <span className="dot" />
                        Başlamaya hazır
                      </span>
                    </div>
                    <Chart models={chosen} />
                    <div className="initial-foot">
                      <span>
                        <CheckCircle2 size={14} />
                        Raporlar otomatik kaydedilir
                      </span>
                      <span>
                        TTFT · p95 · E2E · tok/sn · Draft · Kabul oranı
                      </span>
                    </div>
                  </section>
                )}
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
                                {r.config.prompts.length} istek
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
                                <button
                                  aria-label={`${r.name} raporunu aç`}
                                  className="icon-button"
                                  disabled={busy}
                                  onClick={() => openReport(r)}
                                >
                                  <ArrowUpRight size={17} />
                                </button>
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
                onSave={save}
                onClose={() => setModelEdit(undefined)}
              />
            ) : (
              <>
                <section className="list-panel">
                  <div className="panel-title">
                    <h2>Model sağlayıcıları</h2>
                    <span>{models.length} model</span>
                  </div>
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
                                {m.demo ? "Demo" : "Gerçek API"}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
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
                      API anahtarları şifrelenerek saklanır ve raporlara
                      eklenmez. Bu ilk sürümde yönetici hesabı admin / admin;
                      sunucu ortam değişkenleriyle değiştirilebilir.
                    </p>
                  </div>
                </div>
              </>
            ))}
          {page === "duration" && <DurationTests models={models} contexts={contexts} savedInputs={savedInputs} onSettings={() => navigate("settings")} />}
          {page === "inputs" && (
            <SavedInputs
              items={savedInputs}
              draft={inputDraft}
              onDraftUsed={() => setInputDraft(null)}
              onRefresh={refreshInputs}
              onApply={applySavedInput}
              slots={effectivePrompts.length}
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
                              setPrompts(prompts.map(() => c.content));
                              setPromptSources({});
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
