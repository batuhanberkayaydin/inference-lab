import { useState } from "react";
import { Copy, Check } from "lucide-react";
import "./responses.css";

type ResponseRow = { index: number; status: string; text: string; error: string | null; output_tokens: number | null; e2e_s: number | null; response_format?: string };
type ResponseModel = { id: string; name: string; color: string; requests: ResponseRow[] };
const labels: Record<string, string> = { queued: "Bekliyor", running: "Yanıt geliyor", completed: "Tamamlandı", failed: "Başarısız", cancelled: "Durduruldu" };

function Answer({ model, row, stream }: { model: ResponseModel; row?: ResponseRow; stream: boolean }) {
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
    <footer><span>{(!stream || row?.response_format === "normal") && "Normal yanıt · "}{row?.output_tokens == null ? "Token: —" : `${row.output_tokens.toLocaleString("tr-TR")} token`}{row?.e2e_s != null && ` · ${row.e2e_s.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sn`}</span><button type="button" className="button" disabled={!row?.text} onClick={copy} aria-label={`${model.name} cevabını kopyala`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Kopyalandı" : "Kopyala"}</button></footer>
    {copyError && <p className="answer-error">Kopyalama kullanılamıyor. Metni seçip kopyalayabilirsiniz.</p>}
  </article>;
}

export function ResponseComparison({ phase, prompts, stream }: { phase: { models: ResponseModel[] }; prompts: string[]; stream: boolean }) {
  return <section className="response-comparison" aria-label="Girdi bazında cevap karşılaştırması">
    <div className="responses-heading"><h3>Girdiler ve model cevapları</h3><p>{stream ? "Yanıtlar geldikçe güncellenir; tamamlanan metinler açık kalır." : "Normal yanıtlar tamamlandığında gösterilir. İlk token ve akış hızı bu biçimde ölçülmez."} Faz seçimi, bu bölümdeki cevapları da değiştirir.</p></div>
    {prompts.map((prompt, index) => <section className="response-input" key={index} aria-label={`Girdi ${index + 1} cevapları`}>
      <div className="response-input-heading"><h3>Girdi {String(index + 1).padStart(2, "0")}</h3><span>{phase.models.length} model cevabı</span></div>
      <details className="response-prompt"><summary><span>{prompt.length > 140 ? prompt.slice(0, 140) + "…" : prompt}</span><b>Girdiyi göster</b></summary><pre>{prompt}</pre></details>
      <div className="answer-grid" style={{ gridTemplateColumns: `repeat(${phase.models.length}, minmax(0, 1fr))` }}>{phase.models.map(model => <Answer key={model.id} model={model} row={model.requests.find(row => row.index === index)} stream={stream} />)}</div>
    </section>)}
  </section>;
}
