// 행정구역 지도 엔진 (Node): 데이터 불러오기, 지역 찾기, 설정(spec) → state, SVG·PNG·PPTX 만들기.
// 명령줄(krmap.mjs)과 MCP 서버(mcp-server.mjs)가 함께 쓴다. 지도 그리기는 웹 도구와 같은 web/*.js 를 쓴다.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = require("../web/render.js");
const X = require("../web/datafill.js");
const Pn = require("../web/pins.js");
const St = require("../web/state.js");
const Px = require("../web/pptx.js");
export { R, X, Pn, St };

export const LEVEL_KO = { sido: "시도", si: "시군구", sgg: "시군구(일반구)", emd: "읍면동" };
const ORDER = R.LEVEL_ORDER;

// ---------- 데이터 ----------
let cache = null;
/** web/data 의 경계(base·emd)와 기본 통계(stats)를 읽는다. 한 번 읽으면 다시 쓴다. */
export function loadData() {
  if (cache) return cache;
  const D = {};
  let stats = null;
  const ctx = {
    KRMAP_LOAD: (name, data) => {
      if (name === "base") Object.assign(D, data, { nb: Object.assign({}, data.nb), nb17: Object.assign({}, data.nb17 || {}) });
      else if (name === "emd") { D.emd = data.emd; Object.assign(D.nb, data.nb); Object.assign(D.nb17, data.nb17 || {}); }
      else if (name === "stats") stats = data;
    },
  };
  vm.createContext(ctx);
  for (const f of ["base.js", "emd.js", "stats.js"]) {
    const p = path.join(ROOT, "web", "data", f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx);
  }
  cache = { D, stats };
  return cache;
}
export const boundaryVersion = (D) => St.version(D);

// ---------- 지역 찾기 ----------
/** "시군구", "si", "구" 같은 단위 이름 → sido | si | sgg | emd */
export function parseUnit(u, fallback) {
  if (u == null || u === "") return fallback;
  const t = String(u).trim().toLowerCase().replace(/[·\s]/g, "");
  if (["sido", "시도", "광역", "도"].includes(t)) return "sido";
  if (["si", "시군구", "시군", "시군구통합"].includes(t)) return "si";
  if (["sgg", "구", "일반구", "시군구(일반구)", "자치구"].includes(t)) return "sgg";
  if (["emd", "읍면동", "동", "읍면", "행정동"].includes(t)) return "emd";
  throw new Error(`단위를 알 수 없습니다: ${u} (시도 / 시군구 / 일반구 / 읍면동)`);
}
const norm = (t) => String(t).replace(/\s+/g, "").replace(/[()·.]/g, "");

