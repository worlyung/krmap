// 지도 옆 차트 (ztd-charts): 지도와 같은 값으로 순위 막대 · 분포 차트를 그려 지도와 한 장으로 붙인다.
// ztd-charts · react · react-dom 은 선택 의존성이다. 없으면 charts 를 쓸 때만 설치 안내 오류를 낸다.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../web/render.js");
const St = require("../web/state.js");
const Cl = require("../web/colors.js");

const TYPES = { rank: "rank", 순위: "rank", bar: "rank", 막대: "rank", distribution: "distribution", 분포: "distribution", beeswarm: "distribution" };
const CHART_W = 560; // ztd 로 그리는 폭. 지도 옆 칸에 맞춰 키운다

/** spec.charts → [{type, ...}] (true 면 순위 · 분포 둘 다) */
export function parseCharts(v) {
  if (v == null || v === false) return [];
  const list = v === true ? ["rank", "distribution"] : [].concat(v);
  if (list.length > 3) throw new Error("charts 는 세 개까지 넣을 수 있습니다");
  return list.map((c) => {
    const o = typeof c === "string" ? { type: c } : Object.assign({}, c);
    const t = TYPES[String(o.type || "").trim().toLowerCase()] || TYPES[String(o.type || "").trim()];
    if (!t) throw new Error(`차트 종류를 알 수 없습니다: ${o.type} (rank·순위 / distribution·분포)`);
    o.type = t;
    return o;
  });
}

