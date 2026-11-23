type RequestRateMetric = "e2e_tps" | "stream_tps";
export type ChartMetric = "throughput" | "tokens" | RequestRateMetric;
export type HistoryPoint = {
  time_s: number;
  tokens: number | null;
  throughput: number | null;
};
export type ChartModel = {
  id: string;
  name: string;
  color: string;
  status?: string;
  history?: HistoryPoint[];
  summary?: Record<string, number | null> | null;
  requests?: RateRequest[];
};
type RateRequest = {
  status: string;
  output_tokens?: number | null;
  e2e_s?: number | null;
  stream_tps?: number | null;
  completed_offset_s?: number | null;
};
export type PlotPoint = { time: number; value: number | null; measuredRequests?: number };

function nonnegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requestRate(row: RateRequest, metric: RequestRateMetric) {
  if (row.status !== "completed" || !nonnegative(row.output_tokens)) return null;
  const seconds = row.e2e_s;
  const rate = metric === "stream_tps" ? row.stream_tps
    : typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? row.output_tokens / seconds
    : null;
  return nonnegative(rate) ? rate : null;
}

export function averageRequestRate(rows: RateRequest[], metric: RequestRateMetric = "e2e_tps") {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const rate = requestRate(row, metric);
    if (rate === null) continue;
    sum += rate;
    count++;
  }
  return { value: count ? sum / count : null, count };
}

function requestRateSeries(model: ChartModel, metric: RequestRateMetric): PlotPoint[] {
  const rows = model.requests ?? [];
  const final = averageRequestRate(rows, metric);
  if (final.value === null) return [];
  const wall = model.summary?.wall_s;
  const end = nonnegative(wall) && wall > 0 ? wall : null;
  const samples: { time: number; rate: number }[] = [];
  for (const row of rows) {
    const rate = requestRate(row, metric);
    if (rate === null) continue;
    const time = row.completed_offset_s;
    // Older reports can provide a final average without an event timeline.
    if (!nonnegative(time) || (end !== null && time > end)) {
      return end === null ? [] : [{ time: end, value: final.value, measuredRequests: final.count }];
    }
    samples.push({ time, rate });
  }
  samples.sort((a, b) => a.time - b.time);
  const points = new Map<number, PlotPoint>();
  let sum = 0;
  samples.forEach(({ time, rate }, index) => {
    sum += rate;
    points.set(time, { time, value: sum / (index + 1), measuredRequests: index + 1 });
  });
  const lastEvent = samples[samples.length - 1].time;
  const latestSample = (model.history ?? []).reduce((latest, point) =>
    nonnegative(point.time_s) ? Math.max(latest, point.time_s) : latest, lastEvent);
  const last = end ?? latestSample;
  points.set(last, { time: last, value: final.value, measuredRequests: final.count });
  return [...points.values()];
}

export function seriesFor(model: ChartModel, metric: ChartMetric): PlotPoint[] {
  if (metric === "e2e_tps" || metric === "stream_tps") return requestRateSeries(model, metric);
  const points = new Map<number, number | null>();
  for (const point of model.history || []) {
    if (!Number.isFinite(point.time_s) || point.time_s < 0) continue;
    const value = point[metric];
    points.set(
      point.time_s,
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null,
    );
  }
  const summary = model.summary;
  const wall = summary?.wall_s;
  const value = summary?.[metric === "tokens" ? "output_tokens" : "throughput"];
  if (
    typeof wall === "number" &&
    Number.isFinite(wall) &&
    wall > 0 &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  ) {
    // A sampler can finish slightly after the phase timer; the summary is the endpoint.
    for (const time of points.keys()) if (time > wall) points.delete(time);
    points.set(wall, value);
  }
  return [...points]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}
export function niceAxis(max: number, intervals = 4, fallback = 1) {
  const raw = Number.isFinite(max) && max > 0 ? max : fallback;
  const step = raw / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const ratio = step / magnitude;
  const unit =
    ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10;
  const spacing = unit * magnitude;
  const end = Math.ceil(raw / spacing) * spacing;
  return {
    max: end,
    ticks: Array.from({ length: Math.round(end / spacing) + 1 }, (_, i) =>
      Number((i * spacing).toPrecision(12)),
    ),
  };
}
export function segmentsFor(points: PlotPoint[]) {
  const segments: { time: number; value: number }[][] = [];
  let current: { time: number; value: number }[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ time: point.time, value: point.value });
  }
  if (current.length) segments.push(current);
  return segments;
}
export function sampleAt(points: PlotPoint[], time: number) {
  let result: PlotPoint | null = null;
  for (const point of points) {
    if (point.time > time) break;
    result = point;
  }
  return result?.value != null ? result : null;
}
