import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const chartMetrics = {
  e2e_tps: {
    option: "Ort. uçtan uca hız",
    title: "Ortalama uçtan uca istek hızı",
    description: "Her isteğin çıktı tokenı / toplam yanıt süresi. Ölçülebilen hızların ortalaması.",
    unit: "tok/sn",
  },
  stream_tps: {
    option: "Ort. akış hızı",
    title: "Ortalama akış hızı (tahmini)",
    description: "İlk ve son akış parçası arasındaki tahmini istek hızlarının ortalaması.",
    unit: "tok/sn",
  },
  throughput: {
    option: "Toplam verim",
    title: "Toplam çıktı verimi",
    description: "Toplam çıktı tokenı / model fazında geçen süre",
    unit: "tok/sn",
  },
  tokens: {
    option: "Çıktı tokenları",
    title: "Üretilen çıktı tokenları",
    description: "Kümülatif token sayısı",
    unit: "token",
  },
} satisfies Record<ChartMetric, { option: string; title: string; description: string; unit: string }>;

export function PerformanceChart({ phase }: { phase: { models: ChartModel[] } }) {
  const [metric, setMetric] = useState<ChartMetric>("e2e_tps");
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
  const models = phase.models;
  const selectedMetric = chartMetrics[metric];
  const perRequest = metric === "e2e_tps" || metric === "stream_tps";
  const series = useMemo(() => models.map((model) => ({
    model,
    points: seriesFor(model, metric),
  })), [models, metric]);
  const { maxTime, maxValue } = useMemo(() => {
    let maxTime = 0;
    let maxValue = 0;
    for (const {points} of series) {
      for (const point of points) {
        maxTime = Math.max(maxTime, point.time);
        if (point.value !== null) maxValue = Math.max(maxValue, point.value);
      }
    }
    return { maxTime, maxValue };
  }, [series]);
  const width = plotWidth || (mobile ? 360 : 800);
  const xAxis = niceAxis(maxTime, width < 500 ? 3 : width < 700 ? 4 : 5, 5);
  const yAxis = niceAxis(maxValue * 1.08, 4, 100);
  const height = mobile ? 250 : 270,
    left = 58,
    right = 20,
    top = 20,
    bottom = 40;
  const x = useCallback((time: number) =>
    left + (time / xAxis.max) * (width - left - right), [left, right, width, xAxis.max]);
  const y = useCallback((value: number) =>
    top + (1 - value / yAxis.max) * (height - top - bottom), [top, bottom, height, yAxis.max]);
  const selectedTime = Math.min(
    xAxis.max,
    Math.max(0, hover ?? inspection ?? maxTime),
  );
  const drawing = useMemo(() => series.map(({ model, points }, index) => ({
    model,
    points,
    index,
    paths: segmentsFor(points).map(segment => segment.map((point, position) => {
      const horizontal = x(point.time).toFixed(2);
      const vertical = y(point.value).toFixed(2);
      if (position === 0) return `M ${horizontal} ${vertical}`;
      return metric === "throughput" ? `L ${horizontal} ${vertical}` : `H ${horizontal} V ${vertical}`;
    }).join(" ")),
    last: points.filter(point => point.value !== null).at(-1),
  })), [series, metric, x, y]);
  const visible = drawing.filter((item) => !hidden.includes(item.model.id));
  const hasData = visible.some((item) => !!item.last);
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
  return (
    <div className="performance-chart">
      <div className="performance-heading">
        <div>
          <h3>{selectedMetric.title}</h3>
          <p>{selectedMetric.description}</p>
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
          {Object.entries(chartMetrics).map(([key, value]) => <option key={key} value={key}>{value.option}</option>)}
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
          aria-label={`${selectedMetric.title} · model fazında geçen süre grafiği`}
          onPointerMove={(e) => setHover(pointer(e))}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => setInspection(pointer(e))}
        >
          <title>{selectedMetric.description}</title>
          <rect x={left} y={top} width={width - left - right} height={height - top - bottom} rx="4" className="plot-surface" />
          <text x={left} y="11" className="plot-unit">
            {selectedMetric.unit}
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
            visible.map(({ model, paths, index, last }) => {
              return (
                <g key={model.id}>
                  {paths.map((path, i) => (
                    <path
                      key={i}
                      d={path}
                      stroke={model.color}
                      strokeWidth="2.6"
                      strokeDasharray={patterns[index % 4]}
                      fill="none"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {last && (
                    <g>
                    <line x1={x(last.time)} x2={x(last.time)} y1={y(last.value!)} y2={height - bottom} stroke={model.color} className="plot-final-guide" />
                    <circle cx={x(last.time)} cy={y(last.value!)} r="9" fill={model.color} opacity="0.14" />
                    <circle
                      cx={x(last.time)}
                      cy={y(last.value!)}
                      r="4"
                      fill={model.color}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                    </g>
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
              {!visible.length && models.length ? "Bir modeli görünür yap" : perRequest ? "Ölçülen istek hızı yok" : "Görüntülenecek token ölçümü yok"}
            </b>
            {visible.length > 0 && <span>{perRequest ? "Değerler, tamamlanan ve hızı ölçülebilen isteklerden gelir." : "Grafik, sağlayıcının bildirdiği token ölçümlerini gösterir."}</span>}
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
                    <small>{selectedMetric.unit}</small>
                  </b>
                  <small>
                    {point
                      ? `${display(point.time, 2)} sn ölçümü${point.measuredRequests != null ? ` · ${point.measuredRequests.toLocaleString("tr-TR")} istek` : ""}`
                      : "Bu sürede veri yok"}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="performance-caption">
        {hasData && visible.every(({ points }) => points.filter((point) => point.value !== null).length <= 1) &&
          (perRequest ? "Ara hız zamanları bulunamadığında son ortalama gösterilir. " : "Ara token ölçümü yok. ")}
        Her eğri kendi model fazının başlangıcına göre hizalanır. {perRequest
          ? "Ortalama, hızı ölçülebilen her başarılı istek tamamlandıkça güncellenir."
          : "Token sayısı sağlayıcıdan geldikçe güncellenir. Son nokta fazın toplam sonucunu gösterir."}
      </p>
    </div>
  );
}
