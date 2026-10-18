// web/data 의 경계 데이터로 PPT용 SVG 파일 묶음을 만든다.
//   node scripts/export_svgs.js            → svg/ 아래 전체
//   node scripts/export_svgs.js 대전        → 이름에 '대전'이 들어간 것만
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const R = require("../web/render.js");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "svg");
const filter = process.argv[2] || "";

const D = {};
const ctx = { KRMAP_LOAD: (name, data) => { if (name === "base") Object.assign(D, data); else { D.emd = data.emd; Object.assign(D.nb, data.nb); Object.assign(D.nb17, data.nb17 || {}); } } };
vm.createContext(ctx);
for (const f of ["base.js", "emd.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, "web/data", f), "utf8"), ctx);

const fname = (t) => t.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_") + ".svg";
let count = 0;
function write(dir, name, scene) {
  if (filter && !name.includes(filter)) return;
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  fs.writeFileSync(path.join(OUT, dir, fname(name)), R.toSVG(scene));
  count++;
}

const sidoIds = Object.keys(D.sido);

// 전국
write("01_전국", "전국_시도", R.buildScene(D, { inner: "sido", width: 1200, shortSido: true }));
write("01_전국", "전국_시군구", R.buildScene(D, { inner: "si", width: 1600 }));
write("01_전국", "전국_시군구_일반구", R.buildScene(D, { inner: "sgg", width: 1600 }));

// 시도: 시군구로 나눈 지도 / 주변 시군구
for (const id of sidoIds) {
  const nm = D.sido[id].nm;
  write("02_시도", nm, R.buildScene(D, { target: { lv: "sido", id }, inner: "si", depth: 0, nbLevel: "si" }));
  write("03_시도_주변", `${nm}_주변`, R.buildScene(D, { target: { lv: "sido", id }, depth: 1, nbLevel: "si" }));
}

// 시군구(일반구는 시로 통합): 읍면동으로 나눈 지도 / 주변 시군구
for (const id of Object.keys(D.si)) {
  const f = D.si[id];
  const nm = `${R.sidoShort(D.sido[f.sido].nm)}_${f.nm}`;
  write("04_시군구", nm, R.buildScene(D, { target: { lv: "si", id }, inner: "emd", depth: 0, nbLevel: "si" }));
  write("05_시군구_주변", `${nm}_주변`, R.buildScene(D, { target: { lv: "si", id }, depth: 1, nbLevel: "si" }));
}
// 17개 시도(광주·전남 나눔) 판: 전국 시도 지도와 광주·전남 지도만 따로 둔다
if (R.useSido17(D, true)) {
  write("01_전국", "전국_시도_17개", R.buildScene(D, { inner: "sido", width: 1200, shortSido: true }));
  for (const id of Object.keys(D.sido17)) {
    const nm = D.sido[id].nm;
    write("02_시도", nm, R.buildScene(D, { target: { lv: "sido", id }, inner: "si", depth: 0, nbLevel: "si" }));
    write("03_시도_주변", `${nm}_주변`, R.buildScene(D, { target: { lv: "sido", id }, depth: 1, nbLevel: "si" }));
  }
  R.useSido17(D, false);
}
console.log(`wrote ${count} SVG files to svg/`);