/** 이름이나 행정기관코드로 지역 찾기 → [{key, lv, id, name, full}] (가까운 순) */
export function findRegions(D, query, opts = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const out = [];
  const add = (lv, id, score) => {
    const f = D[lv] && D[lv][id];
    if (lv === "sgg" && out.some((o) => o.key === "si:" + id)) return; // 구가 없는 시군구는 si 와 같은 곳
    if (f && !out.some((o) => o.key === lv + ":" + id)) out.push({ key: lv + ":" + id, lv, id, name: f.nm, full: f.full, score });
  };
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 2 && digits === q.replace(/\s/g, "")) {
    let c = digits;
    if (c.length === 10 && /0{8}$/.test(c)) c = c.slice(0, 2);
    else if (c.length === 10 && /0{5}$/.test(c)) c = c.slice(0, 5);
    if (c.length === 2) add("sido", c, 0);
    if (c.length === 5) { add("si", c, 0); add("sgg", c, 1); }
    if (c.length === 10) add("emd", c, 0);
  }
  const n = norm(q);
  const levels = (opts.levels || ["sido", "si", "sgg", "emd"]).filter((lv) => D[lv]);
  for (const lv of levels) {
    for (const id in D[lv]) {
      const f = D[lv][id];
      if (lv === "sgg" && !f.city && !(opts.levels || []).includes("sgg")) continue; // 구가 없는 시군구는 si 와 같다
      const sido = D.sido[f.sido] ? D.sido[f.sido].nm : "";
      const short = R.sidoShort(sido);
      const local = f.city && lv === "sgg" ? f.city + f.nm : f.nm;
      const names = [norm(f.full), lv === "sido" ? norm(short) : norm(short + local), norm(local), norm(f.nm)];
      let score = null;
      if (names[0] === n) score = 0;
      else if (names[1] === n) score = 1;
      else if (names[2] === n || names[3] === n) score = 2 + ORDER[lv] * 0.1;
      else if (names[0].includes(n)) score = 5 + ORDER[lv] * 0.1;
      if (score != null) add(lv, id, score);
    }
  }
  return out.sort((a, b) => a.score - b.score || ORDER[a.lv] - ORDER[b.lv] || a.full.length - b.full.length).slice(0, opts.limit || 20);
}
/** 지역 하나로 정한다. 여러 곳이 같은 점수로 걸리면 후보를 알려 주며 실패한다. */
export function resolveRegion(D, query, opts = {}) {
  if (query && typeof query === "object" && query.lv) return query;
  const hits = findRegions(D, query, opts);
  if (!hits.length) throw new Error(`지역을 찾지 못했습니다: ${query}`);
  const tied = hits.filter((h) => h.score === hits[0].score);
  if (tied.length > 1 && hits[0].score >= 2) {
    throw new Error(`"${query}" 에 해당하는 지역이 여러 곳입니다: ${tied.slice(0, 8).map((h) => h.full).join(", ")} — 시도 이름을 붙여 주세요 (예: "대전 중구")`);
  }
  return hits[0];
}
/** 한 지역을 다른 단위의 지역 목록으로: 더 잘게면 안쪽 지역들, 더 크게면 소속 지역 */
export function convert(D, lv, id, to) {
  if (lv === to) return [id];
  const f = D[lv][id];
  if (!f) return [];
  if (ORDER[to] > ORDER[lv] || (lv === "si" && to === "sgg")) return R.featuresInside(D, lv, id, to);
  if (to === "sido") return [f.sido];
  if (to === "si") return [f.si];
  if (to === "sgg") return f.sgg ? [f.sgg] : [];
  return [];
}
export function neighbors(D, query, unit = "si", depth = 1) {
  const r = resolveRegion(D, query);
  const lv = parseUnit(unit, "si");
  return { region: r, unit: lv, items: R.neighborsOf(D, r.lv, r.id, lv, depth).map((n) => ({ key: lv + ":" + n.id, name: D[lv][n.id].nm, full: D[lv][n.id].full, ring: n.ring })) };
}

// ---------- 기본 통계 ----------
export function indicators(stats) {
  if (!stats) return [];
  return stats.cols.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
}
function indicatorId(stats, q) {
  if (!q) return null;
  const cols = stats.cols;
  const hit = cols.find((c) => c.id === q) || cols.find((c) => norm(c.name) === norm(q)) || cols.find((c) => norm(c.name).includes(norm(q)));
  if (!hit) throw new Error(`기본 통계 지표를 찾지 못했습니다: ${q} — 'krmap indicators' 로 목록을 볼 수 있습니다`);
  return hit.id;
}
/** 지역들의 기본 통계 값 (비율은 인구 수에서 다시 계산) */
export function statValues(D, stats, regions, ids) {
  const ds = X.fromStats(stats);
  const want = (ids && ids.length ? ids : ["pop", "hh", "young", "youngR", "old60", "old60R", "yoy", "yoyR"]).map((q) => indicatorId(stats, q));
  const keys = regions.map((q) => resolveRegion(D, q));
  const levels = [...new Set(keys.map((k) => k.lv))];
  const res = X.resolve(D, ds, levels, R.sidoShort);
  return keys.map((k) => {
    const rec = res.recs[k.key];
    const row = { region: k.full, key: k.key };
    for (const id of want) {
      const col = ds.columns.find((c) => c.id === id);
      const v = rec ? col.get(rec) : null;
      row[col.name] = v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
    }
    return row;
  });
}

