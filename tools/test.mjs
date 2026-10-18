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
fs.rmSync(out, { recursive: true, force: true });
process.stdout.write(`\n${n}개 모두 통과\n`);
