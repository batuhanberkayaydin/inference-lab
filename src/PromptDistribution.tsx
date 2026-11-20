import { useState } from "react";
import { ChevronDown, Shuffle } from "lucide-react";
import "./prompt-distribution.css";

export type PromptSourceGroup = {
  label: string;
  options: { key: string; label: string; imageCount?: number }[];
};

function shuffle<T>(items: T[]) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function distributePromptSources(sources: string[], count: number) {
  const order = shuffle(sources);
  return shuffle(Array.from({ length: count }, (_, index) => order[index % order.length]));
}

export function PromptDistribution({ groups, count, disabled, prefersOcr, onDistribute }: {
  groups: PromptSourceGroup[];
  count: number;
  disabled: boolean;
  prefersOcr: boolean;
  onDistribute: (sources: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindOverride, setKind] = useState<string | null>(null);
  const kind = kindOverride ?? (prefersOcr ? "ocr" : "all");
  const visible = groups.map(group => ({
    ...group,
    options: group.options.filter(option => {
      const images = option.imageCount ?? 0;
      if (kind === "ocr") return images === 1;
      if (kind === "visual") return images > 0;
      if (kind === "text") return images === 0;
      return true;
    }),
  })).filter(group => group.options.length);
  const available = visible.flatMap(group => group.options.map(option => option.key));
  const sources = available.filter(key => selected.includes(key));
  const allSelected = !!available.length && sources.length === available.length;

  function toggle(key: string) {
    setError("");
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  }

  async function distribute() {
    if (disabled || loading || !sources.length) return;
    setLoading(true);
    setError("");
    try {
      await onDistribute(distributePromptSources(sources, count));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="prompt-distribution">
      <summary><Shuffle size={16} aria-hidden="true" /> Girdileri rastgele dağıt <ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="distribution-body">
        <p>Bir veya daha fazla kaynak seçin. Dağıtım {count} etkin kutunun içeriğini değiştirir.</p>
        <div className="distribution-filter">
          <label>Kaynak türü
            <select value={kind} disabled={disabled || loading} onChange={e => {
              setKind(e.target.value);
              setSelected([]);
              setError("");
            }}>
              <option value="all">Tüm kaynaklar</option>
              <option value="text">Metin kaynakları</option>
              <option value="visual">Görsel kaynakları</option>
              <option value="ocr">Tek görselli kaynaklar (OCR)</option>
            </select>
          </label>
          <button type="button" className="button small-button" disabled={disabled || loading || !available.length} onClick={() => {
            setError("");
            setSelected(allSelected ? [] : available);
          }}>{allSelected ? "Seçimi temizle" : "Tümünü seç"}</button>
        </div>
        {available.length ? (
          <div className="distribution-sources">
            {visible.map(group => (
              <fieldset key={group.label} disabled={disabled || loading}>
                <legend>{group.label}</legend>
                <div className="distribution-options">
                  {group.options.map(option => (
                    <label key={option.key}>
                      <input type="checkbox" checked={selected.includes(option.key)} onChange={() => toggle(option.key)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        ) : <p>Bu türde kaynak yok. Kayıtlı girdiler bölümünden yeni bir kaynak ekleyebilirsiniz.</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="distribution-actions">
          <small>{sources.length} kaynak seçili{sources.length > count && ` · Bu dağıtımda ${count} farklı kaynak kullanılacak`}</small>
          <button type="button" className="button" disabled={disabled || loading || !sources.length} onClick={distribute}>
            <Shuffle size={15} aria-hidden="true" /> {loading ? "Kaynaklar yükleniyor…" : `Rastgele doldur · ${count} girdi`}
          </button>
        </div>
      </div>
    </details>
  );
}
