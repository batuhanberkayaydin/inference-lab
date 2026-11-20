import { useEffect, useRef, useState } from "react";
import { ChevronDown, ImagePlus, X } from "lucide-react";
import { api } from "./api";
import type { openPdf } from "./pdf-page";
import "./visual-input.css";

export type MediaImage = { name: string } & ({ id: string; url?: never } | { url: string; id?: never });
export type ModelInputFormat = "auto" | "vision" | "ocr";
export const requiresSingleImage = (model: { model: string; input_format?: ModelInputFormat }) =>
  model.input_format === "ocr" ||
  ((model.input_format ?? "auto") === "auto" && model.model.toLowerCase().replace(/[^a-z0-9]/g, "").includes("lightonocr"));
type Pdf = Awaited<ReturnType<typeof openPdf>>;
export type PdfPageImage = { page: number; image: MediaImage };
type PdfMode = "attach" | "split" | "pick";
const MAX_IMAGES = 100;
const MAX_PDF_PAGES = 100;
const fileTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
};

function pdfPageNumbers(value: string, pageCount: number) {
  const pages = new Set<number>();
  for (const interval of (value.trim() || `1-${pageCount}`).split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(interval);
    if (!match) throw new Error("Sayfaları 1-3,5 biçiminde girin.");
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) throw new Error(`1–${pageCount} arasında geçerli sayfa numaraları girin.`);
    for (let page = start; page <= end; page++) {
      pages.add(page);
      if (pages.size > MAX_PDF_PAGES) throw new Error(`Bir defada en fazla ${MAX_PDF_PAGES} sayfa eklenebilir. Daha kısa bir aralık seçin.`);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

async function uploadImage(file: File) {
  const mime = fileTypes[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mime || !file.size || file.size > 5_000_000)
    throw new Error("PNG, JPEG, WebP, GIF, BMP veya TIFF biçiminde en fazla 5 MB görsel ekleyin.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Görsel okunamadı."));
    reader.readAsDataURL(file);
  });
  return api<MediaImage>("/media", "POST", {
    name: file.name,
    data_url: `data:${mime};base64,${data.slice(data.indexOf(",") + 1)}`,
  });
}

export function MediaPreviews({ images, onRemove }: { images: MediaImage[]; onRemove?: (index: number) => void }) {
  if (!images.length) return null;
  return (
    <ul className="media-previews">
      {images.map((image, index) => (
        <li key={`${image.id ?? image.url}-${index}`}>
          {image.id && !/\.tiff?$/i.test(image.name) && (
            <img src={`/api/media/${image.id}`} alt="" loading="lazy" width={40} height={40} />
          )}
          {image.id
            ? <a href={`/api/media/${image.id}`} target="_blank" rel="noreferrer">{image.name}</a>
            : <span title={image.url}>{image.name} <small>· Görsel URL’si</small></span>}
          {onRemove && <button type="button" className="icon-button" aria-label={`${image.name} görselini kaldır`} onClick={() => onRemove(index)}><X size={14} /></button>}
        </li>
      ))}
    </ul>
  );
}

