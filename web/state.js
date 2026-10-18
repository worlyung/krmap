/*
 * 지도 설정(state) → 렌더 옵션. 웹 도구(app.js), 명령줄(tools/krmap.mjs), MCP 서버가 함께 쓴다.
 * state 는 웹 도구의 "작업 저장" 파일에 들어가는 것과 같은 모양이다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./render.js"), require("./datafill.js"), require("./colors.js"));
  else root.KRMapState = factory(root.KRMapRender, root.KRMapData, root.KRMapColors);
})(typeof self !== "undefined" ? self : this, function (R, X, Cl) {
  const ORDER = R.LEVEL_ORDER;

  // 색 테마: 대상 · 주변 · 나머지 · 경계선 · 시도 경계 · 글자 · 바탕
  const PRESETS = [
    { name: "코발트", target: "#3361E0", neighbor: "#C9D6F6", context: "#EDF0F4", line: "#FFFFFF", sidoLine: "#9AA6B5", text: "#1E2633", bg: "#FFFFFF" },
    { name: "코랄", target: "#EF5B4C", neighbor: "#F9D3CB", context: "#F3EFEC", line: "#FFFFFF", sidoLine: "#B9A9A2", text: "#2D211E", bg: "#FFFFFF" },
    { name: "에메랄드", target: "#0F9F84", neighbor: "#BEE6DB", context: "#EDF2F0", line: "#FFFFFF", sidoLine: "#93ABA4", text: "#16302A", bg: "#FFFFFF" },
    { name: "라벤더", target: "#6A4CD6", neighbor: "#DAD0F6", context: "#F0EEF6", line: "#FFFFFF", sidoLine: "#A69EBD", text: "#231D3A", bg: "#FFFFFF" },
    { name: "먹", target: "#262B33", neighbor: "#C5CAD1", context: "#EEF0F2", line: "#FFFFFF", sidoLine: "#9AA0A8", text: "#1C1F24", bg: "#FFFFFF" },
    { name: "미드나잇", target: "#F2B33D", neighbor: "#2E4A75", context: "#1B283B", line: "#0F1A2B", sidoLine: "#5D7393", text: "#EAF0F8", bg: "#0F1A2B", fillBg: true },
  ];
  const PIN_COLORS = ["#E5484D", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#78716C"];

  function defaultState() {
    return {
      mode: "around", // around(주변 지역) | pick(영역 직접 고르기) | all(전국)
      sido17: false,
      splitGu: false,
      target: { lv: "sido", id: "30" },
      depth: 1,
      nbLevel: "si",
      inner: "",
      context: true,
      pick: { lv: "sido", ids: [], fit: true, hideOthers: false },
      allLv: "sido",
      insets: [], // 전국 지도 확대 상자: ["서울", "부산", ...]
      labelMode: "all", // all | none | pick
      labelPick: new Set(), // "lv:id"
      clickAction: "main",
      layout: "real", // real | explode | square | hex
      explodeAmt: 0.25,
      tileGap: 0.1,
      heading: { title: "", subtitle: "", note: false, noteText: "" },
      data: { source: "", text: "", file: "", palette: "blue", steps: 5, method: "quantile", showValues: true, by: null, labels: null, symbol: "fill", bubbleScale: 1 },
      pins: { text: "", items: [], shape: "pin", color: "#E5484D", size: 1, labels: true, byCat: true, online: true },
      groups: [], // [{id, name, color}] — 지역의 styles[key].group 으로 연결
      activeGroup: null,
      legend: { title: "", pos: "br" },
      panel: "region",
      offsets: {}, // "lv:id" → [dx, dy] (데이터 좌표)
      styles: {}, // "lv:id" → {fill, text, hideLabel, group}
      editKey: null,
      subLabel: true,
      leaders: true, // 안 들어가는 이름은 밖에 놓고 지시선으로 잇기
      labelPlace: "auto", // auto(지역 안, 안 들어가면 지시선) | side(양옆 줄로 모두 빼기)
      halo: false,
      fontScale: 1,
      sidoLines: true,
      lineScale: 1,
      colors: Object.assign({}, PRESETS[0]),
      distinct: false,
      shadow: true,
      fillBg: false,
      aspect: null,
      look: "flat", // 디자인: flat(기본) | glass(유리) | paper(입체) | soft(소프트) | neon(네온)
    };
  }

  /** 저장된 state(작업 파일)를 기본값 위에 겹친다. 바깥 모양이 달라도 아는 칸만 받아들인다. */
  function mergeState(S, o) {
    for (const k of Object.keys(S)) {
      if (!(k in o)) continue;
      if (k === "labelPick") S.labelPick = new Set(o.labelPick || []);
      else if (S[k] && typeof S[k] === "object" && !Array.isArray(S[k]) && o[k] && typeof o[k] === "object" && !(S[k] instanceof Set)) S[k] = Object.assign({}, S[k], o[k]);
      else S[k] = o[k];
    }
    S.editKey = null;
    // 예전 작업 파일: 데이터 출처가 없고 표만 있으면 표로 칠한다
    if (S.data.source == null || (S.data.source === "" && (S.data.text || S.data.file) && !("source" in (o.data || {})))) S.data.source = S.data.text || S.data.file ? "table" : "";
    return S;
  }
  const serialize = (S) => JSON.stringify(Object.assign({}, S, { labelPick: [...S.labelPick], editKey: null }));

  /** 데이터·캐시를 담는 실행 환경: stats(기본 통계), bigText(큰 CSV), emdReady(읍면동 로드 여부) */
  function createContext(extra) {
    return Object.assign({ stats: null, bigText: "", emdReady: false, dsCache: { key: null, ds: null, ver: 0 }, dataCache: { sig: null, res: null }, statsDs: null }, extra);
  }

  const eff = (S, lv) => (lv === "si" && S.splitGu ? "sgg" : lv);
  function innerFor(D, S, target) {
    if (!S.inner) return null;
    const lv = eff(S, S.inner);
    if (ORDER[lv] <= ORDER[target.lv]) return null;
    if (lv === "sgg" && !(target.lv === "sido" || (target.lv === "si" && D.si[target.id].gu))) return null;
    return lv;
  }
  function needsEmd(S) {
    if (S.mode === "pick") return S.pick.lv === "emd";
    if (S.mode === "all") return S.allLv === "emd";
    return S.nbLevel === "emd" || S.inner === "emd" || S.target.lv === "emd";
  }
  /** 지금 지도에 그려지는 단위들 (붙여넣은 이름을 여기서 찾는다) */
  function drawnLevels(D, S) {
    if (S.mode === "pick") return [eff(S, S.pick.lv)];
    if (S.mode === "all") return [eff(S, S.allLv)];
    return [...new Set([eff(S, S.nbLevel), S.target.lv, innerFor(D, S, S.target)].filter(Boolean))];
  }
  /** 지금 지도에서 칠해질 수 있는 지역 key */
  function visibleKeys(D, S) {
    const out = new Set();
    if (S.mode === "pick") {
      const lv = eff(S, S.pick.lv);
      const ids = S.pick.hideOthers || S.pick.fit ? S.pick.ids : Object.keys(D[lv] || {});
      ids.forEach((id) => out.add(lv + ":" + id));
    } else if (S.mode === "all") {
      const lv = eff(S, S.allLv);
      Object.keys(D[lv] || {}).forEach((id) => out.add(lv + ":" + id));
    } else {
      const t = S.target, inner = innerFor(D, S, t), nbLv = eff(S, S.nbLevel);
      if (inner && D[inner]) R.featuresInside(D, t.lv, t.id, inner).forEach((id) => out.add(inner + ":" + id));
      else out.add(t.lv + ":" + t.id);
      if (S.depth) R.neighborsOf(D, t.lv, t.id, nbLv, S.depth).forEach((n) => out.add(nbLv + ":" + n.id));
    }
    return out;
  }

  const dataText = (S, ctx) => (S.data.file ? ctx.bigText : S.data.text);
  function dataset(D, S, ctx) {
    const src = S.data.source;
    let key, make;
    if (src === "stats") {
      if (!ctx.stats) return null;
      key = "stats";
      make = () => (ctx.statsDs = ctx.statsDs || X.fromStats(ctx.stats));
    } else if (src === "pins") {
      const items = S.pins.items.filter((it) => it.keys);
      if (!items.length) return null;
      key = "pins:" + JSON.stringify(items.map((it) => it.keys));
      make = () => X.fromPins(items);
    } else if (src === "table") {
      const t = dataText(S, ctx);
      if (!t || !t.trim()) return null;
      key = t;
      make = () => X.analyze(X.readTable(t));
    } else return null;
    if (ctx.dsCache.key !== key) ctx.dsCache = { key, ds: make(), ver: ctx.dsCache.ver + 1 };
    return ctx.dsCache.ds;
  }
  /** 데이터 색: "theme" 은 지금 색 조합의 대상 색으로 만든 단계, "themeDiverge" 는 대상 색 ↔ 반대 색 */
  function paletteOf(S) {
    const ls = lookStyle(S);
    const dark = ls ? !!ls.dark : S.fillBg && Cl.isDark(S.colors.bg);
    if (S.data.palette === "theme") return Cl.rampStops(S.colors.target, { dark });
    if (S.data.palette === "themeDiverge") return { stops: Cl.divergingStops(S.colors.target, { dark }), diverge: true };
    return S.data.palette;
  }
  function dataResult(D, S, ctx) {
    const ds = dataset(D, S, ctx);
    if (!ds) return null;
    const lv = drawnLevels(D, S);
    if (lv.includes("emd") && !ctx.emdReady) return null;
    const only = visibleKeys(D, S);
    const opt = { by: S.data.by, labels: S.data.labels, palette: paletteOf(S), steps: S.data.steps, method: S.data.method, only };
    const sig = JSON.stringify([Object.assign({}, opt, { only: [...only].sort() }), lv, S.sido17, ctx.dsCache.ver, ctx.emdReady]);
    if (ctx.dataCache.sig !== sig) ctx.dataCache = { sig, res: X.build(D, lv, null, opt, R.sidoShort, ds) };
    return ctx.dataCache.res;
  }
  function pinCats(S) {
    const names = [...new Set(S.pins.items.filter((it) => it.cat && it.x != null).map((it) => it.cat))];
    return names.length > 1 || (names.length === 1 && S.pins.items.some((it) => !it.cat))
      ? names.map((n, i) => ({ name: n, color: PIN_COLORS[i % PIN_COLORS.length] }))
      : names.map((n) => ({ name: n, color: S.pins.color }));
  }
  const version = (D) => { const m = D.meta.version; return `${m.slice(0, 4)}.${m.slice(4, 6)}.${m.slice(6)}`; };
  function sourceNote(D, S, ctx) {
    const parts = [];
    if (S.heading.noteText) parts.push(S.heading.noteText.replace(/^출처\s*[:：]\s*/, ""));
    parts.push(`경계: 통계청 SGIS(${version(D)})`);
    if (S.data.source === "stats" && ctx.stats) parts.push(`인구: 행정안전부 주민등록 인구통계(${ctx.stats.meta.month})`);
    if (S.pins.items.some((it) => it.q === "인터넷 검색")) parts.push("지점 위치: © OpenStreetMap");
    return "출처: " + parts.join(", ");
  }
  /** 제목의 {지역} → 지금 지도의 지역 이름 (슬라이드 묶음에서 장마다 바뀌는 제목을 미리 보기에도) */
  function regionTitle(D, S, title) {
    if (!title || !title.includes("{지역}")) return title;
    let name = "전국";
    if (S.mode === "around" && D[S.target.lv] && D[S.target.lv][S.target.id]) name = D[S.target.lv][S.target.id].nm;
    else if (S.mode === "pick" && S.pick.ids.length) {
      const lv = eff(S, S.pick.lv), f = D[lv] && D[lv][S.pick.ids[0]];
      if (f) name = S.pick.ids.length > 1 ? `${f.nm} 외 ${S.pick.ids.length - 1}곳` : f.nm;
    }
    return title.split("{지역}").join(name);
  }
  /** 1 · 2 · 5 로 끝나는 보기 좋은 수 (이하) */
  function niceDown(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
  /** 원 크기(버블) 지도인가: 숫자 데이터이고 타일 배치가 아닐 때 */
  const bubbleOn = (S, dr) => S.data.symbol === "bubble" && dr && dr.kind === "num" && dr.nums && S.layout !== "square" && S.layout !== "hex";
  /** 데이터 색 · 그룹 색 · 값 · 범례 · 제목 · 핀 */
  function extras(D, S, ctx) {
    const fills = {}, values = {};
    let items = [];
    let bubbles = null, sizes = null;
    const dr = dataResult(D, S, ctx);
    if (dr) {
      if (S.data.showValues) Object.assign(values, dr.values);
      if (bubbleOn(S, dr)) {
        // 원 넓이가 값에 비례한다. 음수·0 은 원을 그리지 않는다
        const pos = {};
        for (const k in dr.nums) if (dr.nums[k] > 0) pos[k] = dr.nums[k];
        const max = Math.max(0, ...Object.values(pos));
        if (max > 0) {
          bubbles = { values: pos, max, color: S.colors.target, scale: S.data.bubbleScale || 1 };
          const top = niceDown(max);
          sizes = [top, niceDown(top / 4), niceDown(top / 16)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => ({ value: v, label: dr.fmt ? dr.fmt(v) : String(v) }));
        }
      } else {
        Object.assign(fills, dr.fills);
        items = dr.legend.items.slice();
      }
    }
    const cats = pinCats(S);
    if (cats.length && S.pins.byCat) items = items.concat(cats.map((c) => ({ color: c.color, label: c.name })));
    if (S.groups.length) {
      const used = new Set();
      for (const k in S.styles) {
        const g = S.groups.find((x) => x.id === S.styles[k].group);
        if (g) { fills[k] = g.color; used.add(g.id); }
      }
      items = items.concat(S.groups.filter((g) => used.has(g.id)).map((g) => ({ color: g.color, label: g.name || "그룹" })));
    }
    return {
      fills,
      values,
      bubbles,
      legend: items.length || sizes ? { title: S.legend.title || (dr && dr.legend.title) || "", items, sizes, pos: S.legend.pos } : null,
      heading: { title: regionTitle(D, S, S.heading.title), subtitle: S.heading.subtitle, note: S.heading.note ? sourceNote(D, S, ctx) : "" },
      pins: S.pins.items.filter((it) => it.x != null).map((it) => ({
        x: it.x, y: it.y, keys: it.keys, label: it.name,
        color: S.pins.byCat && it.cat ? (cats.find((c) => c.name === it.cat) || {}).color : S.pins.color,
      })),
      pinStyle: { shape: S.pins.shape, size: S.pins.size, labels: S.pins.labels, color: S.pins.color },
    };
  }
  // 디자인 방식: 이름 → 렌더러 look. 한글 이름도 받는다
  const LOOKS = [
    { id: "flat", name: "기본" }, { id: "glass", name: "유리" }, { id: "paper", name: "입체" },
    { id: "soft", name: "소프트" }, { id: "neon", name: "네온" },
  ];
  const LOOK_ALIAS = { 기본: "flat", 평면: "flat", 유리: "glass", 글라스: "glass", 글래스: "glass", 글라스모피즘: "glass", 입체: "paper", 종이: "paper", 페이퍼: "paper", 소프트: "soft", 뉴모피즘: "soft", 네온: "neon" };
  const lookId = (v) => (LOOKS.some((l) => l.id === v) ? v : LOOK_ALIAS[String(v || "").replace(/\s/g, "")] || null);
  /**
   * 디자인 방식에 맞춘 색과 배경. 대상 색의 색상(hue)을 그대로 살린다.
   * 반환: {colors(덮어쓸 색), backdrop(배경 그라데이션·빛 번짐), dark}
   */
  function lookStyle(S) {
    const look = S.look || "flat";
    if (look === "flat") return null;
    const [, C0, H] = Cl.lch(S.colors.target);
    const C = Math.max(C0, 0.1), P = Cl.partnerHue(H), k = Cl.oklch;
    if (look === "glass" && S.data.source) {
      // 데이터가 있으면 밝은 유리: 옅은 그라데이션 위라야 데이터 색이 바탕에 묻히지 않는다
      const mid = k(0.9, 0.035, H);
      return {
        dark: false,
        colors: { target: "#FFFFFF", neighbor: "#FFFFFF", context: "#FFFFFF", line: "#FFFFFF", sidoLine: "#FFFFFF", text: k(0.26, 0.03, H), bg: mid, shadow: k(0.45, 0.05, H) },
        backdrop: {
          kind: "linear", angle: 135, mid,
          stops: [k(0.93, 0.04, H - 18), k(0.87, 0.05, H + 12), k(0.9, 0.045, P)],
          blobs: [{ x: 0.16, y: 0.22, r: 0.34, color: k(0.95, 0.05, H) }, { x: 0.86, y: 0.82, r: 0.4, color: k(0.9, 0.06, P) }, { x: 0.62, y: 0.08, r: 0.22, color: k(0.97, 0.02, H + 20) }],
        },
      };
    }
    if (look === "glass") {
      const mid = k(0.52, C * 0.8, H);
      return {
        dark: true,
        colors: { target: "#FFFFFF", neighbor: "#FFFFFF", context: "#FFFFFF", line: "#FFFFFF", sidoLine: "#FFFFFF", text: "#FFFFFF", bg: mid, shadow: k(0.25, 0.08, H) },
        backdrop: {
          kind: "linear", angle: 135, mid,
          // 기준 색상 → 짝 색상(따뜻한 색 ↔ 파랑 계열)으로만 흘러가게: 엉뚱한 탁한 색이 끼지 않는다
          stops: [k(0.62, C * 0.8, H - 18), k(0.5, C * 0.9, H + 12), k(0.58, C * 0.7, P)],
          blobs: [{ x: 0.16, y: 0.22, r: 0.34, color: k(0.8, 0.12, H) }, { x: 0.86, y: 0.82, r: 0.4, color: k(0.74, 0.13, P) }, { x: 0.62, y: 0.08, r: 0.22, color: k(0.88, 0.05, H + 20) }],
        },
      };
    }
    if (look === "neon") {
      const mid = k(0.15, 0.035, H);
      return {
        dark: true,
        colors: { target: k(0.3, 0.09, H), neighbor: k(0.23, 0.05, H), context: k(0.19, 0.03, H), line: k(0.8, 0.17, H), sidoLine: k(0.7, 0.14, P), text: k(0.96, 0.02, H), bg: mid, glow: k(0.82, 0.18, H) },
        backdrop: { kind: "radial", mid, stops: [k(0.26, 0.06, H), mid] },
      };
    }
    if (look === "paper") {
      const t = Cl.themeFrom(S.colors.target);
      return { colors: { target: t.target, neighbor: t.neighbor, context: k(0.95, 0.01, H), line: "#FFFFFF", text: t.text, bg: k(0.975, 0.006, H) }, backdrop: { kind: "solid", mid: k(0.975, 0.006, H), stops: [k(0.975, 0.006, H)] } };
    }
    // soft (뉴모피즘): 바탕과 같은 색의 지역이 살짝 솟아오른 듯
    const base = k(0.93, 0.016, H);
    return {
      colors: { target: k(0.68, C * 0.75, H), neighbor: base, context: base, line: base, sidoLine: k(0.84, 0.02, H), text: k(0.34, 0.03, H), bg: base, softDark: k(0.72, 0.03, H) },
      backdrop: { kind: "solid", mid: base, stops: [base] },
    };
  }

  /** state → render.js buildScene 옵션 */
  function sceneOptions(D, S, ctx, width) {
    const o = {
      sidoLines: S.sidoLines,
      labelMode: S.labelMode,
      labelPick: S.labelPick instanceof Set ? S.labelPick : new Set(S.labelPick || []),
      subLabel: S.subLabel,
      leaders: S.leaders !== false,
      labelPlace: S.labelPlace || "auto",
      halo: S.halo,
      fontScale: S.fontScale,
      lineScale: S.lineScale,
      distinct: S.distinct,
      shadow: S.shadow,
      shortSido: "auto",
      explode: S.layout === "explode" ? S.explodeAmt : 0,
      tiles: S.layout === "square" || S.layout === "hex" ? S.layout : null,
      tileGap: S.tileGap,
      offsets: S.offsets,
      styles: S.styles,
      aspect: S.aspect,
      width: width || 1600,
      colors: Object.assign({}, S.colors, { bg: S.fillBg ? S.colors.bg : null }),
    };
    const ls = lookStyle(S);
    if (ls) {
      o.look = S.look;
      o.backdrop = ls.backdrop;
      Object.assign(o.colors, ls.colors);
    }
    Object.assign(o, extras(D, S, ctx));
    if (S.mode === "pick") {
      o.pick = { lv: eff(S, S.pick.lv), ids: S.pick.ids, fit: S.pick.fit, hideOthers: S.pick.hideOthers };
    } else if (S.mode === "all") {
      o.target = null;
      o.inner = eff(S, S.allLv);
      o.insets = S.insets || [];
    } else {
      Object.assign(o, { target: S.target, depth: S.depth, nbLevel: eff(S, S.nbLevel), inner: innerFor(D, S, S.target), context: S.context });
    }
    return o;
  }

  return {
    PRESETS, PIN_COLORS, LOOKS, lookId, lookStyle, paletteOf, defaultState, mergeState, serialize, createContext,
    eff, innerFor, needsEmd, drawnLevels, visibleKeys, dataText, dataset, dataResult, bubbleOn, regionTitle, pinCats, sourceNote, extras, sceneOptions, version,
  };
});
