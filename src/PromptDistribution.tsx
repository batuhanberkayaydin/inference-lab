import { useState } from "react";
import { ArrowRight, ChevronDown, Image, Shuffle } from "lucide-react";
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

export function distributePromptSources<T>(sources: T[], count: number) {
  const order = shuffle(sources);
  return shuffle(Array.from({ length: count }, (_, index) => order[index % order.length]));
}

export function PromptDistribution({ groups, count, disabled, prefersOcr, maxCount, onDistribute }: {
  groups: PromptSourceGroup[];
  count: number;
  disabled: boolean;
  prefersOcr: boolean;
  maxCount: number;
  onDistribute: (sources: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindOverride, setKind] = useState<string | null>(null);
  const kind = prefersOcr ? "visual" : kindOverride ?? "all";
  const visible = groups.map(group => ({
    ...group,
    options: group.options.filter(option => {
      const images = option.imageCount ?? 0;
      if (kind === "visual") return images > 0;
      if (kind === "text") return images === 0;
      return true;
    }),
  })).filter(group => group.options.length);
  const options = visible.flatMap(group => group.options);
  const available = options.map(option => option.key);
  const selectedOptions = options.filter(option => selected.includes(option.key));
  const sources = selectedOptions.map(option => option.key);
  const imageCount = selectedOptions.reduce((sum, option) => sum + (option.imageCount ?? 0), 0);
  const targetCount = prefersOcr ? Math.max(count, imageCount) : count;
  const overLimit = prefersOcr && targetCount > maxCount;
  const allSelected = !!available.length && sources.length === available.length;

  function toggle(key: string) {
    setError("");
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  }

  async function distribute() {
    if (disabled || loading || overLimit || !sources.length) return;
    setLoading(true);
    setError("");
    try {
      await onDistribute(sources);
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
        <div className="distribution-filter">
          {prefersOcr ? (
            <span className="distribution-profile"><Image size={16} aria-hidden="true" /> Görsel kaynakları <small>LightOnOCR</small></span>
          ) : <label>Kaynak türü
            <select value={kind} disabled={disabled || loading} onChange={e => {
              setKind(e.target.value);
              setSelected([]);
              setError("");
            }}>
              <option value="all">Tüm kaynaklar</option>
              <option value="text">Metin kaynakları</option>
              <option value="visual">Görsel kaynakları</option>
            </select>
          </label>}
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
        {overLimit && <p className="request-limit" role="status">Bu çalışma düzeninde model başına en çok {maxCount.toLocaleString("tr-TR")} istek hazırlanabilir. Daha az kaynak seç veya modelleri sırayla çalıştır.</p>}
        <div className="distribution-actions">
          <div className="distribution-plan" role="status">
            {prefersOcr && imageCount > 0 ? (
              <>
                <b>{imageCount} görsel <ArrowRight size={14} aria-hidden="true" /> {targetCount} ayrı istek</b>
                <small>{targetCount > count ? `Kutu sayısı ${count} → ${targetCount}.` : "Her kutuya bir görsel yerleşecek."} Dağıtım etkin kutuları değiştirir.</small>
              </>
            ) : (
              <>
                <b>{sources.length} kaynak seçili</b>
                <small>{sources.length > count ? `${count} farklı kaynak kullanılacak. ` : ""}Dağıtım {count} etkin kutunun içeriğini değiştirir.</small>
              </>
            )}
          </div>
          <button type="button" className="button" disabled={disabled || loading || overLimit || !sources.length} onClick={distribute}>
            <Shuffle size={15} aria-hidden="true" /> {loading ? "Kaynaklar yükleniyor…" : `Rastgele doldur · ${targetCount} girdi`}
          </button>
        </div>
      </div>
    </details>
  );
}
