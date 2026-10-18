// npm test — 명령줄·MCP 엔진이 제대로 도는지 빠르게 확인한다 (인터넷 없이).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
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
fs.rmSync(out, { recursive: true, force: true });
process.stdout.write(`\n${n}개 모두 통과\n`);
