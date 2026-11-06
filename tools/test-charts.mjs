// 지도 옆 차트 (ztd-charts) 검사. ztd-charts 가 없으면 건너뛴다 (선택 의존성)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as K from "./core.mjs";
import { parseCharts, chartSpecs } from "./charts.mjs";

try { await import("ztd-charts/server"); } catch (e) { console.log("ztd-charts 없음: 차트 검사 건너뜀"); process.exit(0); }
const { D, stats } = K.loadData();
const out = path.join(K.ROOT, "out", "charts-test");
let count = 0;
const test = async (name, fn) => { await fn(); console.log("ok charts " + ++count + " " + name); };
const setup = async (spec) => {
  const { S, bigText, charts } = await K.specToState(D, spec, { stats });
  return { S, charts, ctx: K.St.createContext({ stats, bigText, emdReady: true }) };
};
const cn = { regions: ["충청남도"], unit: "시군구", stat: "old60R" };

await test("charts 칸 읽기·잘못된 종류", () => {
  assert.deepEqual(parseCharts(true).map((c) => c.type), ["rank", "distribution"]);
  assert.deepEqual(parseCharts(["순위", { type: "분포", title: "t" }]).map((c) => c.type), ["rank", "distribution"]);
  assert.deepEqual(parseCharts(undefined), []);
  assert.throws(() => parseCharts(["pie"]), /차트 종류/);
  assert.throws(() => parseCharts(["rank", "rank", "rank", "rank"]), /세 개/);
});

await test("순위: 값 순·가장 큰 곳 강조·지도와 같은 소수 자리", async () => {
  const { S, ctx, charts } = await setup({ ...cn, charts: ["rank"] });
  const { specs, summary } = chartSpecs(D, S, ctx, charts.list, {});
  const sp = specs[0];
  assert.equal(sp.type, "bar");
  assert.equal(sp.data.length, 15);
  assert.equal(sp.options.highlight, "서천군");
  assert.equal(sp.options.unit, "%");
  assert.equal(sp.options.format.maximumFractionDigits, 1);
  assert.ok(sp.data.every((r) => Math.round(r.값 * 10) === r.값 * 10));
  assert.match(summary[0].takeaway, /^서천군 55\.1%, 아산시의 2\.4배$/);
});

await test("주변 지도는 대상 지역을, chartHighlight 는 그 지역을 강조", async () => {
  let r = await setup({ region: "대전광역시", stat: "old60R", charts: ["rank"] });
  let sp = chartSpecs(D, r.S, r.ctx, r.charts.list, { highlight: r.charts.highlight }).specs[0];
  assert.equal(sp.options.highlight, "대전광역시");
  r = await setup({ nationalUnit: "시군구", stat: "yoyR", charts: [{ type: "rank", top: 10 }], chartHighlight: "화성시" });
  sp = chartSpecs(D, r.S, r.ctx, r.charts.list, { highlight: r.charts.highlight }).specs[0];
  assert.equal(sp.data.length, 10);
  assert.equal(sp.data.at(-1).지역, "화성시");
  assert.match(sp.card.title, /^상위 9곳과 화성시$/);
  assert.ok(new Set(sp.data.map((d) => d.지역)).size === 10, "같은 이름은 시도를 붙여 구분");
});

await test("분포: 지도 속 지역과 그 외 같은 단위", async () => {
  const { S, ctx, charts } = await setup({ ...cn, charts: ["distribution"] });
  const sp = chartSpecs(D, S, ctx, charts.list, {}).specs[0];
  const groups = [...new Set(sp.data.map((d) => d.무리))];
  assert.deepEqual(groups.map((g) => g.replace(/\d+/, "N")), ["지도 속 N곳", "그 외 N곳"]);
  assert.equal(sp.data.filter((d) => d.무리 === groups[0]).length, 15);
  assert.ok(sp.data.length > 200);
  assert.equal(sp.options.highlight, groups[0]);
});

await test("숫자로 칠하지 않은 지도는 알려 준다", async () => {
  const { S, ctx, charts } = await setup({ regions: ["충청남도"], unit: "시군구", data: { table: "지역\t찬성\t반대\n천안시\t52\t40\n아산시\t30\t60", poll: true }, charts: true });
  assert.throws(() => chartSpecs(D, S, ctx, charts.list, {}), /숫자 값/);
  const bare = await setup({ regions: ["충청남도"], unit: "시군구", charts: true });
  assert.throws(() => chartSpecs(D, bare.S, bare.ctx, bare.charts.list, {}), /숫자 값/);
});

await test("SVG·PNG·PPTX 한 장: 지도 + 차트", async () => {
  const r = await K.renderSpec({ ...cn, charts: true, title: "충남 고령" }, { out, formats: ["svg", "png", "pptx"], name: "충남" });
  assert.equal(r.files.length, 3);
  assert.equal(r.charts.length, 2);
  assert.ok(r.size[0] > 1600, "지도 옆에 차트 칸");
  const svg = fs.readFileSync(r.files[0], "utf8");
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
  assert.ok(svg.includes("서천군 55.1%, 아산시의 2.4배"));
  assert.equal((svg.match(/<svg/g) || []).length >= 4, true);
  const png = fs.readFileSync(r.files[1]);
  assert.equal(png.readUInt32BE(16), r.size[0] * 2);
  assert.ok(fs.statSync(r.files[2]).size > 50000);
});

await test("슬라이드 묶음에도 장마다 차트", async () => {
  const r = await K.renderSpec({ each: { regions: ["대전광역시", "세종"] }, stat: "youngR", charts: ["rank"], title: "{지역} 청년" }, { out, formats: ["pptx", "svg"], name: "묶음" });
  assert.equal(r.slides, 2);
  const svgs = r.files.filter((f) => f.endsWith(".svg")).map((f) => fs.readFileSync(f, "utf8"));
  assert.equal(svgs.length, 2);
  assert.ok(svgs[0].includes("대전광역시") && svgs[1].includes("세종"));
});

console.log(`${count}개 차트 검사 통과`);
