import { useId } from "react";

type TokenEvent = { index: number; first_token_offset_s?: number | null };
type TokenModel = { id: string; name: string; color: string; requests: TokenEvent[] };

function tokenRange(requests: TokenEvent[]) {
  let first: { index: number; time: number } | undefined;
  let last: { index: number; time: number } | undefined;
  let count = 0;
  for (const row of requests) {
    const time = row.first_token_offset_s;
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0) continue;
    count++;
    const event = { index: row.index, time };
    if (!first || time < first.time) first = event;
    if (!last || time > last.time) last = event;
  }
  return { first, last, count };
}

function TokenTime({ event }: { event?: { index: number; time: number } }) {
  return <dd>{event ? (
    <>
      <b>{event.time.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} sn</b>
      <small>Girdi {String(event.index + 1).padStart(2, "0")}</small>
    </>
  ) : "—"}</dd>;
}

export function FirstTokenTiming({ models, recorded, stream }: {
  models: TokenModel[];
  recorded: boolean;
  stream: boolean;
}) {
  const heading = useId();
  return <section className="first-token-timing" aria-labelledby={heading}>
    <h3 id={heading}>İlk token zaman aralığı</h3>
    {!stream ? (
      <p>Normal JSON yanıtlarında yanıtın tamamı birlikte gelir. İlk token zamanı ölçülmez.</p>
    ) : !recorded ? (
      <p>Bu raporda faz zaman damgaları bulunmuyor. İstek başına TTFT değerleri İstek detayları tablosunda yer alır.</p>
    ) : <>
      <p>Süreler her modelin seçili fazının başlangıcından hesaplanır. İlk içerik veya reasoning parçası ölçüme girer.</p>
      <div className="first-token-groups">
        {models.map(model => {
          const { first, last, count } = tokenRange(model.requests);
          const total = model.requests.length;
          return <div className="first-token-group" key={model.id}>
            <h4><i style={{ background: model.color }} />{model.name}</h4>
            <dl>
              <div><dt>İlk gelen</dt><TokenTime event={first} /></div>
              <div><dt>{count > 0 && count === total ? "Son gelen" : "Son gözlenen"}</dt><TokenTime event={last} /></div>
              <div><dt>İlk token alındı</dt><dd><b>{count.toLocaleString("tr-TR")} / {total.toLocaleString("tr-TR")}</b><small>istek</small></dd></div>
            </dl>
          </div>;
        })}
      </div>
    </>}
  </section>;
}
