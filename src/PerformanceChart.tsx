import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  niceAxis,
  sampleAt,
  segmentsFor,
  seriesFor,
  type ChartMetric,
  type ChartModel,
} from "./chart-data";
import "./performance-chart.css";

const display = (value: number, digits = 1) =>
  value.toLocaleString("tr-TR", { maximumFractionDigits: digits });
const tick = (value: number) =>
  value >= 10000
    ? display(value / 1000) + "k"
    : display(value, value < 1 ? 3 : 2);
const patterns = ["", "7 4", "2 4", "9 3 2 3"];
export function PerformanceChart({
  phase,
  models: initialModels = [],
}: {
  phase?: { models: ChartModel[] };
  models?: ChartModel[];
}) {
  const [metric, setMetric] = useState<ChartMetric>("throughput");
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [inspection, setInspection] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () =>
      setPlotWidth(
        Math.max(280, Math.round(element.getBoundingClientRect().width)),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [mobile, setMobile] = useState(
    window.matchMedia("(max-width:680px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width:680px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const models = phase?.models || initialModels;
  const series = models.map((model) => ({
    model,
    points: seriesFor(model, metric),
  }));
  const points = series.flatMap((item) => item.points);
  const measured = points.filter((point) => point.value !== null);
  const maxTime = points.reduce((max, point) => Math.max(max, point.time), 0);
  const maxValue = measured.reduce(
    (max, point) => Math.max(max, point.value!),
    0,
  );
  const width = plotWidth || (mobile ? 360 : 800);
  const xAxis = niceAxis(maxTime, width < 500 ? 3 : width < 700 ? 4 : 5, 5);
  const yAxis = niceAxis(maxValue * 1.08, 4, metric === "tokens" ? 100 : 100);
  const height = mobile ? 250 : 270,
    left = 58,
    right = 20,
    top = 20,
    bottom = 40;
  const x = (time: number) =>
    left + (time / xAxis.max) * (width - left - right);
  const y = (value: number) =>
    top + (1 - value / yAxis.max) * (height - top - bottom);
  const selectedTime = Math.min(
    xAxis.max,
    Math.max(0, hover ?? inspection ?? maxTime),
  );
  const visible = series.filter((item) => !hidden.includes(item.model.id));
  const hasData = visible.some((item) =>
    item.points.some((point) => point.value !== null),
  );
  function pointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        xAxis.max,
        ((((e.clientX - rect.left) / rect.width) * width - left) /
          (width - left - right)) *
          xAxis.max,
      ),
    );
  }
  function pathFor(segment: { time: number; value: number }[]) {
    return segment
      .map(
        (point, i) =>
          `${i === 0 ? "M" : metric === "tokens" ? "H" : "L"} ${x(point.time)}${i === 0 || metric !== "tokens" ? " " + y(point.value) : " V " + y(point.value)}`,
      )
      .join(" ");
  }
  return (
    <div className="performance-chart">
      <div className="performance-heading">
        <div>
          <h3>
            {metric === "tokens"
              ? "Üretilen çıktı tokenları"
              : "Toplam çıktı verimi"}
          </h3>
          <p>
            {metric === "tokens"
              ? "Kümülatif token sayısı"
              : "Toplam çıktı tokenı / geçen süre"}
          </p>
        </div>
        <select
          aria-label="Grafikte gösterilecek metrik"
          value={metric}
          onChange={(e) => {
            setMetric(e.target.value as ChartMetric);
            setInspection(null);
            setHover(null);
          }}
        >
          <option value="throughput">Verim · tok/sn</option>
          <option value="tokens">Çıktı · token</option>
        </select>
      </div>
      {models.length > 0 && (
        <div className="performance-legend" aria-label="Grafikteki modeller">
          {series.map(({ model }, i) => (
            <button
              key={model.id}
              aria-pressed={!hidden.includes(model.id)}
              onClick={() =>
                setHidden((prev) =>
                  prev.includes(model.id)
                    ? prev.filter((id) => id !== model.id)
                    : [...prev, model.id],
                )
              }
            >
              <svg viewBox="0 0 27 8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="27"
                  y2="4"
                  stroke={model.color}
                  strokeWidth="2.5"
                  strokeDasharray={patterns[i % 4]}
                />
              </svg>
              <span>{model.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="performance-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${metric === "tokens" ? "Çıktı tokenları" : "Toplam verim"}: model başına geçen süre grafiği`}
          onPointerMove={(e) => setHover(pointer(e))}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => setInspection(pointer(e))}
        >
          <title>
            {metric === "tokens"
              ? "Sağlayıcı tarafından bildirilen çıktı tokenları"
              : "Model fazının başlangıcından itibaren toplam çıktı / geçen süre"}
          </title>
          <text x={left} y="11" className="plot-unit">
            {metric === "tokens" ? "token" : "tok/sn"}
          </text>
          {yAxis.ticks.map((value) => (
            <g key={value}>
              <line
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                className="plot-grid"
              />
              <text x={left - 10} y={y(value) + 4} textAnchor="end">
                {tick(value)}
              </text>
            </g>
          ))}
          {xAxis.ticks.map((time) => (
            <g key={time}>
              <line
                x1={x(time)}
                x2={x(time)}
                y1={top}
                y2={height - bottom}
                className="plot-time-grid"
              />
              <text x={x(time)} y={height - bottom + 23} textAnchor="middle">
                {tick(time)}
              </text>
            </g>
          ))}
          <text
            x={width - right}
            y={height - 3}
            textAnchor="end"
            className="plot-axis-title"
          >
            Geçen süre (sn)
          </text>
          {hasData &&
            visible.map(({ model, points }) => {
              const index = series.findIndex(
                (item) => item.model.id === model.id,
              );
              const segments = segmentsFor(points);
              const last = points.filter((p) => p.value !== null).at(-1);
              return (
                <g key={model.id}>
                  {segments.map((segment, i) => (
                    <path
                      key={i}
                      d={pathFor(segment)}
                      stroke={model.color}
                      strokeWidth="2.6"
                      strokeDasharray={patterns[index % 4]}
                      fill="none"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {last && (
                    <circle
                      cx={x(last.time)}
                      cy={y(last.value!)}
                      r="4"
                      fill={model.color}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  )}
                </g>
              );
            })}
          {hasData && (hover !== null || inspection !== null) && (
            <g>
              <line
                x1={x(selectedTime)}
                x2={x(selectedTime)}
                y1={top}
                y2={height - bottom}
                className="plot-cursor"
              />
              {visible.map(({ model, points }) => {
                const p = sampleAt(points, selectedTime);
                return p ? (
                  <circle
                    key={model.id}
                    cx={x(p.time)}
                    cy={y(p.value!)}
                    r="5"
                    fill="#fff"
                    stroke={model.color}
                    strokeWidth="2"
                  />
                ) : null;
              })}
            </g>
          )}
        </svg>
        {!hasData && (
          <div className="performance-empty">
            <Activity size={24} />
            <b>
              {!visible.length && models.length
                ? "Bir modeli görünür yap"
                : phase
                  ? "Token ölçümleri henüz hazır değil"
                  : "İlk karşılaştırmanı başlat"}
            </b>
            <span>
              {phase
                ? "Eksik ölçümler sıfır olarak çizilmez."
                : "Modellerin zaman içindeki verimi burada karşılaştırılır."}
            </span>
          </div>
        )}
      </div>
      {hasData && (
        <div className="performance-inspector">
          <label htmlFor={`chart-time-${models.map((m) => m.id).join("-")}`}>
            <span>
              {hover === null && inspection === null
                ? "Son ölçümler"
                : "İncelenen süre"}
            </span>
            <b>{display(selectedTime, 2)} sn</b>
          </label>
          <input
            id={`chart-time-${models.map((m) => m.id).join("-")}`}
            aria-label="Grafikte süreyi incele"
            type="range"
            min="0"
            max={maxTime || xAxis.max}
            step={Math.max(0.001, (maxTime || xAxis.max) / 1000)}
            value={Math.min(selectedTime, maxTime || xAxis.max)}
            onChange={(e) => {
              setHover(null);
              setInspection(Number(e.target.value));
            }}
          />
          <div className="performance-readings">
            {visible.map(({ model, points }) => {
              const point = sampleAt(points, selectedTime);
              return (
                <div key={model.id}>
                  <span>
                    <i style={{ background: model.color }} />
                    {model.name}
                  </span>
                  <b>
                    {point
                      ? display(point.value!, metric === "tokens" ? 0 : 2)
                      : "—"}
                    <small>{metric === "tokens" ? "token" : "tok/sn"}</small>
                  </b>
                  <small>
                    {point
                      ? `${display(point.time, 2)} sn ölçümü`
                      : "Bu sürede veri yok"}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="performance-caption">
        Her eğri kendi model fazının başlangıcına göre hizalanır. Token sayısı
        sağlayıcıdan geldikçe güncellenir. Faz tamamlandığında son nokta toplam
        sonucu gösterir.
      </p>
    </div>
  );
}
