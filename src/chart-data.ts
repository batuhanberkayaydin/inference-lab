export type ChartMetric = "throughput" | "tokens";
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
};
export type PlotPoint = { time: number; value: number | null };
export function seriesFor(model: ChartModel, metric: ChartMetric): PlotPoint[] {
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
