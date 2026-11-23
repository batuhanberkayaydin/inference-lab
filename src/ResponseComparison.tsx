import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { REQUESTS_PER_PAGE, RequestPage } from "./RequestCount";
import { ReportInputDetails, useReportInputPage, type ReportInputSource } from "./ReportInputs";
import "./responses.css";

export type GuardInfo = {
  result: string | null;
  attempts: number | null;
  version?: string | null;
  policy?: string | null;
};
type ResponseRow = { index: number; status: string; text: string; error: string | null; output_tokens: number | null; e2e_s: number | null; response_format?: string; guard?: GuardInfo };
type ResponseModel = { id: string; name: string; color: string; requests: ResponseRow[]; empty_guard_enabled?: boolean };
const labels: Record<string, string> = { queued: "Bekliyor", running: "Yanıt geliyor", completed: "Tamamlandı", failed: "Başarısız", cancelled: "Durduruldu" };

export function showsBenchmarkGuard(model: { empty_guard_enabled?: boolean; requests: { guard?: GuardInfo }[] }) {
  return model.empty_guard_enabled ?? model.requests.some(({guard}) =>
    !!guard && Boolean(guard.result || guard.attempts != null || guard.version || guard.policy));
}

export function BenchmarkGuard({ row, showLabel = false }: {
  row?: { status: string; guard?: GuardInfo };
  showLabel?: boolean;
}) {
  const guard = row?.guard;
  const pending = !guard && (!row || row.status === "queued" || row.status === "running");
  const result = guard?.result || (pending ? "Bekleniyor" : "Bilinmiyor");
  const attempts = guard?.attempts;
  const status = guard?.result === "pass" ? "completed" : guard?.result ? "failed" : "";
  return <div className="benchmark-guard">
    {showLabel && <b>Empty Guard</b>}
    <span className={`status ${status}`}>{result}</span>
    {!pending && <span>{attempts == null ? "Deneme sayısı bilinmiyor" : `${attempts} deneme${attempts > 1 ? ` · ${attempts - 1} tekrar` : ""}`}</span>}
    {(guard?.version || guard?.policy) && (
      <small>{[guard.version && `Sürüm ${guard.version}`, guard.policy && `Politika ${guard.policy}`].filter(Boolean).join(" · ")}</small>
    )}
  </div>;
}

function Answer({ model, row, stream, showGuard }: { model: ResponseModel; row?: ResponseRow; stream: boolean; showGuard: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(row?.text || "");
      setCopied(true); setCopyError(false);
      setTimeout(() => setCopied(false), 1800);
    } catch { setCopyError(true); }
  }
  return <article className="answer-column" aria-label={`${model.name} cevabı`}>
    <header><h4><i style={{ background: model.color }} />{model.name}</h4><span className={`status ${row?.status || "queued"}`}>{labels[row?.status || "queued"] || row?.status}</span></header>
    <div className="answer-text" tabIndex={0} aria-label={`${model.name} yanıt metni`}>
      {row?.text ? <pre>{row.text}</pre> : <p className="answer-placeholder">{row?.status === "running" ? (stream ? "İlk yanıt parçası bekleniyor…" : "Yanıt hazırlanıyor; tamamlandığında burada görünecek.") : row?.status === "failed" || row?.status === "cancelled" ? "Bu istek için yanıt alınamadı." : "İstek başladığında cevap burada görünecek."}</p>}
      {row?.error && <p className="answer-error" role="alert">{row.error}{row.text && " Yukarıdaki metin, kesintiden önce alınan kısmi yanıttır."}</p>}
      {row?.status === "cancelled" && row.text && <p className="answer-error">İstek durduruldu. Alınan kısmi yanıt korunuyor.</p>}
    </div>
    {showGuard && <BenchmarkGuard row={row} showLabel />}
    <footer><span>{(!stream || row?.response_format === "normal") && "Normal yanıt · "}{row?.output_tokens == null ? "Token: —" : `${row.output_tokens.toLocaleString("tr-TR")} token`}{row?.e2e_s != null && ` · ${row.e2e_s.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sn`}</span><button type="button" className="button" disabled={!row?.text} onClick={copy} aria-label={`${model.name} cevabını kopyala`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Kopyalandı" : "Kopyala"}</button></footer>
    {copyError && <p className="answer-error">Kopyalama kullanılamıyor. Metni seçip kopyalayabilirsiniz.</p>}
  </article>;
}

export function ResponseComparison({ phase, source, stream }: {
  phase: { models: ResponseModel[] };
  source: ReportInputSource;
  stream: boolean;
}) {
  const [page, setPage] = useState(0);
  const visiblePage = Math.max(0, Math.min(page, Math.ceil(source.count / REQUESTS_PER_PAGE) - 1));
  const offset = visiblePage * REQUESTS_PER_PAGE;
  const { items } = useReportInputPage(source, visiblePage);
  const visibleInputs = Array.from({ length: Math.min(REQUESTS_PER_PAGE, source.count - offset) }, (_, position) => offset + position);
  const models = phase.models.map(model => ({model, showGuard: showsBenchmarkGuard(model)}));
  return <section className="response-comparison" aria-label="Girdi bazında cevap karşılaştırması">
    <div className="responses-heading"><h3>Girdiler ve model cevapları</h3><p>{stream ? "Yanıtlar geldikçe güncellenir; tamamlanan metinler açık kalır." : "Normal yanıtlar tamamlandığında gösterilir. İlk token ve akış hızı bu biçimde ölçülmez."} Faz seçimi, bu bölümdeki cevapları da değiştirir.</p></div>
    <RequestPage label="Cevap aralığı" total={source.count} page={visiblePage} onChange={setPage} />
    {visibleInputs.map((index, position) => <section className="response-input" key={index} aria-label={`Girdi ${index + 1} cevapları`}>
      <div className="response-input-heading"><h3>Girdi {String(index + 1).padStart(2, "0")}</h3><span>{phase.models.length} model cevabı</span></div>
      <ReportInputDetails source={source} index={index} preview={items[position]} />
      <div className="answer-grid" style={{ gridTemplateColumns: `repeat(${models.length}, minmax(0, 1fr))` }}>
        {models.map(({model, showGuard}) => <Answer key={model.id} model={model} row={model.requests.find(row => row.index === index)} stream={stream} showGuard={showGuard} />)}
      </div>
    </section>)}
  </section>;
}