export function VisualInput({ images, onChange, disabled, onBusyChange, label, onSavePdfPages, planVisualSplit, singleImage = false }: {
  images: MediaImage[];
  onChange: (images: MediaImage[]) => void;
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
  label?: string;
  onSavePdfPages?: (filename: string, pages: PdfPageImage[]) => Promise<void>;
  planVisualSplit?: (imageCount: number) => (images: MediaImage[], format: "pdf" | "images") => void;
  singleImage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [url, setUrl] = useState("");
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [page, setPage] = useState("1");
  const [edge, setEdge] = useState(1540);
  const [pageRange, setPageRange] = useState("");
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [pdfModeOverride, setPdfModeOverride] = useState<PdfMode | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => () => { if (pdf) void pdf.close().catch(() => {}); }, [pdf]);

  const locked = disabled || working;
  const maxImages = singleImage ? 1 : MAX_IMAGES;
  const full = images.length >= maxImages;
  const defaultPdfMode = singleImage ? (planVisualSplit ? "split" : "pick") : "attach";
  const pdfMode = pdfModeOverride === "attach" && singleImage ? defaultPdfMode : pdfModeOverride ?? defaultPdfMode;
  const canChoosePdf = pdfMode === "split" || (!!onSavePdfPages && pdfMode === "pick");
  async function prepare(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setWorking(true);
    onBusyChange?.(true);
    try { await action(); }
    catch (err) { setError((err as Error).message); }
    finally {
      setWorking(false);
      setProgress("");
      onBusyChange?.(false);
    }
  }
  async function renderPages(document: Pdf, numbers: number[]) {
    const result: PdfPageImage[] = [];
    for (const number of numbers) {
      if (!mounted.current) return null;
      setProgress(`Sayfa ${result.length + 1} / ${numbers.length} hazırlanıyor…`);
      result.push({ page: number, image: await uploadImage(await document.render(number, edge)) });
    }
    return mounted.current ? result : null;
  }
  async function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    await prepare(async () => {
      if (files.some(file => /\.pdf$/i.test(file.name))) {
        if (files.length !== 1) throw new Error("PDF dosyasını tek başına seçin.");
        const document = await (await import("./pdf-page")).openPdf(files[0]);
        if (!mounted.current) {
          await document.close();
          return;
        }
        if (pdfMode === "pick") {
          setPage("1");
          setPageRange("");
          setPdf(document);
          return;
        }
        setPdf(null);
        try {
          const numbers = pdfPageNumbers("", document.pages);
          const applySplit = pdfMode === "split" ? planVisualSplit?.(numbers.length) : undefined;
          if (!applySplit && images.length + numbers.length > maxImages)
            throw new Error(`Bu girdiye toplam en fazla ${maxImages} görsel eklenebilir. Tek sayfa seçebilir veya ayrı kutular kullanabilirsiniz.`);
          const pages = await renderPages(document, numbers);
          if (!pages) return;
          if (applySplit) applySplit(pages.map(item => item.image), "pdf");
          else {
            onChange([...images, ...pages.map(item => item.image)]);
            setNotice(`${pages.length} PDF sayfası görsel olarak eklendi.`);
          }
        } finally {
          await document.close();
        }
      } else {
        const applySplit = singleImage ? planVisualSplit?.(files.length) : undefined;
        if (!applySplit && images.length + files.length > maxImages) throw new Error(`Bir girdiye en fazla ${maxImages} görsel eklenebilir.`);
        const uploaded: MediaImage[] = [];
        for (const file of files) uploaded.push(await uploadImage(file));
        if (mounted.current) {
          if (applySplit) applySplit(uploaded, "images");
          else onChange([...images, ...uploaded]);
        }
      }
    });
  }
  function addUrl() {
    setError("");
    try {
      const value = url.trim();
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2048)
        throw new TypeError();
      const name = parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname;
      const image = { url: parsed.href, name };
      const applySplit = singleImage ? planVisualSplit?.(1) : undefined;
      if (applySplit) applySplit([image], "images");
      else onChange([...images, image]);
      setUrl("");
    } catch (err) {
      setError(err instanceof TypeError ? "Kullanıcı bilgisi içermeyen geçerli bir HTTP(S) görsel adresi girin." : (err as Error).message);
    }
  }
  async function addPage() {
    if (!pdf) return;
    await prepare(async () => {
      const number = Number(page);
      if (!Number.isInteger(number) || number < 1 || number > pdf.pages) throw new Error(`1–${pdf.pages} arasında bir PDF sayfası seçin.`);
      const applySplit = singleImage ? planVisualSplit?.(1) : undefined;
      const uploaded = await uploadImage(await pdf.render(number, edge));
      if (mounted.current) {
        if (applySplit) applySplit([uploaded], "pdf");
        else onChange([...images, uploaded]);
      }
    });
  }
  async function savePdfPages() {
    if (!pdf || !onSavePdfPages) return;
    await prepare(async () => {
      const numbers = pdfPageNumbers(pageRange, pdf.pages);
      const result = await renderPages(pdf, numbers);
      if (result) await onSavePdfPages(pdf.name, result);
    });
  }
  return (
    <details className="visual-input" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary aria-label={label}>
        <ImagePlus size={15} aria-hidden="true" />
        <span>Görsel / PDF sayfası ekle{images.length ? ` · ${images.length} görsel` : ""}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      {open && (
        <div className="visual-input-body">
          <p>LightOnOCR için her isteğe tek görsel ekleyin. Düz OCR’da metin alanlarını boş bırakabilirsiniz.</p>
          <MediaPreviews images={images} onRemove={locked ? undefined : index => onChange(images.filter((_, i) => i !== index))} />
          <div className="visual-input-actions">
            {(!singleImage || planVisualSplit) && (
              <label>PDF ekleme biçimi
                <select value={pdfMode} disabled={locked} onChange={e => {
                  setPdfModeOverride(e.target.value as PdfMode);
                  setPdf(null);
                  setNotice("");
                  setError("");
                }}>
                  {!singleImage && <option value="attach">Tüm sayfaları bu girdiye ekle</option>}
                  {planVisualSplit && <option value="split">Her sayfayı ayrı istek kutusuna ekle</option>}
                  <option value="pick">{onSavePdfPages ? "Sayfa veya aralık seç" : "Tek sayfa seç"}</option>
                </select>
              </label>
            )}
            <label>PDF uzun kenarı<select value={edge} disabled={locked} onChange={e => setEdge(Number(e.target.value))}><option value={1540}>1540 px</option><option value={2048}>2048 px</option></select></label>
          </div>
          <label>
            Görsel veya PDF yükle
            <input type="file" aria-label="Görsel veya PDF yükle" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.pdf" multiple
              disabled={locked || (full && !canChoosePdf)} onChange={e => void chooseFiles(e)} />
          </label>
          {pdf && (
            <div className="visual-pdf">
              <b>{pdf.name} · {pdf.pages} sayfa</b>
              <div className="visual-input-actions">
                <label>PDF sayfası<input type="text" inputMode="numeric" value={page} disabled={locked} onChange={e => setPage(e.target.value)} /></label>
                <button className="button small-button" type="button" disabled={locked || full} onClick={() => void addPage()}>Sayfayı ekle</button>
              </div>
              {onSavePdfPages && (
                <div className="visual-input-actions">
                  <label className="visual-url">Kaydedilecek sayfalar
                    <input type="text" value={pageRange} disabled={locked} placeholder="Tümü veya örn. 1-3,5"
                      onChange={e => setPageRange(e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} />
                  </label>
                  <button className="button small-button" type="button" disabled={locked} onClick={() => void savePdfPages()}>Ayrı girdiler olarak kaydet</button>
                </div>
              )}
            </div>
          )}
          <div className="visual-input-actions">
            <label className="visual-url">Görsel URL’si
              <input type="text" inputMode="url" value={url} disabled={locked} placeholder="https://…"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (!locked && url.trim() && !full) addUrl(); } }}
                onChange={e => setUrl(e.target.value)} />
            </label>
            <button className="button small-button" type="button" disabled={locked || !url.trim() || full} onClick={addUrl}>URL ekle</button>
          </div>
          {working && <small role="status">{progress || "Dosya hazırlanıyor…"}</small>}
          {notice && <small role="status">{notice}</small>}
          {error && <p className="error-message" role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