// ---------- 지점 핀 ----------
/**
 * 지점 목록 → 핀. list: 붙여넣은 글(이름⇥주소⇥분류) 또는 [{name, address, lat, lng, category}]
 * 위도·경도는 정확한 자리, 주소는 인터넷 검색(OpenStreetMap, online=true 일 때) → 안 되면 주소 속 동·시군구 가운데.
 */
export async function placePins(D, list, opts = {}) {
  const rows = typeof list === "string"
    ? Pn.parse(list)
    : list.map((p) => ({ name: p.name || p.address || "", addr: p.address || p.addr || "", cat: p.category || p.cat || "", ll: p.lat != null && p.lng != null ? [+p.lat, +p.lng] : Pn.latLng([String(p.address || "")]) }));
  const idx = Pn.aliasIndex(D, R.sidoShort);
  const items = [];
  let online = opts.online !== false;
  for (const it of rows) {
    let res = null;
    if (it.ll) {
      const [x, y] = Pn.toData(it.ll[0], it.ll[1]);
      res = { x, y, keys: Pn.locate(D, x, y, R.decode), q: "정확" };
    } else {
      if (online) {
        try {
          const ll = await Pn.geocodeOnline(it.addr);
          if (ll) { const [x, y] = Pn.toData(ll[0], ll[1]); const keys = Pn.locate(D, x, y, R.decode); if (keys) res = { x, y, keys, q: "인터넷 검색" }; }
          await new Promise((r) => setTimeout(r, 1100)); // Nominatim 이용 규칙: 1초에 한 번
        } catch (e) {
          online = false; // 막힌 곳에서는 더 시도하지 않는다
        }
      }
      if (!res) {
        const r = Pn.findRegion(D, it.addr, R.sidoShort, idx);
        if (r) { const [l, i] = r.key.split(":"); const lp = D[l][i].lp; res = { x: lp[0], y: lp[1], keys: Pn.keysOf(D, r.key), q: r.quality }; }
      }
    }
    items.push(Object.assign({ name: it.name, addr: it.addr, cat: it.cat }, res || { q: "못 찾음" }));
  }
  return items;
}

// ---------- 설정(spec) → state ----------
const LAYOUTS = { real: "real", 실제: "real", 실제지도: "real", explode: "explode", 벌려: "explode", 벌려놓기: "explode", square: "square", 네모: "square", 네모타일: "square", hex: "hex", 육각: "hex", 육각타일: "hex" };
const ASPECTS = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, auto: null, 자동: null };
const readMaybeFile = (v, base) => {
  if (v == null) return v;
  const p = path.resolve(base || process.cwd(), String(v));
  return typeof v === "string" && !v.includes("\n") && fs.existsSync(p) && fs.statSync(p).isFile() ? decodeText(fs.readFileSync(p)) : v;
};
/** 행정안전부 CSV 처럼 EUC-KR 인 파일도 읽는다 */
export function decodeText(buf) {
  const t = new TextDecoder("utf-8").decode(buf);
  if (!t.includes("\uFFFD")) return t;
  try { return new TextDecoder("euc-kr").decode(buf); } catch (e) { return t; }
}

/**
 * 사람이 쓰기 쉬운 spec(JSON) → 웹 도구와 같은 state.
 * 웹 도구의 "작업 저장" 파일({state: ...})을 그대로 넣어도 된다.
 * 자세한 칸은 docs/automation.md 참고.
 */
