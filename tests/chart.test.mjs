import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../src/chart-data.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { niceAxis, seriesFor, segmentsFor, sampleAt } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const base = { id: "a", name: "fixture", color: "#000" };
test('late sampler points cannot replace the completed phase endpoint',()=>{
  const series=seriesFor({...base,history:[{time_s:1,throughput:20},{time_s:2.01,throughput:900}],summary:{wall_s:2,throughput:50}},'throughput');
  assert.deepEqual(series,[{time:1,value:20},{time:2,value:50}]);
});
test("short and long runs use data-driven, bounded axes", () => {
  assert.ok(niceAxis(1.1, 5).max < 5);
  assert.ok(niceAxis(73, 5).max >= 73);
  assert.ok(niceAxis(73, 5).ticks.length <= 6);
  assert.ok(niceAxis(0).max > 0);
  assert.equal(niceAxis(Number.NaN).max, 1);
});
test("missing/invalid usage is a gap, not a measured zero", () => {
  const series = seriesFor(
    {
      ...base,
      history: [
        { time_s: 1, throughput: 12 },
        { time_s: 2, throughput: null },
        { time_s: 3, throughput: NaN },
        { time_s: 4, throughput: 8 },
        { time_s: -1, throughput: 99 },
      ],
    },
    "throughput",
  );
  assert.deepEqual(
    series.map((p) => p.value),
    [12, null, null, 8],
  );
  assert.equal(segmentsFor(series).length, 2);
  assert.equal(sampleAt(series, 2.5), null);
});
test("final summary overrides duplicate sample time and matches report metric", () => {
  const series = seriesFor(
    {
      ...base,
      history: [{ time_s: 2, throughput: 100, tokens: 200 }],
      summary: { wall_s: 2, throughput: 50, output_tokens: 100 },
    },
    "throughput",
  );
  assert.deepEqual(series, [{ time: 2, value: 50 }]);
  assert.deepEqual(
    seriesFor(
      { ...base, summary: { wall_s: 2, output_tokens: 100 } },
      "tokens",
    ),
    [{ time: 2, value: 100 }],
  );
});
test("unsorted and duplicate samples normalize without manufacturing origin", () => {
  const series = seriesFor(
    {
      ...base,
      history: [
        { time_s: 2, throughput: 10 },
        { time_s: 1, throughput: 5 },
        { time_s: 2, throughput: 15 },
      ],
    },
    "throughput",
  );
  assert.deepEqual(series, [
    { time: 1, value: 5 },
    { time: 2, value: 15 },
  ]);
  assert.equal(sampleAt(series, 0.9), null);
  assert.deepEqual(sampleAt(series, 1.5), { time: 1, value: 5 });
});
test("measured zero is valid but unknown final values stay unknown", () => {
  assert.deepEqual(
    seriesFor(
      {
        ...base,
        summary: { wall_s: 2, throughput: null, output_tokens: null },
      },
      "throughput",
    ),
    [],
  );
  assert.deepEqual(
    seriesFor({ ...base, history: [{ time_s: 1, tokens: 0 }] }, "tokens"),
    [{ time: 1, value: 0 }],
  );
});
