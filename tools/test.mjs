// npm test — 명령줄·MCP 엔진이 제대로 도는지 빠르게 확인한다 (인터넷 없이).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
import * as K from "./core.mjs";

const out = K.tmpDir();
const { D, stats } = K.loadData();
let n = 0;
const t = async (name, fn) => { await fn(); n++; process.stdout.write(`ok ${n} ${name}\n`); };

await t("지역 찾기", () => {
  assert.equal(K.resolveRegion(D, "유성구").full, "대전광역시 유성구");
  assert.equal(K.resolveRegion(D, "대전 중구").key, "si:30140");
  assert.throws(() => K.resolveRegion(D, "중구"), /여러 곳/);
  assert.equal(K.resolveRegion(D, "30").full, "대전광역시");
});
await t("대전 주변 시군구", () => {
  const names = [...K.neighbors(D, "대전광역시", "시군구").items.map((i) => i.name)].sort(); // vm 에서 읽은 배열이라 펼쳐서 비교
  assert.deepEqual(names, ["계룡시", "공주시", "금산군", "논산시", "보은군", "세종시", "옥천군", "청주시"]);
});
await t("기본 통계", () => {
  const [row] = K.statValues(D, stats, ["대전광역시"], ["pop", "old60R"]);
  assert.ok(row["총인구"] > 1e6);
  assert.ok(row["60세 이상 비율"] > 10 && row["60세 이상 비율"] < 50);
});
await t("지점 핀 (좌표·주소)", async () => {
  const items = await K.placePins(D, "대전시청\t36.3504,127.3845\n세종청사\t세종특별자치시 어진동", { online: false });
  assert.equal(items[0].q, "정확");
  assert.ok(Object.values(items[0].keys).includes("si:30170")); // 서구
  assert.ok(items[1].keys);
});
await t("주변 지역 지도 → svg·png·pptx", async () => {
  const r = await K.renderSpec({ region: "대전광역시", stat: "old60R", statLabels: ["pop"], title: "대전 주변", source: true }, { out });
  assert.equal(r.files.length, 3);
  for (const f of r.files) assert.ok(fs.statSync(f).size > 1000, f);
  assert.equal(r.colored, 9);
  assert.ok(fs.readFileSync(r.files[0], "utf8").includes("공주시"));
});
await t("여러 곳 고르기 · 육각 타일 · 내 표", async () => {
  const table = "지역\t찬성\t반대\n천안시\t52\t40\n아산시\t45\t48\n공주시\t39\t55";
  const r = await K.renderSpec({ regions: ["충청남도"], unit: "시군구", layout: "육각", data: { table, poll: true } }, { out, formats: ["svg"], name: "충남" });
  assert.equal(r.colored, 3);
  assert.equal(r.unmatched.length, 0);
});
await t("전국 · 17개 시도", async () => {
  const r = await K.renderSpec({ nationalUnit: "시도", sido17: true, stat: "yoyR" }, { out, formats: ["svg"], name: "전국" });
  assert.equal(r.colored, 17);
  K.R.useSido17(D, false);
});
await t("지시선 · 양옆 줄", async () => {
  // 세종 읍면동: 안 들어가는 동 이름은 지시선으로 밖에 쓴다
  const r = await K.renderSpec({ region: "세종", inner: "읍면동" }, { out, formats: ["svg"], name: "세종" });
  const svg = fs.readFileSync(r.files[0], "utf8");
  assert.ok(svg.includes('id="지시선"'));
  assert.ok(svg.includes("한솔동") && svg.includes("조치원읍"));
  // 양옆으로 모두 빼기: 왼쪽 줄은 오른쪽 끝을 맞춘다
  const r2 = await K.renderSpec({ nationalUnit: "시도", stat: "yoyR", statLabels: ["yoyR"], labels: "side" }, { out, formats: ["svg"], name: "양옆" });
  const s2 = fs.readFileSync(r2.files[0], "utf8");
  assert.ok((s2.match(/text-anchor="end"/g) || []).length >= 8);
});
await t("원 크기 지도", async () => {
  const r = await K.renderSpec({ region: "대전광역시", stat: "pop", bubbles: true }, { out, formats: ["svg", "pptx"], name: "원" });
  const svg = fs.readFileSync(r.files[0], "utf8");
  assert.ok((svg.match(/<circle/g) || []).length >= 9 + 3); // 지역 9곳 + 범례 3
  assert.deepEqual(r.legend.items.length, 0);
});
await t("확대 상자", async () => {
  const r = await K.renderSpec({ nationalUnit: "시군구", insets: ["서울", "광주"], labels: "none" }, { out, formats: ["svg"], name: "확대" });
  const svg = fs.readFileSync(r.files[0], "utf8");
  assert.ok(svg.includes('id="확대"') && svg.includes("확대 서울") && svg.includes("확대 광주"));
  await assert.rejects(K.renderSpec({ nationalUnit: "시군구", insets: ["제주"] }, { out, formats: ["svg"] }), /확대 상자를 만들 수 없는 곳/);
});
await t("슬라이드 여러 장", async () => {
  const r = await K.renderSpec({ each: { in: "대전광역시", unit: "시군구" }, stat: "old60R", title: "{지역} 고령 인구" }, { out, name: "묶음" });
  assert.equal(r.slides, 5);
  assert.ok(r.items.some((it) => it.title === "유성구 고령 인구"));
  assert.ok(fs.statSync(r.files[0]).size > 10000 && r.files[0].endsWith(".pptx"));
});
await t("통계 MCP 결과(rows) · 출처 문구", async () => {
  const rows = [{ 지역: "광진구", 청년비율: 31.2 }, { 지역: "강남구", 청년비율: 29.1 }, { 지역: "부산 중구", 청년비율: 20 }];
  assert.equal(K.rowsToTable(rows).split("\n")[0], "지역\t청년비율");
  const r = await K.renderSpec({ regions: ["서울특별시"], unit: "시군구", data: { rows }, source: "통계청 KOSIS(DT_TEST)" }, { out, formats: ["svg"], name: "rows" });
  assert.equal(r.colored, 2); // 부산 중구는 서울 지도에 없다
  assert.ok(r.source.startsWith("출처: 통계청 KOSIS(DT_TEST), 경계:"));
});
await t("색 하나로 색 조합 · 디자인 방식", async () => {
  const th = K.Cl.themeFrom("#13A07F");
  assert.ok(K.Cl.lch(th.neighbor)[0] > K.Cl.lch(th.target)[0]); // 주변은 대상보다 밝다
  const L = K.Cl.rampStops("#13A07F").map((h) => K.Cl.lch(h)[0]);
  assert.ok(L.every((v, i) => !i || v < L[i - 1])); // 단계는 밝음 → 진함
  const r = await K.renderSpec({ region: "대전광역시", stat: "old60R", baseColor: "#13A07F" }, { out, formats: ["svg"], name: "base" });
  assert.ok(fs.readFileSync(r.files[0], "utf8").includes(th.target));
  const marks = { 유리: "bgGrad", 네온: "neonGlow", 소프트: "softRaise", 입체: 'id="입체"' };
  for (const [look, mark] of Object.entries(marks)) {
    const q = await K.renderSpec({ region: "대전광역시", look }, { out, formats: ["svg", "pptx"], name: "look_" + look });
    assert.ok(fs.readFileSync(q.files[0], "utf8").includes(mark), look);
  }
  await assert.rejects(K.renderSpec({ region: "대전광역시", look: "없는디자인" }, { out, formats: ["svg"] }), /디자인 방식을 알 수 없습니다/);
});
await t("코드만 있는 표 (2·5·10자리)", async () => {
  for (const [code, unit, key] of [["30", "sido", "sido:30"], ["30170", "si", "si:30170"], ["3017000000", "si", "si:30170"]]) {
    const ds = K.X.analyze(K.X.readTable(`코드\t값\n${code}\t100`));
    const res = K.X.resolve(D, ds, [unit], K.R.sidoShort);
    assert.deepEqual(res.unmatched, []);
    assert.equal(ds.columns[0].get(res.recs[key]), 100);
  }
  const r = await K.renderSpec({ nationalUnit: "시군구", data: { rows: [{ 코드: "3017000000", 값: 100 }, { 코드: "3020000000", 값: 200 }] } }, { out, formats: ["svg"], name: "코드" });
  assert.equal(r.colored, 2);
  assert.deepEqual(r.unmatched, []);
});
await t("상위 합계와 하위 지역의 중복 합산 방지", () => {
  for (const rows of [
    [["대전 서구", 100], ["대전광역시 서구 둔산1동", 40], ["대전 유성구", 200]],
    [["대전광역시 서구 둔산1동", 40], ["대전 유성구", 200], ["대전 서구", 100]],
    [["3017000000", 100], ["3017063000", 40], ["3020000000", 200]],
  ]) {
    const head = /^\d/.test(rows[0][0]) ? "코드" : "지역";
    const ds = K.X.analyze(K.X.readTable([[head, "값"], ...rows].map(r => r.join("\t")).join("\n")));
    const res = K.X.resolve(D, ds, ["sido", "si"], K.R.sidoShort);
    assert.equal(ds.columns[0].get(res.recs["sido:30"]), 300);
    assert.equal(ds.columns[0].get(res.recs["si:30170"]), 100);
  }
  const ds = K.X.analyze(K.X.readTable("지역\t값\n대전광역시 서구 둔산1동\t40\n대전광역시 서구 둔산2동\t60"));
  const res = K.X.resolve(D, ds, ["sido", "si"], K.R.sidoShort);
  assert.equal(ds.columns[0].get(res.recs["sido:30"]), 100);
  assert.equal(ds.columns[0].get(res.recs["si:30170"]), 100);
});
await t("묶음의 애매한 지역명 경고 (JSON·명령줄)", async () => {
  const spec = { slides: [{ nationalUnit: "시군구", data: { rows: [{ 지역: "중구", 값: 10 }] } }] };
  const r = await K.renderSpec(spec, { out, formats: ["svg"], name: "경고" });
  assert.deepEqual(r.items[0].ambiguous, ["중구"]);
  const file = path.join(out, "경고.json");
  fs.writeFileSync(file, JSON.stringify(spec));
  const stdout = execFileSync(process.execPath, [path.join(K.ROOT, "tools/krmap.mjs"), "render", file, "--out", out, "--format", "svg"], { encoding: "utf8" });
  assert.match(stdout, /여러 곳인 이름 중구/);
});
await t("PNG 투명·불투명 배경 (한 장·묶음)", async () => {
  for (const background of [false, true]) {
    const spec = { region: "대전광역시", background, context: false, aspect: "16:9" };
    for (const deck of [false, true]) {
      const r = await K.renderSpec(deck ? { slides: [spec] } : spec, { out, formats: ["png"], width: 400, pngScale: 1, name: `배경_${background}_${deck}` });
      const png = PNG.sync.read(fs.readFileSync(r.files[0]));
      const alpha = png.data.filter((_, i) => i % 4 === 3);
      assert.equal(alpha.includes(0), !background);
      assert.ok(alpha.includes(255));
      if (background) assert.ok(alpha.every(a => a === 255));
    }
  }
});
fs.rmSync(out, { recursive: true, force: true });
process.stdout.write(`\n${n}개 모두 통과\n`);