export async function specToState(D, spec, opts = {}) {
  const base = opts.baseDir;
  const S = St.defaultState();
  if (spec.state) {
    St.mergeState(S, spec.state);
    return { S, bigText: spec.fileText || "" };
  }
  const keyOf = (q, lv) => { const r = resolveRegion(D, q); return lv ? convert(D, r.lv, r.id, lv).map((id) => lv + ":" + id) : [r.key]; };

  if (spec.sido17) { S.sido17 = true; R.useSido17(D, true); } else R.useSido17(D, false);
  if (spec.splitGu) S.splitGu = true;

  // 지도 방식: regions(여러 곳) → 직접 고르기, region(한 곳) → 주변 지역, 아니면 전국
  if (spec.regions && spec.regions.length) {
    S.mode = "pick";
    const unit = parseUnit(spec.unit, null) || resolveRegion(D, spec.regions[0]).lv;
    S.pick.lv = unit === "sgg" && !S.splitGu ? "sgg" : unit;
    const ids = new Set();
    for (const q of spec.regions) keyOf(q, St.eff(S, S.pick.lv)).forEach((k) => ids.add(k.split(":")[1]));
    S.pick.ids = [...ids];
    S.pick.fit = spec.fit !== false;
    S.pick.hideOthers = !!spec.hideOthers;
  } else if (spec.region) {
    S.mode = "around";
    const r = resolveRegion(D, spec.region);
    S.target = { lv: r.lv, id: r.id };
    S.depth = spec.neighbors == null ? 1 : +spec.neighbors;
    S.nbLevel = parseUnit(spec.neighborUnit, "si");
    S.inner = spec.inner ? parseUnit(spec.inner) : "";
    if (spec.context === false) S.context = false;
  } else {
    S.mode = "all";
    S.allLv = parseUnit(spec.nationalUnit || spec.unit, "sido");
  }

  // 모양
  if (spec.layout) {
    S.layout = LAYOUTS[norm(spec.layout)] || LAYOUTS[spec.layout];
    if (!S.layout) throw new Error(`배치를 알 수 없습니다: ${spec.layout} (실제 / 벌려 / 네모 / 육각)`);
  }
  if (spec.explode != null) S.explodeAmt = +spec.explode;
  if (spec.tileGap != null) S.tileGap = +spec.tileGap;
  if (spec.theme != null) {
    const p = St.PRESETS.find((x) => x.name === spec.theme) || St.PRESETS[+spec.theme];
    if (!p) throw new Error(`색 테마를 알 수 없습니다: ${spec.theme} (${St.PRESETS.map((x) => x.name).join(" / ")})`);
    S.colors = Object.assign({}, p);
    if (p.fillBg) S.fillBg = true;
  }
  if (spec.colors) Object.assign(S.colors, spec.colors);
  for (const k of ["distinct", "shadow", "sidoLines", "halo", "subLabel"]) if (spec[k] != null) S[k] = !!spec[k];
  if (spec.background != null) S.fillBg = !!spec.background;
  if (spec.fontScale != null) S.fontScale = +spec.fontScale;
  if (spec.lineScale != null) S.lineScale = +spec.lineScale;
  if (spec.aspect != null) S.aspect = typeof spec.aspect === "number" ? spec.aspect : ASPECTS[spec.aspect] ?? null;

  // 지역 이름: "all" | "none" | [넣을 지역 이름]
  if (Array.isArray(spec.labels)) { S.labelMode = "pick"; S.labelPick = new Set(spec.labels.flatMap((q) => keyOf(q))); }
  else if (spec.labels === "none" || spec.labels === false) S.labelMode = "none";

  // 제목 · 범례
  if (spec.title) S.heading.title = spec.title;
  if (spec.subtitle) S.heading.subtitle = spec.subtitle;
  if (spec.source) S.heading.note = true;
  if (spec.legend != null) S.legend.pos = spec.legend === false ? "none" : spec.legend;
  if (spec.legendTitle) S.legend.title = spec.legendTitle;

  // 그룹: [{name, color, regions:[...]}]
  (spec.groups || []).forEach((g, i) => {
    const id = "g" + i;
    S.groups.push({ id, name: g.name || `그룹 ${i + 1}`, color: g.color || St.PIN_COLORS[i % St.PIN_COLORS.length] });
    for (const q of g.regions || []) for (const k of keyOf(q, g.unit ? parseUnit(g.unit) : null)) S.styles[k] = Object.assign({}, S.styles[k], { group: id });
  });
  // 지역별 꾸미기: {"대전 유성구": {fill, text, hideLabel}}
  for (const [q, st] of Object.entries(spec.styles || {})) for (const k of keyOf(q)) S.styles[k] = Object.assign({}, S.styles[k], st);

  // 데이터로 색칠
  let bigText = "";
  if (spec.stat) {
    S.data.source = "stats";
    S.data.by = { t: "col", c: indicatorId(opts.stats, spec.stat) };
    if (spec.statLabels) S.data.labels = [].concat(spec.statLabels).map((q) => indicatorId(opts.stats, q));
  }
  if (spec.data) {
    const d = typeof spec.data === "string" ? { table: spec.data } : spec.data;
    const text = d.file ? decodeText(fs.readFileSync(path.resolve(base || process.cwd(), d.file))) : readMaybeFile(d.table, base);
    S.data.source = "table";
    if (text.length > 150000) { S.data.file = d.file || "data.csv"; bigText = text; } else S.data.text = text;
    const ds = X.analyze(X.readTable(text));
    const col = (q) => {
      const c = ds.columns.find((x) => x.id === q || x.name === q) || ds.columns.find((x) => norm(x.name).includes(norm(q)));
      if (!c) throw new Error(`표에서 열을 찾지 못했습니다: ${q} (열: ${ds.columns.map((x) => x.name).join(", ")})`);
      return c.id;
    };
    if (d.poll) S.data.by = { t: "win", cols: (Array.isArray(d.poll) ? d.poll.map(col) : ds.columns.filter((c) => c.kind !== "text").map((c) => c.id)) };
    else if (d.ratio) S.data.by = { t: "ratio", a: col(d.ratio[0]), b: col(d.ratio[1]) };
    else if (d.by) S.data.by = { t: "col", c: col(d.by) };
    if (d.labels) S.data.labels = [].concat(d.labels).map(col);
  }
  // 데이터 색 단계: 따로 정하지 않으면 색 테마에 어울리는 것으로
  if (spec.palette == null && spec.theme != null) S.data.palette = { 코발트: "blue", 코랄: "red", 에메랄드: "green", 라벤더: "purple", 먹: "blue", 미드나잇: "viridis" }[S.colors.name] || "blue";
  for (const k of ["palette", "steps", "method"]) if (spec[k] != null) S.data[k] = spec[k];
  if (spec.showValues === false) S.data.showValues = false;

  // 지점 핀
  if (spec.pins) {
    const list = Array.isArray(spec.pins) ? spec.pins : readMaybeFile(spec.pins, base);
    S.pins.items = await placePins(D, list, { online: spec.geocode !== false });
    const ps = spec.pinStyle || {};
    if (ps.shape) S.pins.shape = { 물방울: "pin", 점: "dot", 네모: "square" }[ps.shape] || ps.shape;
    if (ps.color) S.pins.color = ps.color;
    if (ps.size) S.pins.size = +ps.size;
    if (ps.labels === false) S.pins.labels = false;
    if (ps.byCategory === false) S.pins.byCat = false;
    if (spec.colorByPins) { S.data.source = "pins"; S.data.by = null; }
  }
  if (S.data.source && S.legend.pos === "none" && spec.legend == null) S.legend.pos = "br";
  return { S, bigText };
}

