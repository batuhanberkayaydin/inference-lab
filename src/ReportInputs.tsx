import { useEffect, useState } from "react";
import { ArrowDownToLine, FileText, Loader2 } from "lucide-react";
import { api } from "./api";
import { RequestPage, REQUESTS_PER_PAGE } from "./RequestCount";
import { MediaPreviews, type MediaImage } from "./VisualInput";

export type ReportInputSource = {
  runId: string;
  count: number;
  prompts?: string[];
  images?: Record<number, MediaImage[]>;
};

type InputPreview = { index: number; preview: string; characters: number; image_count: number };
type ReportInput = { prompt: string; images: MediaImage[] };
type PageResult = { key: string; items: InputPreview[]; error?: string };

export function useReportInputPage(source: ReportInputSource, page: number) {
  const { runId, prompts, images } = source;
  const [result, setResult] = useState<PageResult>();
  const [attempt, setAttempt] = useState(0);
  const offset = page * REQUESTS_PER_PAGE;
  const key = `${runId}:${offset}:${attempt}`;
  const remote = prompts === undefined;

  useEffect(() => {
    if (!remote) return;
    let active = true;
    api<InputPreview[]>(`/runs/${runId}/inputs?offset=${offset}&limit=${REQUESTS_PER_PAGE}`)
      .then(items => { if (active) setResult({ key, items }); })
      .catch((error: Error) => { if (active) setResult({ key, items: [], error: error.message }); });
    return () => { active = false; };
  }, [key, offset, remote, runId]);

  if (prompts) {
    return {
      items: prompts.slice(offset, offset + REQUESTS_PER_PAGE).map((prompt, position) => ({
        index: offset + position,
        preview: prompt.length > 140 ? prompt.slice(0, 140) + "…" : prompt,
        characters: prompt.length,
        image_count: images?.[offset + position]?.length ?? 0,
      })),
      loading: false,
    };
  }
  const current = result?.key === key ? result : undefined;
  return { items: current?.items ?? [], loading: !current, error: current?.error, retry: () => setAttempt(value => value + 1) };
}

export function ReportInputDetails({ source, index, preview }: {
  source: ReportInputSource;
  index: number;
  preview?: InputPreview;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<ReportInput>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const prompt = source.prompts?.[index];
  const remote = prompt === undefined;
  const { runId } = source;

  useEffect(() => {
    if (!open || !remote || input) return;
    let active = true;
    api<ReportInput>(`/runs/${runId}/inputs/${index}`)
      .then(value => { if (active) setInput(value); })
      .catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [attempt, index, input, open, remote, runId]);

  const data = remote ? input : { prompt, images: source.images?.[index] ?? [] };
  const shortText = preview?.preview || "";
  const imageCount = preview?.image_count ?? 0;

  return <details className="response-prompt" onToggle={event => {
    const nextOpen = event.currentTarget.open;
    if (nextOpen) setError("");
    setOpen(nextOpen);
  }}>
    <summary>
      <span>
        {shortText || (imageCount ? "" : `Girdi ${index + 1}`)}
        {imageCount > 0 && `${shortText ? " · " : ""}${imageCount} görsel`}
      </span>
      <b>{open ? "Girdiyi gizle" : "Girdiyi göster"}</b>
    </summary>
    {open && (data ? <>
      {data.prompt && <pre>{data.prompt}</pre>}
      <MediaPreviews images={data.images} />
    </> : error ? (
      <div className="report-input-feedback" role="alert">
        <span>{error}</span>
        <button type="button" className="button small-button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</button>
      </div>
    ) : (
      <p className="report-input-feedback" role="status"><Loader2 className="spin" size={15} aria-hidden="true" /> Girdi yükleniyor…</p>
    ))}
  </details>;
}

function ReportInputPages({ source }: { source: ReportInputSource }) {
  const [page, setPage] = useState(0);
  const { items, loading, error, retry } = useReportInputPage(source, page);
  return <div className="report-input-pages">
    <RequestPage label="Girdi aralığı" total={source.count} page={page} onChange={setPage} />
    {loading && <p className="report-input-feedback" role="status"><Loader2 className="spin" size={15} aria-hidden="true" /> Girdiler yükleniyor…</p>}
    {error && <div className="report-input-feedback" role="alert"><span>{error}</span><button type="button" className="button small-button" onClick={retry}>Tekrar dene</button></div>}
    {items.map(item => (
      <section className="report-input-item" key={item.index} aria-label={`Girdi ${item.index + 1}`}>
        <div><b>Girdi {item.index + 1}</b><small>{item.characters.toLocaleString("tr-TR")} karakter</small></div>
        <ReportInputDetails source={source} index={item.index} preview={item} />
      </section>
    ))}
  </div>;
}

export function ReportInputs({ source }: { source: ReportInputSource }) {
  const [open, setOpen] = useState(false);
  return <div className="report-input-tools">
    <a className="button small-button" href={`/api/runs/${source.runId}/export?format=json`} download>
      <ArrowDownToLine size={16} aria-hidden="true" /> Tam JSON indir
    </a>
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><FileText size={16} aria-hidden="true" /> {open ? "Girdileri kapat" : "Girdileri aç"} <small>{source.count.toLocaleString("tr-TR")} girdi</small></summary>
      {open && <ReportInputPages source={source} />}
    </details>
  </div>;
}
