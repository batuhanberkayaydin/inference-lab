import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "./api";

export type SavedInputSummary = {
  id: string;
  name: string;
  category: string;
  target_tokens: number;
  characters: number;
  estimated_tokens: number;
  created_at: string;
  updated_at: string;
  preview: string;
};
export type SavedInput = Omit<SavedInputSummary, "preview"> & {
  context: string;
  question: string;
  content: string;
};
export type InputDraft = {
  name?: string;
  category?: string;
  context?: string;
  question?: string;
  target_tokens?: number;
};
const lengths = [0, 8192, 16384, 32768, 65536, 131072];
export const lengthLabel = (n: number) => (n ? `${n / 1024}K` : "Serbest");
const count = (n: number) => n.toLocaleString("tr-TR");
const edited = (s: string) =>
  new Date(s).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  });

function InputEditor({
  record,
  draft,
  onClose,
  onSaved,
}: {
  record: SavedInput | null;
  draft?: InputDraft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    id: record?.id,
    name: record?.name || draft?.name || "",
    category: record?.category || draft?.category || "",
    target_tokens: record?.target_tokens ?? draft?.target_tokens ?? 32768,
    context: record?.context || draft?.context || "",
    question: record?.question || draft?.question || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const content =
    form.context.trim() && form.question.trim()
      ? form.context + "\n\nSoru:\n" + form.question
      : form.context.trim()
        ? form.context
        : form.question;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/inputs", "POST", form);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      if (file.size > 4_000_000)
        throw new Error("Dosya en fazla 4 MB olabilir.");
      const text = await file.text();
      if (text.length > 1_000_000)
        throw new Error("Bağlam en fazla 1 milyon karakter olabilir.");
      setForm((prev) => ({
        ...prev,
        context: text,
        name: prev.name || file.name.replace(/\.txt$/i, ""),
      }));
      setFilename(file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      e.target.value = "";
    }
  }
  return (
    <section className="saved-editor">
      <div className="saved-editor-heading">
        <div>
          <button className="text-button" onClick={onClose} disabled={busy}>
            <ArrowLeft size={15} />
            Girdi arşivine dön
          </button>
          <h2>{record ? "Kayıtlı girdiyi düzenle" : "Yeni girdi hazırla"}</h2>
          <p>
            Bağlamı ve soruyu bir kez hazırla, her koşuda aynı girdiyi kullan.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Girdi editörünü kapat"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="saved-metadata">
            <label>
              Girdi adı
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Örn. 32K · Hasar dosyası karşılaştırması"
              />
            </label>
            <label>
              Kategori
              <input
                maxLength={80}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Örn. Sigorta"
              />
            </label>
            <label>
              Hedef uzunluk
              <select
                value={form.target_tokens}
                onChange={(e) =>
                  setForm({ ...form, target_tokens: Number(e.target.value) })
                }
              >
                {lengths.map((n) => (
                  <option value={n} key={n}>
                    {lengthLabel(n)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="saved-editor-columns">
            <div className="saved-context">
              <div className="saved-field-heading">
                <label htmlFor="saved-context">Bağlam metni</label>
                <label className="upload-button">
                  <Upload size={14} />
                  .txt dosyasından al
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={upload}
                  />
                </label>
              </div>
              <textarea
                id="saved-context"
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
                placeholder="Uzun bağlamını buraya yapıştır veya .txt dosyasından yükle. İçerik aynen saklanır."
              />
              <div className="saved-field-footer">
                <span>{count(form.context.length)} karakter</span>
                <span>{filename || "En fazla 1 milyon karakter"}</span>
              </div>
            </div>
            <div className="saved-question">
              <label htmlFor="saved-question">Soru / görev</label>
              <textarea
                id="saved-question"
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="Modelin bu bağlam üzerinden yanıtlamasını istediğin soruyu yaz."
              />
              <div className="saved-measure">
                <h3>Kaydedilecek girdi</h3>
                <dl>
                  <dt>Hedef etiketi</dt>
                  <dd>{lengthLabel(form.target_tokens)}</dd>
                  <dt>Toplam karakter</dt>
                  <dd>{count(content.length)}</dd>
                  <dt>Yaklaşık token</dt>
                  <dd>~{count(Math.ceil(content.length / 3))}</dd>
                </dl>
                <p>
                  Hedef etiketi metni uzatmaz veya kısaltmaz. Token tahmini
                  karakter / 3 hesabıdır; gerçek sayı modele ve tokenizer’a
                  bağlıdır.
                </p>
                <small>
                  Bağlam ve soru doluysa, soru bağlamın sonuna “Soru:”
                  başlığıyla eklenir.
                </small>
              </div>
            </div>
          </div>
        </fieldset>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="saved-editor-actions">
          <span>
            <FileText size={14} />
            Kayıtlar bu cihazda saklanır.
          </span>
          <div>
            <button
              type="button"
              className="button"
              onClick={onClose}
              disabled={busy}
            >
              Vazgeç
            </button>
            <button
              className="button primary"
              disabled={busy || !content.trim() || content.length > 1_000_000}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Girdiyi kaydet
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

export function SavedInputs({
  items,
  draft,
  onDraftUsed,
  onRefresh,
  onApply,
  slots,
  running,
  onMessage,
}: {
  items: SavedInputSummary[];
  draft?: InputDraft | null;
  onDraftUsed: () => void;
  onRefresh: () => Promise<void>;
  onApply: (id: string, target: number | "all") => Promise<void>;
  slots: number;
  running: boolean;
  onMessage: (text: string) => void;
}) {
  const [editing, setEditing] = useState<SavedInput | null | undefined>(
    undefined,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [target, setTarget] = useState<number | "all">(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const isEditor = editing !== undefined || !!draft;
  const visible = items.filter(
    (item) =>
      (filter === "all" || item.target_tokens === Number(filter)) &&
      `${item.name} ${item.category}`
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
  );
  async function edit(id: string) {
    setBusy(true);
    setError("");
    try {
      setEditing(await api<SavedInput>("/inputs/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setEditing(undefined);
    onDraftUsed();
  }
  async function save() {
    await onRefresh();
    close();
    onMessage("Girdi arşive kaydedildi. Benchmark ekranından seçebilirsin.");
  }
  async function apply(id: string) {
    setBusy(true);
    setError("");
    try {
      await onApply(id, target === "all" ? "all" : Math.min(target, slots - 1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api("/inputs/" + id, "DELETE");
      await onRefresh();
      setConfirm(null);
      onMessage("Kayıtlı girdi kaldırıldı.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (isEditor)
    return (
      <InputEditor
        record={editing || null}
        draft={draft || undefined}
        onClose={close}
        onSaved={save}
      />
    );
  return (
    <>
      <div className="saved-page-actions">
        <p>
          Uzun bağlamlarını adlandır, sorularınla birlikte sakla ve istediğin
          girdi kutusuna yükle.
        </p>
        <button className="button primary" onClick={() => setEditing(null)}>
          <Plus size={16} />
          Yeni girdi
        </button>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <section className="list-panel saved-library">
        <div className="list-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Kayıtlı girdi ara"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Girdi adı veya kategori ara…"
            />
          </div>
          <select
            aria-label="Hedef uzunluğu filtrele"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tüm uzunluklar</option>
            {lengths.map((n) => (
              <option key={n} value={n}>
                {lengthLabel(n)}
              </option>
            ))}
          </select>
          <span className="muted">
            {visible.length} / {items.length} kayıt
          </span>
        </div>
        <div className="saved-use-toolbar">
          <span>
            <ArrowRight size={15} />
            Seçilen kaydı nereye yükleyelim?
          </span>
          <select
            aria-label="Kayıtlı girdiyi yükleme hedefi"
            value={target}
            disabled={running || busy}
            onChange={(e) =>
              setTarget(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
          >
            {Array.from({ length: slots }, (_, i) => (
              <option value={i} key={i}>
                Girdi {String(i + 1).padStart(2, "0")}
              </option>
            ))}
            <option value="all">Tüm girdiler</option>
          </select>
        </div>
        <div className="saved-input-list">
          {visible.map((item) => (
            <article key={item.id}>
              <div className="saved-input-heading">
                <button
                  className="saved-input-name"
                  onClick={() => edit(item.id)}
                  disabled={busy}
                >
                  {item.name}
                </button>
                <span className="saved-length-tag">
                  {lengthLabel(item.target_tokens)} hedef
                </span>
              </div>
              <p>{item.preview}</p>
              <div className="saved-input-meta">
                <span>{item.category || "Kategorisiz"}</span>
                <span>{count(item.characters)} karakter</span>
                <span>
                  ~{count(item.estimated_tokens)} token <small>(tahmini)</small>
                </span>
                <span>{edited(item.updated_at)}</span>
              </div>
              <div className="saved-row-actions">
                <button
                  className="button small-button"
                  disabled={busy || running}
                  onClick={() => apply(item.id)}
                >
                  Benchmark’ta kullan
                  <ArrowRight size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${item.name} girdisini düzenle`}
                  disabled={busy}
                  onClick={() => edit(item.id)}
                >
                  <Settings2 size={16} />
                </button>
                {confirm === item.id ? (
                  <div className="saved-delete-confirm">
                    <span>Kalıcı olarak silinsin mi?</span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => remove(item.id)}
                    >
                      Sil
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirm(null)}
                    >
                      Vazgeç
                    </button>
                  </div>
                ) : (
                  <button
                    className="icon-button"
                    aria-label={`${item.name} girdisini sil`}
                    disabled={busy}
                    onClick={() => setConfirm(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!visible.length && (
          <div className="empty-state">
            <FolderOpen size={32} />
            <h3>
              {items.length
                ? "Eşleşen girdi yok"
                : "İlk uzun bağlamını buraya kaydet"}
            </h3>
            <p>
              {items.length
                ? "Aramanı veya uzunluk filtresini değiştir."
                : "32K gibi uzun bağlamları soru ve hedef etiketiyle hazırlayıp tekrar kullanabilirsin."}
            </p>
            {!items.length && (
              <button className="button" onClick={() => setEditing(null)}>
                <Plus size={16} />
                Girdi oluştur
              </button>
            )}
          </div>
        )}
      </section>
      <p className="saved-library-note">
        Kayıt seçilene kadar uzun metin yüklenmez. Kaydedilen girdiler sonraki
        oturumlarda da korunur; gerçek token sayısı ölçüm sırasında sağlayıcıdan
        gelir.
      </p>
    </>
  );
}