// ---------- 만들기 ----------
const FONT_CANDIDATES = [
  ["Malgun Gothic", ["C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/malgunbd.ttf"]],
  ["Apple SD Gothic Neo", ["/System/Library/Fonts/AppleSDGothicNeo.ttc"]],
  ["Noto Sans CJK KR", ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc"]],
  ["NanumGothic", ["/usr/share/fonts/truetype/nanum/NanumGothic.ttf"]],
  ["WenQuanYi Zen Hei", ["/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"]],
];
/** PNG 에 쓸 한글 글꼴: 직접 준 파일 → 컴퓨터에 있는 맑은 고딕·애플 SD 고딕·Noto·나눔 순 */
function koreanFont(fontFile) {
  if (fontFile) return { files: [fontFile], family: null };
  for (const [family, files] of FONT_CANDIDATES) {
    const hit = files.filter((f) => fs.existsSync(f));
    if (hit.length) return { files: hit, family };
  }
  return { files: [], family: null };
}
export function svgToPng(svg, width, opts = {}) {
  const { Resvg } = require("@resvg/resvg-js");
  const font = koreanFont(opts.fontFile);
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width) },
    font: Object.assign({ loadSystemFonts: true, fontFiles: font.files }, font.family ? { defaultFontFamily: font.family, sansSerifFamily: font.family } : {}),
    background: opts.background || undefined,
  });
  return r.render().asPng();
}
export async function sceneToPptx(scene, footnote) {
  const PptxGenJS = require("pptxgenjs");
  const pptx = Px.buildPptx(PptxGenJS, scene, { footnote });
  return pptx.write({ outputType: "nodebuffer" });
}
const safeName = (t) => String(t).replace(/[\\/:*?"<>|]/g, "").replace(/[\s,]+/g, "_").slice(0, 80) || "지도";

/**
 * state → 파일들. out: 저장할 폴더 또는 "폴더/파일이름"(확장자 없이). formats: ["svg","png","pptx"]
 * 반환: {files, title, colored, legend, warnings, pins}
 */
export async function renderState(D, stats, S, bigText, opts = {}) {
  const ctx = St.createContext({ stats, bigText, emdReady: !!D.emd });
  const scene = R.buildScene(D, St.sceneOptions(D, S, ctx, opts.width || 1600));
  const formats = (opts.formats || ["svg", "png", "pptx"]).map((f) => String(f).toLowerCase());
  let out = opts.out || path.join(process.cwd(), "out");
  let dir = out, name = opts.name;
  if (!name) {
    // "폴더/이름.pptx" 처럼 확장자를 붙였으면 그 이름, 폴더만 주면 지도 제목으로
    if (path.extname(out)) { dir = path.dirname(out); name = path.basename(out, path.extname(out)); }
    else name = safeName(S.heading.title || scene.title);
  }
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const svg = R.toSVG(scene);
  if (formats.includes("svg")) { const f = path.join(dir, name + ".svg"); fs.writeFileSync(f, svg); files.push(f); }
  let png = null;
  if (formats.includes("png") || opts.preview) png = svgToPng(svg, scene.width * (opts.pngScale || 2), { fontFile: opts.fontFile, background: scene.bg || (opts.transparent ? undefined : "#FFFFFF") });
  if (formats.includes("png")) { const f = path.join(dir, name + ".png"); fs.writeFileSync(f, png); files.push(f); }
  if (formats.includes("pptx")) {
    const f = path.join(dir, name + ".pptx");
    fs.writeFileSync(f, await sceneToPptx(scene, S.heading.note ? "" : `${St.sourceNote(D, S, ctx)} · github.com/vuski/admdongkor`));
    files.push(f);
  }
  const dr = St.dataResult(D, S, ctx);
  const ex = St.extras(D, S, ctx);
  return {
    files,
    title: S.heading.title || scene.title,
    size: [scene.width, scene.height],
    colored: dr ? Object.keys(dr.fills).length : 0,
    unmatched: dr ? dr.unmatched.slice(0, 20) : [],
    ambiguous: dr ? dr.ambiguous.slice(0, 20) : [],
    legend: ex.legend ? { title: ex.legend.title, items: ex.legend.items.map((i) => i.label) } : null,
    pins: S.pins.items.map((p) => ({ name: p.name, quality: p.q })),
    warnings: scene.warning ? [scene.warning] : [],
    preview: opts.preview ? svgToPng(svg, Math.min(opts.previewWidth || 900, scene.width), { fontFile: opts.fontFile, background: scene.bg || "#FFFFFF" }) : null,
    source: St.sourceNote(D, S, ctx),
  };
}
/** spec 하나로 끝까지 */
export async function renderSpec(spec, opts = {}) {
  const { D, stats } = loadData();
  const { S, bigText } = await specToState(D, spec, { stats, baseDir: opts.baseDir });
  return renderState(D, stats, S, bigText, Object.assign({ formats: spec.formats, width: spec.width, name: spec.name }, opts, { out: opts.out || spec.out }));
}
export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "krmap-"));