let ztd = null;
async function loadZtd() {
  if (ztd) return ztd;
  try {
    ztd = await import("ztd-charts/server");
  } catch (e) {
    throw new Error("차트를 그리려면 ztd-charts 가 필요합니다: npm install ztd-charts react react-dom (" + e.message + ")");
  }
  return ztd;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
/** 지도의 값 형식(fmt)에서 단위 · 소수 자리를 읽는다 ("43.9%" → %, 1자리) */
function formatOf(fmt) {
  if (!fmt) return { unit: "", digits: 1 };
  const s = String(fmt(1234.56789));
  const unit = s.replace(/[\d.,\s+\-−]/g, "");
  const m = s.match(/\.(\d+)/);
  return { unit, digits: m ? m[1].length : 0 };
}
/** 지역 이름: 같은 이름이 둘 이상이면 시도 이름을 붙인다 (중구 → 대전 중구) */
function namer(D, keys) {
  const base = (k) => { const [lv, id] = k.split(":"); return D[lv][id].nm; };
  const count = {};
  keys.forEach((k) => { const n = base(k); count[n] = (count[n] || 0) + 1; });
  return (k) => {
    const [lv, id] = k.split(":"), f = D[lv][id], n = f.nm;
    return count[n] > 1 && lv !== "sido" ? R.sidoShort(D.sido[f.sido].nm) + " " + n : n;
  };
}

/** 지도 밖 같은 단위의 값 (분포에서 "그 외" 무리) */
function nationalValues(D, S, ctx, lv) {
  const T = St.mergeState(St.defaultState(), JSON.parse(St.serialize(S)));
  T.mode = "all";
  T.allLv = lv;
  const c2 = St.createContext({ stats: ctx.stats, bigText: ctx.bigText, emdReady: ctx.emdReady });
  const dr = St.dataResult(D, T, c2);
  return dr && dr.nums ? dr.nums : {};
}

/** 지도 색에서 차트 색을: 강조는 데이터 색 단계의 가장 진한 색, 나머지는 옅은 색 */
function themeOf(S, legend, bg) {
  const ramp = legend ? legend.items.map((i) => i.color).filter((c) => /^#[0-9a-f]{6}$/i.test(c)) : [];
  const dark = bg ? Cl.isDark(bg) : false;
  const pick = (light, darkC) => (dark ? darkC : light);
  const accent = ramp.length ? pick(ramp[ramp.length - 1], ramp[Math.max(0, ramp.length - 2)]) : S.colors.target;
  const t = {
    accent, accentText: accent, ink: S.colors.text,
    neutral: ramp.length > 2 ? pick(ramp[1], ramp[ramp.length - 3]) : S.colors.neighbor,
    neutralSoft: ramp.length ? pick(ramp[0], ramp[1] || ramp[0]) : S.colors.context,
    neutralStrong: ramp.length > 2 ? ramp[Math.floor(ramp.length / 2)] : S.colors.target,
    fontFamily: "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
  };
  if (bg) { t.bg = bg; t.panel = bg; }
  return { base: dark ? "dark" : "light", tokens: t };
}

/**
 * 지도 데이터 → ztd 차트 스펙들. 숫자 값으로 칠한 지도에서만 그린다.
 * 반환: {specs: [ztd spec], summary: [{type, takeaway}]}
 */
export function chartSpecs(D, S, ctx, list, opts = {}) {
  const dr = St.dataResult(D, S, ctx);
  if (!dr || dr.kind !== "num" || !dr.nums) throw new Error("charts 는 숫자 값으로 칠한 지도에서만 그릴 수 있습니다 (stat 이나 data.by · ratio)");
  const keys = Object.keys(dr.nums).filter((k) => isFinite(dr.nums[k]));
  if (keys.length < 2) throw new Error("차트를 그릴 값이 두 곳 이상 있어야 합니다");
  const { unit, digits } = formatOf(dr.fmt);
  const round = (v) => Math.round(v * 10 ** digits) / 10 ** digits;
  const show = (v) => (dr.fmt ? dr.fmt(v) : String(round(v)));
  const nameOf = namer(D, keys);
  const label = (dr.legend && dr.legend.title) || (S.legend && S.legend.title) || "값";
  const format = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  // 강조 지역: 직접 준 것 → 주변 지도의 대상 → 가장 큰 값
  const target = S.mode === "around" ? S.target.lv + ":" + S.target.id : null;
  let hi = opts.highlight && keys.includes(opts.highlight) ? opts.highlight : target && keys.includes(target) ? target : null;
  const sorted = keys.slice().sort((a, b) => dr.nums[b] - dr.nums[a]);
  if (!hi) hi = sorted[0];
  const specs = [], summary = [];
  let no = 0;
  for (const c of list) {
    const num = String(++no).padStart(2, "0");
    if (c.type === "rank") {
      const top = c.top != null ? +c.top : sorted.length > 20 ? 15 : sorted.length;
      let rows = sorted.slice(0, top), extra = false;
      if (!rows.includes(hi)) { rows = rows.slice(0, top - 1).concat(hi); extra = true; } // 강조 지역은 늘 보이게
      const data = rows.map((k) => ({ 지역: nameOf(k), 값: round(dr.nums[k]) }));
      const first = sorted[0], last = sorted[sorted.length - 1];
      const rank = sorted.indexOf(hi) + 1;
      let takeaway;
      if (hi !== first) takeaway = `${nameOf(hi)} ${show(dr.nums[hi])}, ${sorted.length}곳 중 ${rank}위`;
      else if (dr.nums[last] > 0 && dr.nums[first] / dr.nums[last] >= 1.5) takeaway = `${nameOf(first)} ${show(dr.nums[first])}, ${nameOf(last)}의 ${(dr.nums[first] / dr.nums[last]).toFixed(1)}배`;
      else takeaway = `${nameOf(first)} ${show(dr.nums[first])}, 가장 낮은 ${nameOf(last)} ${show(dr.nums[last])}`;
      takeaway = c.takeaway || takeaway;
      specs.push({
        type: "bar", data, encoding: { x: "지역", y: "값" },
        options: { orientation: "horizontal", sort: true, highlight: nameOf(hi), unit, format, locale: "ko-KR", animate: false },
        card: { number: num, title: c.title || (extra ? `상위 ${rows.length - 1}곳과 ${nameOf(hi)}` : rows.length < sorted.length ? `상위 ${rows.length}곳` : "지역별 순위"), subtitle: c.subtitle || label + (unit ? ` (${unit})` : ""), takeaway },
      });
      summary.push({ type: "rank", takeaway });
    } else {
      const lv = hi.split(":")[0] === "sido" && keys.some((k) => !k.startsWith("sido:")) ? keys.find((k) => !k.startsWith("sido:")).split(":")[0] : hi.split(":")[0];
      const rest = c.compare === false ? {} : nationalValues(D, S, ctx, lv);
      const inMap = new Set(keys);
      const others = Object.keys(rest).filter((k) => !inMap.has(k) && isFinite(rest[k]));
      const mine = `지도 속 ${keys.length}곳`, theirs = `그 외 ${others.length}곳`;
      const all = [...keys, ...others];
      const nm2 = namer(D, all);
      const data = keys.map((k) => ({ 지역: nm2(k), 무리: mine, 값: round(dr.nums[k]) }))
        .concat(others.map((k) => ({ 지역: nm2(k), 무리: theirs, 값: round(rest[k]) })));
      const mMine = median(keys.map((k) => dr.nums[k])), mRest = median(others.map((k) => rest[k]));
      const takeaway = c.takeaway || (others.length ? `지도 속 중앙값 ${show(mMine)}, 그 외 ${show(mRest)}` : `중앙값 ${show(mMine)}`);
      const enc = others.length ? { value: "값", group: "무리", label: "지역" } : { value: "값", label: "지역" };
      specs.push({
        type: "beeswarm", data, encoding: enc,
        options: { highlight: others.length ? mine : nameOf(hi), unit, format, showMedian: true, locale: "ko-KR", animate: false, radius: all.length > 600 ? 3 : 5 },
        card: { number: num, title: c.title || (others.length ? "전국 속 위치" : "값의 분포"), subtitle: c.subtitle || `${others.length ? "같은 단위 " + all.length + "곳의 " : ""}${label}${unit ? ` (${unit})` : ""}`, takeaway },
      });
      summary.push({ type: "distribution", takeaway });
    }
  }
  return { specs, summary, theme: themeOf(S, dr.legend, opts.bg) };
}

const svgSize = (s) => { const m = s.match(/^<svg[^>]*?width="([\d.]+)"[^>]*?height="([\d.]+)"/); return m ? [+m[1], +m[2]] : [CHART_W, 300]; };
/** 바깥 <svg> 를 x·y·크기를 가진 안쪽 <svg> 로 */
const nest = (s, x, y, k) => {
  const [w, h] = svgSize(s);
  return s.replace(/^(<svg[^>]*?)\s+viewBox="[^"]*"/, "$1").replace(/^<svg([^>]*?)\swidth="[\d.]+"([^>]*?)\sheight="[\d.]+"/, `<svg$1 x="${x}" y="${y}" width="${w * k}"$2 height="${h * k}" viewBox="0 0 ${w} ${h}"`);
};

/**
 * 지도 SVG + 차트 → 한 장. 지도 왼쪽, 차트는 오른쪽 칸에 위에서부터.
 * 반환: {svg, width, height, map: {x, y}, charts: [{svg, x, y, w, h}]}
 */
export async function composeBoard(mapSvg, scene, specs, theme) {
  const z = await loadZtd();
  const W = scene.width, H = scene.height, bg = scene.bg || "#FFFFFF";
  const colW = Math.round(W * 0.52), pad = Math.round(W * 0.03), gap = Math.round(W * 0.018);
  const k = (colW - pad) / CHART_W;
  const charts = specs.map((sp) => {
    const svg = z.renderSpecToSVG(sp, { width: CHART_W, theme: Object.assign({}, theme.tokens), locale: "ko-KR", background: false, padding: 0 });
    const [w, h] = svgSize(svg);
    return { svg, w: w * k, h: h * k };
  });
  const colH = charts.reduce((s, c) => s + c.h, 0) + gap * (charts.length - 1);
  const height = Math.round(Math.max(H, colH + pad * 2));
  const width = W + colW + Math.round(pad / 2);
  const mapY = Math.round((height - H) / 2);
  let y = Math.round((height - colH) / 2);
  for (const c of charts) { c.x = W + Math.round(pad / 2); c.y = y; y += c.h + gap; }
  const inner = mapSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const vb = (mapSvg.match(/^<svg[^>]*viewBox="([^"]*)"/) || [])[1] || `0 0 ${W} ${H}`;
  const font = (mapSvg.match(/^<svg[^>]*font-family="([^"]*)"/) || [])[1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${font ? ` font-family="${font}"` : ""}>
<rect width="${width}" height="${height}" fill="${bg}"/>
<svg x="0" y="${mapY}" width="${W}" height="${H}" viewBox="${vb}">${inner}</svg>
${charts.map((c) => nest(c.svg, c.x, c.y, k)).join("\n")}
</svg>`;
  return { svg, width, height, map: { x: 0, y: mapY }, charts };
}
