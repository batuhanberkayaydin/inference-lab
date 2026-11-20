export const MAX_CONCURRENT_REQUESTS = 1024;
export const REQUESTS_PER_PAGE = 24;

export function parseRequestCount(value: string) {
  const count = Number(value);
  return /^\d+$/.test(value) && count >= 1 && count <= MAX_CONCURRENT_REQUESTS ? count : null;
}

export function RequestCount({ label, value, onChange, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const parsed = parseRequestCount(value);
  return (
    <div className="request-count">
      <label>
        {label}
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-invalid={parsed === null}
          disabled={disabled}
        />
      </label>
      <label>
        Listeden seç
        <select aria-label={label + " · listeden seç"} value={parsed ?? ""} disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="" disabled>1–{MAX_CONCURRENT_REQUESTS}</option>
          {Array.from({length: MAX_CONCURRENT_REQUESTS}, (_, i) => <option key={i + 1}>{i + 1}</option>)}
        </select>
      </label>
      {parsed === null && <small className="request-limit" role="status">1–{MAX_CONCURRENT_REQUESTS} arasında bir tam sayı girin.</small>}
    </div>
  );
}

export function RequestPage({ label, total, page, onChange }: {
  label: string;
  total: number;
  page: number;
  onChange: (index: number) => void;
}) {
  const pages = Math.ceil(total / REQUESTS_PER_PAGE);
  if (pages <= 1) return null;
  return (
    <label className="request-page">
      {label}
      <select value={page} onChange={e => onChange(Number(e.target.value))}>
        {Array.from({length: pages}, (_, index) => (
          <option key={index} value={index}>
            {index * REQUESTS_PER_PAGE + 1}–{Math.min((index + 1) * REQUESTS_PER_PAGE, total)} / {total}
          </option>
        ))}
      </select>
    </label>
  );
}
