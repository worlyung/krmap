/* 행정구역 지도 추출기 — 화면 조작, 검색, 내보내기(SVG/PNG/PPTX). 지도 그리기는 render.js */
(function () {
  const R = window.KRMapRender;
  const X = window.KRMapData;
  const Pn = window.KRMapPins;
  const $ = (id) => document.getElementById(id);
  const ORDER = R.LEVEL_ORDER;
  const LV_KO = { sido: "시도", si: "시군구", sgg: "구", emd: "읍면동" };

  // 색 테마: 대상 · 주변 · 나머지 · 경계선 · 시도 경계 · 글자 · 바탕
  const PRESETS = [
    { name: "코발트", target: "#3361E0", neighbor: "#C9D6F6", context: "#EDF0F4", line: "#FFFFFF", sidoLine: "#9AA6B5", text: "#1E2633", bg: "#FFFFFF" },
    { name: "코랄", target: "#EF5B4C", neighbor: "#F9D3CB", context: "#F3EFEC", line: "#FFFFFF", sidoLine: "#B9A9A2", text: "#2D211E", bg: "#FFFFFF" },
    { name: "에메랄드", target: "#0F9F84", neighbor: "#BEE6DB", context: "#EDF2F0", line: "#FFFFFF", sidoLine: "#93ABA4", text: "#16302A", bg: "#FFFFFF" },
    { name: "라벤더", target: "#6A4CD6", neighbor: "#DAD0F6", context: "#F0EEF6", line: "#FFFFFF", sidoLine: "#A69EBD", text: "#231D3A", bg: "#FFFFFF" },
    { name: "먹", target: "#262B33", neighbor: "#C5CAD1", context: "#EEF0F2", line: "#FFFFFF", sidoLine: "#9AA0A8", text: "#1C1F24", bg: "#FFFFFF" },
    { name: "미드나잇", target: "#F2B33D", neighbor: "#2E4A75", context: "#1B283B", line: "#0F1A2B", sidoLine: "#5D7393", text: "#EAF0F8", bg: "#0F1A2B", fillBg: true },
  ];

  const S = {
    mode: "around", // around(주변 지역) | pick(영역 직접 고르기) | all(전국)
    sido17: false,
    splitGu: false,
    // around
    target: { lv: "sido", id: "30" },
    depth: 1,
    nbLevel: "si",
    inner: "",
    context: true,
    // pick
    pick: { lv: "sido", ids: [], fit: true, hideOthers: false },
    // all
    allLv: "sido",
    // 이름
    labelMode: "all", // all | none | pick
    labelPick: new Set(), // "lv:id"
    clickAction: "main", // main | label | edit
    // 배치 · 하나씩 꾸미기
    layout: "real", // real | explode | square | hex
    explodeAmt: 0.25,
    tileGap: 0.1,
    // 제목 · 데이터 · 그룹 · 범례
    heading: { title: "", subtitle: "", note: false },
    data: { source: "", text: "", file: "", palette: "blue", steps: 5, method: "quantile", showValues: true, by: null, labels: null },
    pins: { text: "", items: [], shape: "pin", color: "#E5484D", size: 1, labels: true, byCat: true, online: true },
    groups: [], // [{id, name, color}] — 지역의 styles[key].group 으로 연결
    activeGroup: null,
    legend: { title: "", pos: "br" },
    panel: "region",
    offsets: {}, // "lv:id" → [dx, dy] (데이터 좌표)
    styles: {}, // "lv:id" → {fill, text, hideLabel}
    editKey: null,
    subLabel: true,
    halo: false,
    fontScale: 1,
    // 모양
    sidoLines: true,
    lineScale: 1,
    colors: Object.assign({}, PRESETS[0]),
    distinct: false,
    shadow: true,
    fillBg: false,
    aspect: null,
  };

  let D = null; // 병합된 데이터 {meta, sido, si, sgg, emd?, nb, sido17, nb17}
  let emdState = "none"; // none | loading | ready
  let index = [];
  let lastScene = null;
  let lastList = []; // 목록 복사용 [{lv,id}]

  // ---------- 데이터 ----------
  function initData() {
    const B = window.KRMAP.base;
    D = {
      meta: B.meta, sido: B.sido, si: B.si, sgg: B.sgg, emd: null,
      nb: Object.assign({}, B.nb), sido17: B.sido17, nb17: Object.assign({}, B.nb17 || {}),
    };
    buildIndex();
  }
  function loadEmd() {
    if (emdState !== "none") return;
    emdState = "loading";
    (window.KRMAP.waiting.emd = window.KRMAP.waiting.emd || []).unshift(() => {
      const E = window.KRMAP.emd;
      D.emd = E.emd;
      Object.assign(D.nb, E.nb);
      Object.assign(D.nb17, E.nb17 || {});
      R.useSido17(D, S.sido17);
      emdState = "ready";
      buildIndex();
      render();
    });
    const s = document.createElement("script");
    s.src = "data/emd.js";
    s.onerror = () => { emdState = "none"; toast("읍면동 데이터를 불러오지 못했습니다. 새로고침해 보세요."); };
    document.head.appendChild(s);
  }
  function needsEmd() {
    if (S.mode === "pick") return S.pick.lv === "emd";
    if (S.mode === "all") return S.allLv === "emd";
    return S.nbLevel === "emd" || S.inner === "emd" || S.target.lv === "emd";
  }

  function buildIndex() {
    index = [];
    const push = (lv, id, f) => index.push({ lv, id, full: f.full, nm: f.nm, key: f.full.replace(/\s+/g, "") });
    for (const id in D.sido) push("sido", id, D.sido[id]);
    for (const id in D.si) push("si", id, D.si[id]);
    for (const id in D.sgg) if (D.sgg[id].city) push("sgg", id, D.sgg[id]);
    if (D.emd) for (const id in D.emd) push("emd", id, D.emd[id]);
  }

  // ---------- 단위 바꾸기 ----------
  const eff = (lv) => (lv === "si" && S.splitGu ? "sgg" : lv);
  /** 한 지역을 다른 단위의 지역 목록으로: 더 잘게면 안쪽 지역들, 더 크게면 소속 지역 */
  function convert(lv, id, to) {
    if (lv === to) return [id];
    const f = D[lv][id];
    if (!f) return [];
    if (ORDER[to] > ORDER[lv] || (lv === "si" && to === "sgg")) return R.featuresInside(D, lv, id, to);
    if (to === "sido") return [f.sido];
    if (to === "si") return [f.si];
    if (to === "sgg") return f.sgg ? [f.sgg] : [];
    return [];
  }
  /** 17개 시도 전환 때 시도 코드(12 ↔ 29·46)를 맞춘다 */
  function remapSido(ids) {
    const out = new Set();
    for (const id of ids) {
      if (D.sido[id]) out.add(id);
      else if (S.sido17 && id === D.meta.merged) Object.keys(D.sido17).forEach((k) => out.add(k));
      else if (!S.sido17 && D.sido17 && D.sido17[id]) out.add(D.meta.merged);
    }
    return [...out];
  }

  // ---------- 상태 → 렌더 옵션 ----------
  function innerFor(target) {
    if (!S.inner) return null;
    const lv = eff(S.inner);
    if (ORDER[lv] <= ORDER[target.lv]) return null;
    if (lv === "sgg" && !(target.lv === "sido" || (target.lv === "si" && D.si[target.id].gu))) return null;
    return lv;
  }
  function sceneOpts(width) {
    const o = {
      sidoLines: S.sidoLines,
      labelMode: S.labelMode,
      labelPick: S.labelPick,
      subLabel: S.subLabel,
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
    Object.assign(o, extras());
    if (S.mode === "pick") {
      o.pick = { lv: eff(S.pick.lv), ids: S.pick.ids, fit: S.pick.fit, hideOthers: S.pick.hideOthers };
    } else if (S.mode === "all") {
      o.target = null;
      o.inner = eff(S.allLv);
    } else {
      Object.assign(o, { target: S.target, depth: S.depth, nbLevel: eff(S.nbLevel), inner: innerFor(S.target), context: S.context });
    }
    return o;
  }

  // ---------- 데이터 색칠 · 색 그룹 · 범례 · 제목 ----------
  /** 지금 지도에 그려지는 단위들 (붙여넣은 이름을 여기서 찾는다) */
  function drawnLevels() {
    if (S.mode === "pick") return [eff(S.pick.lv)];
    if (S.mode === "all") return [eff(S.allLv)];
    return [...new Set([eff(S.nbLevel), S.target.lv, innerFor(S.target)].filter(Boolean))];
  }
  /** 지금 지도에서 칠해질 수 있는 지역 key */
  function visibleKeys() {
    const out = new Set();
    if (S.mode === "pick") {
      const lv = eff(S.pick.lv);
      const ids = S.pick.hideOthers || S.pick.fit ? S.pick.ids : Object.keys(D[lv] || {});
      ids.forEach((id) => out.add(lv + ":" + id));
    } else if (S.mode === "all") {
      const lv = eff(S.allLv);
      Object.keys(D[lv] || {}).forEach((id) => out.add(lv + ":" + id));
    } else {
      const t = S.target, inner = innerFor(t), nbLv = eff(S.nbLevel);
      if (inner && D[inner]) R.featuresInside(D, t.lv, t.id, inner).forEach((id) => out.add(inner + ":" + id));
      else out.add(t.lv + ":" + t.id);
      if (S.depth) R.neighborsOf(D, t.lv, t.id, nbLv, S.depth).forEach((n) => out.add(nbLv + ":" + n.id));
    }
    return out;
  }
  // 큰 CSV 파일은 되돌리기 기록·자동 저장에 넣지 않고 따로 둔다
  let bigText = "";
  const dataSource = () => (S.data.file ? bigText : S.data.text);
  let dsCache = { key: null, ds: null, ver: 0 };
  let statsDs = null;
  function dataset() {
    const src = S.data.source;
    let key, make;
    if (src === "stats") {
      if (!window.KRMAP.stats) return null;
      key = "stats";
      make = () => (statsDs = statsDs || X.fromStats(window.KRMAP.stats));
    } else if (src === "pins") {
      const items = S.pins.items.filter((it) => it.keys);
      if (!items.length) return null;
      key = "pins:" + JSON.stringify(items.map((it) => it.keys));
      make = () => X.fromPins(items);
    } else if (src === "table") {
      const t = dataSource();
      if (!t || !t.trim()) return null;
      key = t;
      make = () => X.analyze(X.readTable(t));
    } else return null;
    if (dsCache.key !== key) dsCache = { key, ds: make(), ver: dsCache.ver + 1 };
    return dsCache.ds;
  }
  let dataCache = { sig: null, res: null };
  function dataResult() {
    const ds = dataset();
    if (!ds) return null;
    const lv = drawnLevels();
    if (lv.includes("emd") && emdState !== "ready") return null;
    const only = visibleKeys();
    const opt = { by: S.data.by, labels: S.data.labels, palette: S.data.palette, steps: S.data.steps, method: S.data.method, only };
    const sig = JSON.stringify([Object.assign({}, opt, { only: [...only].sort() }), lv, S.sido17, dsCache.ver, emdState]);
    if (dataCache.sig !== sig) dataCache = { sig, res: X.build(D, lv, null, opt, R.sidoShort, ds) };
    return dataCache.res;
  }
  function extras() {
    const fills = {}, values = {};
    let items = [];
    const dr = dataResult();
    if (dr) {
      Object.assign(fills, dr.fills);
      if (S.data.showValues) Object.assign(values, dr.values);
      items = dr.legend.items.slice();
    }
    const cats = pinCats();
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
      legend: items.length ? { title: S.legend.title || (dr && dr.legend.title) || "", items, pos: S.legend.pos } : null,
      heading: { title: S.heading.title, subtitle: S.heading.subtitle, note: S.heading.note ? sourceNote() : "" },
      pins: S.pins.items.filter((it) => it.x != null).map((it) => ({
        x: it.x, y: it.y, keys: it.keys, label: it.name,
        color: S.pins.byCat && it.cat ? (cats.find((c) => c.name === it.cat) || {}).color : S.pins.color,
      })),
      pinStyle: { shape: S.pins.shape, size: S.pins.size, labels: S.pins.labels, color: S.pins.color },
    };
  }
  const PIN_COLORS = ["#E5484D", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#78716C"];
  function pinCats() {
    const names = [...new Set(S.pins.items.filter((it) => it.cat && it.x != null).map((it) => it.cat))];
    return names.length > 1 || (names.length === 1 && S.pins.items.some((it) => !it.cat)) ? names.map((n, i) => ({ name: n, color: PIN_COLORS[i % PIN_COLORS.length] })) : names.map((n) => ({ name: n, color: S.pins.color }));
  }
  function sourceNote() {
    const parts = [`경계: 통계청 SGIS(${ver()})`];
    if (S.data.source === "stats" && window.KRMAP.stats) parts.push(`인구: 행정안전부 주민등록 인구통계(${window.KRMAP.stats.meta.month})`);
    if (S.pins.items.some((it) => it.q === "인터넷 검색")) parts.push("지점 위치: © OpenStreetMap");
    return "출처: " + parts.join(", ");
  }

  // ---------- 되돌리기 · 자동 저장 · 작업 파일 ----------
  const STORE = "krmap.work.v1";
  const snapshot = () => JSON.stringify(Object.assign({}, S, { labelPick: [...S.labelPick], editKey: null }));
  function restore(json) {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    for (const k of Object.keys(S)) {
      if (!(k in o)) continue;
      if (k === "labelPick") S.labelPick = new Set(o.labelPick || []);
      else if (S[k] && typeof S[k] === "object" && !Array.isArray(S[k]) && o[k] && typeof o[k] === "object") S[k] = Object.assign({}, S[k], o[k]);
      else S[k] = o[k];
    }
    S.editKey = null;
    if (S.data.source == null || (S.data.source === "" && (S.data.text || S.data.file) && !("source" in (o.data || {})))) S.data.source = S.data.text || S.data.file ? "table" : "";
    R.useSido17(D, S.sido17);
    buildIndex();
  }
  let hist = [], hpos = -1, histT = null, restoring = false;
  function recordHistory() {
    if (restoring) return;
    clearTimeout(histT);
    histT = setTimeout(() => {
      const snap = snapshot();
      if (hist[hpos] === snap) return;
      hist = hist.slice(0, hpos + 1);
      hist.push(snap);
      if (hist.length > 80) hist.shift();
      hpos = hist.length - 1;
      try { localStorage.setItem(STORE, snap); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
      syncUndo();
    }, 300);
  }
  function syncUndo() {
    $("undo").disabled = hpos <= 0;
    $("redo").disabled = hpos >= hist.length - 1;
  }
  function stepHistory(d) {
    const to = hpos + d;
    if (to < 0 || to >= hist.length) return;
    hpos = to;
    restoring = true;
    restore(hist[hpos]);
    render();
    restoring = false;
    syncUndo();
  }

  // ---------- 그리기 ----------
  function render() {
    if (!D) return;
    syncControls();
    if (needsEmd() && emdState !== "ready") {
      loadEmd();
      $("map").innerHTML = '<span class="loading">읍면동 경계를 불러오는 중입니다…</span>';
      return;
    }
    const scene = R.buildScene(D, sceneOpts(1600));
    lastScene = scene;
    $("map").innerHTML = R.toSVG(scene, { interactive: true });
    $("slide").style.background = S.fillBg ? S.colors.bg : "#FFFFFF";
    renderInfo(scene);
    if (scene.warning) $("meta").innerHTML += ` · <span class="warn">${scene.warning}</span>`;
    renderDataReport();
    recordHistory();
    renderLabelPick(scene);
    renderEditor();
    try {
      const h = S.mode === "around" ? `#${S.target.lv}-${S.target.id}` : `#${S.mode}`;
      history.replaceState(null, "", h);
    } catch (e) { /* 미리보기 환경 */ }
  }

  const ver = () => { const m = D.meta.version; return `${m.slice(0, 4)}.${m.slice(4, 6)}.${m.slice(6)}`; };
  const shortName = (lv, f) => (f.city && lv === "sgg" ? `${f.city} ${f.nm}` : f.nm);
  function chip(lv, id, homeSido, onclick, extraClass) {
    const f = D[lv][id];
    const b = document.createElement("button");
    b.className = "chip" + (extraClass ? " " + extraClass : "");
    b.textContent = shortName(lv, f);
    if (homeSido && f.sido !== homeSido && lv !== "sido") {
      const sm = document.createElement("small");
      sm.textContent = R.sidoShort(D.sido[f.sido].nm);
      b.appendChild(sm);
    }
    b.title = f.full;
    b.onclick = onclick;
    return b;
  }

  function renderInfo(scene) {
    const list = $("nbList");
    list.innerHTML = "";
    lastList = [];
    $("copyList").hidden = false;
    if (S.mode === "all") {
      $("title").textContent = scene.title;
      $("meta").textContent = `${D.sido17 && S.sido17 ? "17개 시도 · " : ""}기준 ${ver()}`;
      $("nbHead").textContent = "지역을 누르면 그 지역과 주변이 나옵니다";
      $("copyList").hidden = true;
      return;
    }
    if (S.mode === "pick") {
      const lv = eff(S.pick.lv);
      const ids = S.pick.ids.filter((k) => D[lv][k]);
      $("title").textContent = ids.length ? scene.title : `${R.LEVEL_NAME[lv]} 고르기`;
      const area = ids.reduce((a, k) => a + D[lv][k].a, 0);
      $("meta").textContent = `${R.LEVEL_NAME[lv]} ${ids.length}곳` + (ids.length ? ` · 면적 ${Math.round(area).toLocaleString("ko-KR")} km²` : "") + ` · 기준 ${ver()}`;
      $("nbHead").textContent = ids.length ? `고른 ${R.LEVEL_NAME[lv]} ${ids.length}곳 (누르면 뺍니다)` : "아직 고른 지역이 없습니다. 지도를 눌러 넣어 보세요.";
      const home = ids.length ? D[lv][ids[0]].sido : null;
      for (const id of ids) list.appendChild(chip(lv, id, home, () => togglePick(id)));
      lastList = ids.map((id) => ({ lv, id }));
      return;
    }
    const T = D[S.target.lv][S.target.id];
    $("title").textContent = T.full + (S.depth ? " 주변" : "");
    $("meta").textContent = `${LV_KO[S.target.lv]} · 코드 ${S.target.id} · 면적 ${T.a.toLocaleString("ko-KR")} km² · 기준 ${ver()}`;
    const nbLv = eff(S.nbLevel);
    const nbs = S.depth ? R.neighborsOf(D, S.target.lv, S.target.id, nbLv, S.depth) : [];
    lastList = nbs.map((n) => ({ lv: nbLv, id: n.id }));
    const r1 = nbs.filter((n) => n.ring === 1).length;
    $("nbHead").textContent = S.depth
      ? `맞닿은 ${R.LEVEL_NAME[nbLv]} ${r1}곳` + (S.depth === 2 ? ` · 한 겹 더 ${nbs.length - r1}곳` : "")
      : "주변 지역 표시가 꺼져 있습니다";
    for (const n of nbs) list.appendChild(chip(nbLv, n.id, T.sido, () => setTarget({ lv: nbLv, id: n.id }), n.ring === 2 ? "r2" : ""));
    if (!nbs.length && S.depth) list.innerHTML = '<span class="empty">맞닿은 지역이 없습니다 (섬 지역 등).</span>';
  }

  /** 이름 "고른 것만": 그려진 지역 목록을 켜고 끄는 칩으로 */
  function renderLabelPick(scene) {
    const box = $("labelPickBox");
    box.hidden = S.labelMode !== "pick";
    if (box.hidden) return;
    const el = $("labelPickList");
    el.innerHTML = "";
    const seen = new Set();
    const items = [];
    for (const p of scene.polys) {
      const key = p.lv + ":" + p.id;
      if (seen.has(key)) continue;
      seen.add(key);
      // 흐린 배경 지역은 이미 이름을 넣은 것만 목록에 둔다 (지도에서 눌러 추가)
      if (p.group === "context" && !S.labelPick.has(key)) continue;
      items.push(p);
    }
    const on = items.filter((p) => S.labelPick.has(p.lv + ":" + p.id)).length;
    $("labelPickCount").textContent = `${on} / ${items.length}곳` + (items.length > 400 ? " · 많아서 지도에서 누르는 편이 빠릅니다" : "");
    for (const p of items.slice(0, 400)) {
      const key = p.lv + ":" + p.id;
      const b = chip(p.lv, p.id, null, () => toggleLabel(key));
      b.setAttribute("aria-pressed", S.labelPick.has(key) ? "true" : "false");
      el.appendChild(b);
    }
    const row = document.createElement("div");
    row.className = "row";
    row.style.width = "100%";
    const all = document.createElement("button");
    all.className = "btn sm";
    all.textContent = "목록 전부 켜기";
    all.onclick = () => { items.forEach((p) => S.labelPick.add(p.lv + ":" + p.id)); render(); };
    const none = document.createElement("button");
    none.className = "btn sm";
    none.textContent = "전부 끄기";
    none.onclick = () => { S.labelPick.clear(); render(); };
    row.append(all, none);
    el.appendChild(row);
  }

  // ---------- 조작판 ----------
  function seg(id, get, set) {
    const el = $(id);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      set(b.dataset.v);
      render();
    });
    el._sync = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(get())));
  }
  function syncControls() {
    ["mode", "depth", "nbLevel", "inner", "aspect", "pickLv", "pickFit", "allLv", "labelMode", "clickAction"].forEach((id) => $(id)._sync());
    $("secAround").hidden = S.mode !== "around";
    $("secPick").hidden = S.mode !== "pick";
    $("secAll").hidden = S.mode !== "all";
    $("crumbs").hidden = S.mode !== "around";
    $("q").placeholder = S.mode === "pick" ? "찾아서 넣기 — 충청남도, 공주시…" : "지역 찾기 — 대전, 유성구, 정자동";
    $("inner").querySelectorAll("button").forEach((b) => {
      const v = b.dataset.v;
      b.disabled = !!(v && ORDER[eff(v)] <= ORDER[S.target.lv]);
    });
    $("nbLevel").querySelectorAll("button").forEach((b) => (b.disabled = !S.depth));
    $("hideOthers").checked = S.pick.hideOthers;
    $("sido17").checked = S.sido17;
    $("sido17").closest("label").hidden = !D.sido17;
    $("labelHint").hidden = S.labelMode !== "pick";
    $("clickMain").textContent = S.mode === "pick" ? "영역 넣기·빼기" : "그 지역으로 이동";
    ["layout", "legPos", "ptab"].forEach((id) => $(id)._sync());
    $("explodeRow").hidden = S.layout !== "explode";
    $("tileGapRow").hidden = $("tileNote").hidden = !(S.layout === "square" || S.layout === "hex");
    document.querySelectorAll(".pane").forEach((el) => (el.hidden = el.dataset.pane !== S.panel));
    $("clickGroup").hidden = !S.groups.length;
    const setVal = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    setVal("hTitle", S.heading.title);
    setVal("hSub", S.heading.subtitle);
    setVal("legTitle", S.legend.title);
    if (!S.data.file) setVal("dataText", S.data.text);
    $("hNote").checked = S.heading.note;
    $("dataSteps").value = String(S.data.steps);
    $("dataMethod").value = S.data.method;
    $("dataValues").checked = S.data.showValues;
    document.querySelectorAll(".pal").forEach((b) => b.classList.toggle("on", b.dataset.v === S.data.palette));
    renderGroups();
    $("dataSrc")._sync();
    $("srcStats").hidden = S.data.source !== "stats";
    document.querySelectorAll("#statQuick .chip").forEach((b) => b.setAttribute("aria-pressed", S.data.source === "stats" && S.data.by && S.data.by.c === b.dataset.id ? "true" : "false"));
    $("srcTable").hidden = S.data.source !== "table";
    $("srcPins").hidden = S.data.source !== "pins";
    $("pinShape")._sync();
    $("pinColor").value = S.pins.color;
    $("pinLabels").checked = S.pins.labels;
    $("pinByCat").checked = S.pins.byCat;
    $("pinOnline").checked = S.pins.online;
    $("pinSize").value = String(S.pins.size);
    if (document.activeElement !== $("pinText")) $("pinText").value = S.pins.text;
    renderPinList();
    $("map").classList.toggle("editing", S.clickAction === "edit");
    $("cTargetLbl").firstChild.textContent = S.mode === "pick" ? "고른 지역" : S.mode === "all" ? "강조" : "대상";
    $("cNeighborLbl").firstChild.textContent = S.mode === "all" ? "지역" : "주변";
    $("cTarget").value = S.colors.target;
    $("cNeighbor").value = S.colors.neighbor;
    $("cContext").value = S.colors.context;
    $("fillBg").checked = S.fillBg;
    $("shadow").checked = S.shadow;
    document.querySelectorAll(".theme").forEach((b, i) => b.classList.toggle("on", PRESETS[i].name === S.colors.name));
    fillSidoSelect();
    renderCrumbs();
  }

  function fillSidoSelect() {
    const sel = $("pickSido");
    const keys = Object.keys(D.sido).join(",");
    if (sel._keys === keys) return;
    sel._keys = keys;
    const cur = sel.value;
    sel.innerHTML = Object.keys(D.sido).map((k) => `<option value="${k}">${D.sido[k].nm}</option>`).join("");
    if (D.sido[cur]) sel.value = cur;
  }

  function renderCrumbs() {
    const el = $("crumbs");
    el.innerHTML = "";
    if (S.mode !== "around") return;
    const chain = [{ label: "전국", go: () => { S.mode = "all"; render(); } }];
    const t = S.target;
    const f = D[t.lv][t.id];
    chain.push({ label: D.sido[f.sido].nm, t: { lv: "sido", id: f.sido } });
    if (t.lv !== "sido") {
      if (D.si[f.si]) chain.push({ label: D.si[f.si].nm, t: { lv: "si", id: f.si } });
      const sggId = t.lv === "emd" ? f.sgg : t.lv === "sgg" ? t.id : null;
      if (sggId && D.sgg[sggId].city) chain.push({ label: D.sgg[sggId].nm, t: { lv: "sgg", id: sggId } });
      if (t.lv === "emd") chain.push({ label: f.nm, t });
    }
    chain.forEach((c, i) => {
      if (i) {
        const sp = document.createElement("span");
        sp.textContent = "›";
        el.appendChild(sp);
      }
      const last = i === chain.length - 1;
      const n = document.createElement(last ? "b" : "button");
      n.textContent = c.label;
      if (!last) n.onclick = c.go || (() => setTarget(c.t));
      el.appendChild(n);
    });
  }

  function setTarget(t) {
    S.mode = "around";
    S.target = t;
    if (S.inner && ORDER[eff(S.inner)] <= ORDER[t.lv]) S.inner = "";
    render();
  }
  function togglePick(id) {
    const i = S.pick.ids.indexOf(id);
    if (i >= 0) S.pick.ids.splice(i, 1);
    else S.pick.ids.push(id);
    render();
  }
  function addPick(ids) {
    for (const id of ids) if (!S.pick.ids.includes(id)) S.pick.ids.push(id);
    render();
  }
  function toggleLabel(key) {
    if (S.labelPick.has(key)) S.labelPick.delete(key);
    else S.labelPick.add(key);
    render();
  }
  function setPickLv(v) {
    const from = eff(S.pick.lv), to = eff(v);
    S.pick.lv = v;
    if (from === to) return;
    const ids = new Set();
    const go = () => { for (const id of S.pick.ids) for (const k of convert(from, id, to)) ids.add(k); S.pick.ids = [...ids]; };
    if (to === "emd" && emdState !== "ready") {
      // 읍면동이 올라온 뒤에 바꾼다
      (window.KRMAP.waiting.emd = window.KRMAP.waiting.emd || []).push(() => { go(); render(); });
    } else go();
  }

  function bindControls() {
    seg("mode", () => S.mode, (v) => {
      if (v === "pick" && !S.pick.ids.length && S.mode === "around") {
        // 지금 보던 대상을 처음 고른 영역으로
        S.pick.ids = convert(S.target.lv, S.target.id, eff(S.pick.lv));
      }
      S.mode = v;
    });
    seg("depth", () => S.depth, (v) => (S.depth = +v));
    seg("nbLevel", () => S.nbLevel, (v) => (S.nbLevel = v));
    seg("inner", () => S.inner, (v) => (S.inner = v));
    seg("aspect", () => (S.aspect ? String(S.aspect) : ""), (v) => (S.aspect = v ? +v : null));
    seg("pickLv", () => S.pick.lv, setPickLv);
    seg("pickFit", () => (S.pick.fit ? "1" : "0"), (v) => (S.pick.fit = v === "1"));
    seg("allLv", () => S.allLv, (v) => (S.allLv = v));
    seg("labelMode", () => S.labelMode, (v) => {
      if (v === "pick" && S.labelMode !== "pick" && !S.labelPick.size && lastScene) {
        // 지금 보이는 이름들에서 시작해 빼고 싶은 것만 끄면 되도록
        for (const t of lastScene.texts) if (!t.sub) S.labelPick.add(t.lv + ":" + t.id);
      }
      if (v === "pick") S.clickAction = "label";
      S.labelMode = v;
    });
    seg("clickAction", () => S.clickAction, (v) => {
      if (v === "label" && S.labelMode !== "pick") {
        if (!S.labelPick.size && lastScene) for (const t of lastScene.texts) if (!t.sub) S.labelPick.add(t.lv + ":" + t.id);
        S.labelMode = "pick";
      }
      if (v !== "edit") S.editKey = null;
      S.clickAction = v;
    });
    seg("layout", () => S.layout, (v) => (S.layout = v));
    seg("legPos", () => S.legend.pos, (v) => (S.legend.pos = v));
    seg("ptab", () => S.panel, (v) => (S.panel = v));
    $("tileGap").addEventListener("input", (e) => { S.tileGap = +e.target.value; clearTimeout(bindControls._t); bindControls._t = setTimeout(render, 40); });
    bindExtras();
    $("explodeAmt").addEventListener("input", (e) => { S.explodeAmt = +e.target.value; clearTimeout(bindControls._t); bindControls._t = setTimeout(render, 40); });
    $("resetEdits").onclick = () => { S.offsets = {}; S.styles = {}; S.editKey = null; render(); };
    bindEditor();

    const chk = (id, set) => $(id).addEventListener("change", (e) => { set(e.target.checked); render(); });
    chk("splitGu", (v) => {
      const before = eff(S.pick.lv);
      S.splitGu = v;
      const after = eff(S.pick.lv);
      if (before !== after) {
        const ids = new Set();
        for (const id of S.pick.ids) for (const k of convert(before, id, after)) ids.add(k);
        S.pick.ids = [...ids];
      }
    });
    chk("sido17", (v) => {
      S.sido17 = v;
      R.useSido17(D, v);
      buildIndex();
      if (S.target.lv === "sido" && !D.sido[S.target.id]) S.target = { lv: "sido", id: remapSido([S.target.id])[0] };
      if (S.pick.lv === "sido") S.pick.ids = remapSido(S.pick.ids);
    });
    chk("context", (v) => (S.context = v));
    chk("hideOthers", (v) => (S.pick.hideOthers = v));
    chk("sidoLines", (v) => (S.sidoLines = v));
    chk("subLabel", (v) => (S.subLabel = v));
    chk("halo", (v) => (S.halo = v));
    chk("distinct", (v) => (S.distinct = v));
    chk("shadow", (v) => (S.shadow = v));
    chk("fillBg", (v) => (S.fillBg = v));
    let t;
    const slider = (id, set) => $(id).addEventListener("input", (e) => { set(+e.target.value); clearTimeout(t); t = setTimeout(render, 60); });
    slider("fontScale", (v) => (S.fontScale = v));
    slider("lineScale", (v) => (S.lineScale = v));
    const col = (id, key) => $(id).addEventListener("input", (e) => { S.colors[key] = e.target.value.toUpperCase(); S.colors.name = null; clearTimeout(t); t = setTimeout(render, 60); });
    col("cTarget", "target");
    col("cNeighbor", "neighbor");
    col("cContext", "context");

    const ps = $("presets");
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "theme";
      b.setAttribute("aria-label", `색 테마: ${p.name}`);
      b.innerHTML =
        `<div class="pv" style="background:${p.context}"><i class="n1" style="background:${p.neighbor}"></i>` +
        `<i class="n2" style="background:${p.neighbor}"></i><i class="t" style="background:${p.target}"></i></div><span>${p.name}</span>`;
      b.onclick = () => {
        const wasDark = !!S.colors.fillBg;
        S.colors = Object.assign({}, p);
        if (p.fillBg) S.fillBg = true;
        else if (wasDark) S.fillBg = false;
        render();
      };
      ps.appendChild(b);
    });

    $("pickAddSido").onclick = () => {
      const lv = eff(S.pick.lv);
      if (lv === "emd" && emdState !== "ready") { loadEmd(); toast("읍면동을 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요."); return; }
      addPick(convert("sido", $("pickSido").value, lv));
    };
    $("pickClear").onclick = () => { S.pick.ids = []; render(); };

    // 지도 클릭
    $("map").addEventListener("click", (e) => {
      const p = e.target.closest("[data-id]");
      if (!p) return;
      const lv = p.dataset.lv, id = p.dataset.id;
      if (S.clickAction === "edit") return; // 끌기·선택은 pointer 이벤트에서
      if (S.clickAction === "group") return paintGroup(lv + ":" + id);
      if (S.labelMode === "pick" && S.clickAction === "label") return toggleLabel(lv + ":" + id);
      if (S.mode === "pick") return togglePick(id);
      setTarget({ lv, id });
    });

    $("dlSvg").onclick = exportSVG;
    $("dlPng").onclick = exportPNG;
    $("dlPptx").onclick = exportPPTX;
    $("copyList").onclick = copyList;
    bindSearch();
  }

  // ---------- 데이터 · 그룹 · 범례 · 제목 조작 ----------
  function renderDataReport() {
    const el = $("dataReport");
    const dr = dataResult();
    renderDataCols(dr);
    $("dataLook").hidden = !dr;
    if (S.data.source === "stats") {
      const st = window.KRMAP.stats;
      $("statsNote").textContent = st ? `행정안전부 주민등록 인구통계 ${st.meta.month}월말 기준 · 시도·시군구 단위. ${st.meta.note}` : "기본 통계를 불러오지 못했습니다.";
      if (drawnLevels().includes("emd") && dr && !Object.keys(dr.fills).length) {
        el.className = "note warn";
        el.textContent = "기본 통계는 시도·시군구 단위까지 있습니다. 지도 단위를 시군구 이상으로 바꿔 주세요.";
        return;
      }
    }
    if (S.data.source === "pins" && !dr) {
      el.className = "note";
      el.textContent = "아직 찍은 핀이 없습니다. '지점' 탭에서 핀을 찍어 주세요.";
      return;
    }
    if (!S.data.source) { el.className = "note"; el.textContent = "기본 통계(인구·세대·연령), 내 표·파일(통계·여론조사), 지점 수 중에서 골라 지도를 칠합니다."; return; }
    if (S.data.file && !bigText) {
      el.className = "note warn";
      el.textContent = `파일(${S.data.file})은 브라우저에 남지 않습니다. 다시 열어 주세요.`;
      return;
    }
    if (S.data.source === "table" && !dataSource().trim()) {
      el.className = "note";
      el.textContent = "숫자는 크기에 따라 단계별로, 글자(본사·지사 등)는 분류별로, 후보별 지지율은 1위 색으로 칠합니다. 지금 지도 단위(시도·시군구·읍면동)에 맞춰 이름이나 행정기관코드로 지역을 찾습니다.";
      return;
    }
    if (!dr) { el.textContent = "읍면동을 불러오는 중입니다…"; return; }
    const what = { cat: "분류별", num: "숫자 단계", win: "1위 색" }[dr.kind] || "";
    const shown = Object.keys(dr.fills).length;
    const parts = [(S.data.file ? `${S.data.file}: ` : "") + `지도에서 ${shown}곳을 칠했습니다` + (what ? ` (${what})` : "") + (dr.matched > shown ? ` · 표에서 찾은 지역 ${dr.matched}곳` : "")];
    if (dr.ds.note) parts.push(dr.ds.note);
    if (/\(예시\)/.test(dataSource())) parts.push("예시 숫자는 무작위입니다. 실제 통계가 아닙니다");
    if (dr.ds.builtin) { el.textContent = parts.join(" · "); el.className = "note"; return; }
    if (dr.ambiguous.length) parts.push(`같은 이름이 여러 곳: ${dr.ambiguous.slice(0, 6).join(", ")} — "대전 중구"처럼 시도를 붙여 주세요`);
    if (dr.unmatched.length) parts.push(`못 찾은 이름 ${dr.unmatched.length}개: ${dr.unmatched.slice(0, 6).join(", ")}${dr.unmatched.length > 6 ? " …" : ""}`);
    el.textContent = parts.join(" · ");
    el.className = "note" + (dr.unmatched.length || dr.ambiguous.length ? " warn" : "");
  }
  /** 색칠 기준 · 비율 · 1위 항목 · 이름 아래 값 고르기 */
  function renderDataCols(dr) {
    const box = $("dataCols");
    const ds = dr && dr.ds;
    box.hidden = !ds || !ds.columns.length;
    if (box.hidden) return;
    const sig = JSON.stringify([dsCache.ver, S.data.by, S.data.labels, dr.by]);
    if (box._sig === sig) return;
    box._sig = sig;
    const by = dr.by || {};
    const nums = ds.columns.filter((c) => c.kind !== "text");
    const sel = $("dataBy");
    sel.innerHTML =
      ds.columns.map((c) => `<option value="col:${c.id}">${c.name}${c.kind === "text" ? " (분류)" : ""}</option>`).join("") +
      (nums.length >= 2 ? `<option value="ratio">두 값의 비율 (A ÷ B)</option><option value="win">여론조사 1위 (항목 중 가장 큰 값)</option>` : "");
    sel.value = by.t === "col" ? "col:" + by.c : by.t || "";
    $("ratioRow").hidden = by.t !== "ratio";
    $("winRow").hidden = by.t !== "win";
    const opts = nums.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    if (by.t === "ratio") {
      $("ratioA").innerHTML = opts; $("ratioB").innerHTML = opts;
      $("ratioA").value = by.a; $("ratioB").value = by.b;
    }
    const chipRow = (el, items, isOn, onClick) => {
      el.innerHTML = "";
      for (const c of items) {
        const b = document.createElement("button");
        b.className = "chip sm";
        b.textContent = c.name;
        b.setAttribute("aria-pressed", isOn(c) ? "true" : "false");
        b.onclick = () => onClick(c);
        el.appendChild(b);
      }
    };
    if (by.t === "win") chipRow($("winCols"), nums, (c) => by.cols.includes(c.id), (c) => {
      const cols = by.cols.includes(c.id) ? by.cols.filter((x) => x !== c.id) : by.cols.concat(c.id);
      if (cols.length >= 2) { S.data.by = { t: "win", cols }; render(); } else toast("1위를 가리려면 두 항목 이상이 필요합니다");
    });
    const current = S.data.labels || (by.t === "col" ? [by.c] : []);
    chipRow($("labelCols"), ds.columns, (c) => current.includes(c.id), (c) => {
      let next = current.includes(c.id) ? current.filter((x) => x !== c.id) : current.concat(c.id);
      if (next.length > 3) next = next.slice(-3);
      S.data.labels = next;
      if (!S.data.showValues) S.data.showValues = true;
      render();
    });
  }
  function renderGroups() {
    const el = $("groupList");
    const sig = JSON.stringify([S.groups, S.activeGroup, Object.values(S.styles).map((x) => x.group)]);
    if (el._sig === sig) return;
    el._sig = sig;
    el.innerHTML = "";
    if (!S.groups.length) { el.innerHTML = '<p class="note">예: 본사 · 지사 · 대리점처럼 지역을 묶어 같은 색으로 칠하고 범례에 이름을 넣습니다.</p>'; return; }
    for (const g of S.groups) {
      const n = Object.values(S.styles).filter((x) => x.group === g.id).length;
      const row = document.createElement("div");
      row.className = "grp" + (S.activeGroup === g.id ? " on" : "");
      row.innerHTML = `<input type="radio" name="grp" aria-label="이 그룹으로 칠하기" ${S.activeGroup === g.id ? "checked" : ""}>` +
        `<input type="color" value="${g.color}" aria-label="그룹 색"><input type="text" maxlength="20" aria-label="그룹 이름"><small>${n}곳</small><button class="x" aria-label="그룹 지우기">✕</button>`;
      const [radio, color, name, , del] = row.children;
      name.value = g.name;
      radio.onchange = () => { S.activeGroup = g.id; S.clickAction = "group"; render(); };
      color.oninput = (e) => { g.color = e.target.value.toUpperCase(); clearTimeout(renderGroups._t); renderGroups._t = setTimeout(render, 50); };
      name.oninput = (e) => { g.name = e.target.value; clearTimeout(renderGroups._t); renderGroups._t = setTimeout(render, 250); };
      del.onclick = () => {
        S.groups = S.groups.filter((x) => x !== g);
        for (const k in S.styles) if (S.styles[k].group === g.id) { delete S.styles[k].group; if (!Object.keys(S.styles[k]).length) delete S.styles[k]; }
        if (S.activeGroup === g.id) { S.activeGroup = null; if (S.clickAction === "group") S.clickAction = "main"; }
        render();
      };
      el.appendChild(row);
    }
  }
  function paintGroup(key) {
    if (!S.activeGroup) { toast("왼쪽 '데이터 · 범례'에서 칠할 그룹을 먼저 고르세요"); return; }
    const st = Object.assign({}, S.styles[key]);
    if (st.group === S.activeGroup) delete st.group;
    else st.group = S.activeGroup;
    if (Object.keys(st).length) S.styles[key] = st;
    else delete S.styles[key];
    render();
  }
  const QUICK = [["pop", "총인구"], ["young", "20~39세"], ["youngR", "20~39세 비율"], ["old60R", "60세 이상 비율"], ["old70R", "70세 이상 비율"], ["yoyR", "1년 증감률"], ["hh", "세대수"], ["agingI", "고령화 지수"]];
  function renderPinList() {
    const el = $("pinList");
    const sig = JSON.stringify([S.pins.items, S.pins.byCat, S.pins.color]);
    if (el._sig === sig) return;
    el._sig = sig;
    el.innerHTML = "";
    const cats = pinCats();
    S.pins.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "pinrow";
      const col = S.pins.byCat && it.cat ? (cats.find((c) => c.name === it.cat) || {}).color : S.pins.color;
      row.innerHTML = `<i style="background:${it.x != null ? col : "transparent"};border:1px solid ${col}"></i><span></span><small class="${it.x == null ? "bad" : ""}"></small><button class="x" aria-label="이 지점 빼기">✕</button>`;
      row.children[1].textContent = it.name + (it.cat ? ` · ${it.cat}` : "");
      row.children[1].title = it.addr || "";
      const best = it.keys && (it.keys.emd || it.keys.sgg || it.keys.si || it.keys.sido);
      const reg = best ? (([l, d]) => (D[l] && D[l][d] ? D[l][d].nm : ""))(best.split(":")) : "";
      row.children[2].textContent = it.q + (reg && it.q !== "못 찾음" ? ` · ${reg}` : "");
      row.children[3].onclick = () => { S.pins.items.splice(i, 1); render(); };
      el.appendChild(row);
    });
  }
  function waitEmd() {
    if (emdState === "ready") return Promise.resolve();
    return new Promise((ok) => { (window.KRMAP.waiting.emd = window.KRMAP.waiting.emd || []).push(ok); loadEmd(); });
  }
  let onlineBlocked = false;
  async function placePins() {
    const list = Pn.parse($("pinText").value);
    S.pins.text = $("pinText").value;
    if (!list.length) { toast("지점 목록이 비어 있습니다"); return; }
    const btn = $("pinApply");
    btn.disabled = true;
    try {
      await waitEmd();
      const idx = Pn.aliasIndex(D, R.sidoShort);
      const items = [];
      let online = S.pins.online && !onlineBlocked;
      for (let n = 0; n < list.length; n++) {
        const it = list[n];
        let res = null;
        if (it.ll) {
          const [x, y] = Pn.toData(it.ll[0], it.ll[1]);
          res = { x, y, keys: Pn.locate(D, x, y, R.decode), q: "정확" };
        } else {
          if (online) {
            $("pinReport").textContent = `주소 검색 중… ${n + 1} / ${list.length}`;
            try {
              const ll = await Pn.geocodeOnline(it.addr);
              if (ll) { const [x, y] = Pn.toData(ll[0], ll[1]); const keys = Pn.locate(D, x, y, R.decode); if (keys) res = { x, y, keys, q: "인터넷 검색" }; }
              await new Promise((r) => setTimeout(r, 1100)); // 이용 규칙: 1초에 한 번
            } catch (e) {
              online = false;
              onlineBlocked = true;
              toast("이 화면에서는 인터넷 주소 검색이 막혀 있어, 주소 속 동·시군구 이름으로 대략 찍습니다");
            }
          }
          if (!res) {
            const r = Pn.findRegion(D, it.addr, R.sidoShort, idx);
            if (r) { const [l, i] = r.key.split(":"); const lp = D[l][i].lp; res = { x: lp[0], y: lp[1], keys: Pn.keysOf(D, r.key), q: r.quality }; }
          }
        }
        items.push(Object.assign({ name: it.name, addr: it.addr, cat: it.cat }, res || { q: "못 찾음" }));
      }
      S.pins.items = items;
      const exact = items.filter((x) => x.q === "정확" || x.q === "인터넷 검색").length, rough = items.filter((x) => x.x != null).length - exact, fail = items.length - exact - rough;
      $("pinReport").textContent = `${items.length}곳 중 정확 ${exact} · 대략(지역 가운데) ${rough}` + (fail ? ` · 못 찾음 ${fail}` : "") + (rough ? ". 정확히 찍으려면 위도·경도를 넣어 주세요" : "");
      render();
    } finally {
      btn.disabled = false;
    }
  }
  function bindExtras() {
    let t;
    seg("dataSrc", () => S.data.source || "", (v) => { S.data.source = v; S.data.by = null; S.data.labels = null; if (v && S.legend.pos === "none") S.legend.pos = "br"; });
    const q = $("statQuick");
    for (const [id, name] of QUICK) {
      const b = document.createElement("button");
      b.className = "chip sm";
      b.textContent = name;
      b.dataset.id = id;
      b.onclick = () => { S.data.source = "stats"; S.data.by = { t: "col", c: id }; S.data.labels = null; render(); };
      q.appendChild(b);
    }
    seg("pinShape", () => S.pins.shape, (v) => (S.pins.shape = v));
    $("pinColor").addEventListener("input", (e) => { S.pins.color = e.target.value.toUpperCase(); clearTimeout(t); t = setTimeout(render, 60); });
    $("pinLabels").onchange = (e) => { S.pins.labels = e.target.checked; render(); };
    $("pinByCat").onchange = (e) => { S.pins.byCat = e.target.checked; render(); };
    $("pinOnline").onchange = (e) => { S.pins.online = e.target.checked; render(); };
    $("pinSize").addEventListener("input", (e) => { S.pins.size = +e.target.value; clearTimeout(t); t = setTimeout(render, 60); });
    $("pinText").addEventListener("input", (e) => { S.pins.text = e.target.value; });
    $("pinApply").onclick = placePins;
    $("pinClear").onclick = () => { S.pins.items = []; S.pins.text = ""; $("pinText").value = ""; render(); };
    $("pinCount").onclick = () => { S.data.source = "pins"; S.data.by = null; S.data.labels = null; S.panel = "data"; if (S.legend.pos === "none") S.legend.pos = "br"; render(); };
    $("pinSample").onclick = () => {
      $("pinText").value = "이름\t주소\t분류\n대전 본사(예시)\t36.3504, 127.3845\t본사\n세종 지점(예시)\t세종특별자치시 보람동\t지점\n청주 지점(예시)\t충청북도 청주시 상당구 북문로\t지점\n공주 매장(예시)\t충남 공주시 웅진동\t매장\n논산 매장(예시)\t충남 논산시 취암동\t매장";
      placePins();
    };
    $("pinFile").onclick = () => $("pinFileInput").click();
    $("pinFileInput").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const buf = await f.arrayBuffer();
      let text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("\uFFFD")) { try { text = new TextDecoder("euc-kr").decode(buf); } catch (err) { /* 그대로 */ } }
      $("pinText").value = text.replace(/,/g, "\t");
      placePins();
    };
    const later = (ms) => { clearTimeout(t); t = setTimeout(render, ms); };
    $("hTitle").addEventListener("input", (e) => { S.heading.title = e.target.value; later(200); });
    $("hSub").addEventListener("input", (e) => { S.heading.subtitle = e.target.value; later(200); });
    $("hNote").addEventListener("change", (e) => { S.heading.note = e.target.checked; render(); });
    $("legTitle").addEventListener("input", (e) => { S.legend.title = e.target.value; later(200); });
    $("dataText").addEventListener("input", (e) => { S.data.text = e.target.value; S.data.file = ""; bigText = ""; });
    const newData = () => { S.data.by = null; S.data.labels = null; };
    $("dataApply").onclick = () => {
      S.data.source = "table";
      if (!S.data.file) S.data.text = $("dataText").value;
      newData();
      if (S.legend.pos === "none") S.legend.pos = "br";
      if (S.labelMode === "none") S.labelMode = "all";
      render();
      const dr = dataResult();
      if (dr && dr.matched) toast(`지도에서 ${Object.keys(dr.fills).length}곳을 칠했습니다`);
    };
    $("dataClear").onclick = () => { S.data.text = ""; S.data.file = ""; bigText = ""; $("dataText").value = ""; newData(); render(); };
    // 예시: 지금 보이는 지역 이름으로 무작위 숫자 표를 만든다 (열 이름에 "(예시)"를 붙여 실제 통계와 헷갈리지 않게)
    document.querySelectorAll("[data-sample]").forEach((btn) => (btn.onclick = () => {
      const lv = drawnLevels()[0];
      const keys = lastScene ? [...new Set(lastScene.polys.filter((p) => !/context|shadow|legend/.test(p.group) && p.lv === lv).map((p) => p.id))] : [];
      const ids = (keys.length ? keys : Object.keys(D[lv])).slice(0, 80);
      const nm = (id) => { const f = D[lv][id]; return lv === "sido" ? f.nm : R.sidoShort(D.sido[f.sido].nm) + " " + (f.city && lv === "sgg" ? f.city + " " : "") + f.nm; };
      const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
      let text;
      if (btn.dataset.sample === "stat") {
        text = "지역\t총인구(예시)\t청년 19~34세(예시)\t노인 65세 이상(예시)\n" + ids.map((id) => {
          const p = rnd(30000, 600000), y = Math.round(p * (0.12 + Math.random() * 0.14)), o = Math.round(p * (0.12 + Math.random() * 0.25));
          return `${nm(id)}\t${p}\t${y}\t${o}`;
        }).join("\n");
      } else if (btn.dataset.sample === "poll") {
        text = "지역\t후보 A(예시)\t후보 B(예시)\t후보 C(예시)\n" + ids.map((id) => {
          const a = rnd(25, 55), b = rnd(25, 55), c = Math.max(0, 100 - a - b - rnd(0, 10));
          return `${nm(id)}\t${a}%\t${b}%\t${c}%`;
        }).join("\n");
      } else {
        text = "지역\t값(예시)\n" + ids.map((id) => `${nm(id)}\t${rnd(20, 200)}`).join("\n");
      }
      S.data.text = text; S.data.file = ""; bigText = "";
      $("dataText").value = text;
      $("dataApply").click();
    }));
    $("dataFile").onclick = () => $("dataFileInput").click();
    $("dataFileInput").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const buf = await f.arrayBuffer();
      // 행정안전부 CSV 는 EUC-KR(CP949)인 경우가 많다: UTF-8 로 깨지면 EUC-KR 로 다시 읽는다
      let text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("\uFFFD")) { try { text = new TextDecoder("euc-kr").decode(buf); } catch (err) { /* 그대로 */ } }
      const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
      S.data.source = "table";
      if (text.length > 150000) {
        bigText = text; S.data.file = f.name; S.data.text = "";
        $("dataText").value = `[파일] ${f.name} — ${lines.toLocaleString("ko-KR")}줄 (지우기를 누르면 직접 붙여넣을 수 있습니다)`;
      } else {
        S.data.text = text; S.data.file = ""; bigText = "";
        $("dataText").value = text;
      }
      newData();
      if (S.legend.pos === "none") S.legend.pos = "br";
      render();
      const dr = dataResult();
      toast(dr && dr.matched ? `지도에서 ${Object.keys(dr.fills).length}곳을 칠했습니다` : "파일에서 지역을 찾지 못했습니다. 지역 이름이나 행정기관코드 열이 있는지 확인해 주세요");
    };
    $("dataBy").onchange = (e) => {
      const v = e.target.value, ds = dataset();
      const nums = ds.columns.filter((c) => c.kind !== "text");
      if (v.startsWith("col:")) S.data.by = { t: "col", c: v.slice(4) };
      else if (v === "ratio") {
        const total = nums.find((c) => /총인구|인구$|합계|전체/.test(c.name)) || nums[nums.length - 1];
        const part = nums.find((c) => c !== total && c.kind === "count") || nums[0];
        S.data.by = { t: "ratio", a: part.id, b: total.id };
      } else if (v === "win") S.data.by = { t: "win", cols: nums.map((c) => c.id) };
      S.data.labels = null;
      render();
    };
    const ratio = () => { S.data.by = { t: "ratio", a: $("ratioA").value, b: $("ratioB").value }; render(); };
    $("ratioA").onchange = ratio;
    $("ratioB").onchange = ratio;
    const pal = $("palettes");
    for (const [k, p] of Object.entries(X.PALETTES)) {
      const b = document.createElement("button");
      b.className = "pal";
      b.dataset.v = k;
      b.innerHTML = `<i style="background:linear-gradient(90deg,${p.stops.join(",")})"></i>${p.name}`;
      b.onclick = () => { S.data.palette = k; render(); };
      pal.appendChild(b);
    }
    $("dataSteps").onchange = (e) => { S.data.steps = +e.target.value; render(); };
    $("dataMethod").onchange = (e) => { S.data.method = e.target.value; render(); };
    $("dataValues").onchange = (e) => { S.data.showValues = e.target.checked; render(); };
    const GROUP_COLORS = ["#EF6B4C", "#14A37F", "#F2B33D", "#8B5CF6", "#3361E0", "#E0559A", "#4BB3D9", "#8C6D46"];
    $("groupAdd").onclick = () => {
      const id = "g" + Date.now().toString(36);
      const names = ["본사", "지사", "대리점", "예정", "그룹 5", "그룹 6", "그룹 7", "그룹 8"];
      S.groups.push({ id, name: names[S.groups.length] || `그룹 ${S.groups.length + 1}`, color: GROUP_COLORS[S.groups.length % GROUP_COLORS.length] });
      S.activeGroup = id;
      S.clickAction = "group";
      if (S.legend.pos === "none") S.legend.pos = "br";
      render();
      toast("지도에서 지역을 누르면 이 그룹 색으로 칠해집니다");
    };

    // 되돌리기 · 작업 파일 · 이미지 복사
    $("undo").onclick = () => stepHistory(-1);
    $("redo").onclick = () => stepHistory(1);
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); }
      else if (k === "y") { e.preventDefault(); stepHistory(1); }
    });
    $("saveWork").onclick = () => {
      const body = JSON.stringify({ app: "행정구역 지도 추출기", version: 1, saved: new Date().toISOString(), state: JSON.parse(snapshot()), fileText: S.data.file ? bigText : undefined }, null, 1);
      saveFile("지도작업_" + baseName(lastScene || { title: "지도" }) + ".json", body, "application/json");
    };
    $("loadWork").onclick = () => $("loadFile").click();
    $("loadFile").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const o = JSON.parse(await f.text());
        bigText = o.fileText || "";
        restore(o.state || o);
        if (S.data.file && bigText) $("dataText").value = `[파일] ${S.data.file}`;
        render();
        toast("작업을 불러왔습니다");
      } catch (err) {
        toast("작업 파일을 읽지 못했습니다. 이 도구에서 저장한 .json 파일인지 확인해 주세요.");
      }
    };
    $("copyImg").onclick = copyImage;
  }

  // ---------- 하나씩 꾸미기 ----------
  function regionOf(key) {
    const [lv, id] = key.split(":");
    return D[lv] && D[lv][id] ? { lv, id, f: D[lv][id] } : null;
  }
  function renderEditor() {
    $("editBox").hidden = S.clickAction !== "edit";
    if (S.clickAction !== "edit") return;
    const r = S.editKey && regionOf(S.editKey);
    $("editEmpty").hidden = !!r;
    $("editForm").hidden = !r;
    if (!r) return;
    const st = S.styles[S.editKey] || {};
    const poly = lastScene && lastScene.polys.find((p) => p.lv + ":" + p.id === S.editKey && p.group !== "shadow");
    $("editName").textContent = r.f.full;
    $("editFill").value = st.fill || (poly ? poly.fill : "#888888");
    if (document.activeElement !== $("editText")) $("editText").value = st.text || "";
    $("editText").placeholder = r.f.nm;
    $("editHide").checked = !!st.hideLabel;
    $("map").querySelectorAll(`[data-k="${S.editKey}"][data-id]`).forEach((el) => el.classList.add("sel"));
  }
  function setStyle(patch) {
    const k = S.editKey;
    if (!k) return;
    const st = Object.assign({}, S.styles[k], patch);
    for (const p in st) if (st[p] === "" || st[p] === false || st[p] == null) delete st[p];
    if (Object.keys(st).length) S.styles[k] = st;
    else delete S.styles[k];
  }
  function bindEditor() {
    let t;
    $("editFill").addEventListener("input", (e) => { setStyle({ fill: e.target.value.toUpperCase() }); clearTimeout(t); t = setTimeout(render, 50); });
    $("editText").addEventListener("input", (e) => { setStyle({ text: e.target.value.trim() }); clearTimeout(t); t = setTimeout(render, 200); });
    $("editHide").addEventListener("change", (e) => { setStyle({ hideLabel: e.target.checked }); render(); });
    $("editReset").onclick = () => { delete S.styles[S.editKey]; delete S.offsets[S.editKey]; render(); };
    $("editDone").onclick = () => { S.editKey = null; render(); };

    // 끌어서 옮기기: 끄는 동안은 transform 으로만 움직이고, 놓을 때 위치를 저장한 뒤 다시 그린다
    const map = $("map");
    let drag = null;
    map.addEventListener("pointerdown", (e) => {
      if (S.clickAction !== "edit" || !lastScene) return;
      const p = e.target.closest("[data-id]");
      if (!p || p.closest("#배경")) return;
      const key = p.dataset.k;
      const svg = map.querySelector("svg");
      drag = { key, x: e.clientX, y: e.clientY, moved: false, els: [...svg.querySelectorAll(`[data-k="${key}"]`)], k: lastScene.width / svg.getBoundingClientRect().width };
      map.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    map.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; map.classList.add("dragging"); drag.els.forEach((el) => el.parentNode.appendChild(el)); }
      drag.els.forEach((el) => el.setAttribute("transform", `translate(${dx * drag.k} ${dy * drag.k})`));
    });
    const end = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      map.classList.remove("dragging");
      if (d.moved) {
        const f = d.k / lastScene.scale; // 화면 px → 데이터 좌표
        const old = S.offsets[d.key] || [0, 0];
        S.offsets[d.key] = [old[0] + (e.clientX - d.x) * f, old[1] + (e.clientY - d.y) * f];
      }
      S.editKey = d.key;
      render();
    };
    map.addEventListener("pointerup", end);
    map.addEventListener("pointercancel", () => { drag = null; map.classList.remove("dragging"); render(); });
  }

  // ---------- 검색 ----------
  function bindSearch() {
    const q = $("q"), box = $("results");
    let sel = 0, hits = [];
    const show = () => {
      const v = q.value.replace(/\s+/g, "");
      if (!v) { box.hidden = true; return; }
      if (emdState === "none") loadEmd();
      const toks = q.value.trim().split(/\s+/);
      hits = index
        .filter((e) => toks.every((t) => e.key.includes(t)))
        .map((e) => ({ e, score: (e.nm === v ? 0 : e.nm.startsWith(toks[toks.length - 1]) ? 1 : 2) * 10 + ORDER[e.lv] }))
        .sort((a, b) => a.score - b.score || a.e.full.length - b.e.full.length)
        .slice(0, 14)
        .map((h) => h.e);
      sel = 0;
      box.innerHTML = hits.length
        ? hits.map((h, i) => `<button data-i="${i}" class="${i === sel ? "on" : ""}"><span>${h.full}</span><small>${LV_KO[h.lv]}</small></button>`).join("")
        : `<div class="empty" style="padding:8px 12px">${emdState === "loading" ? "읍면동 목록을 불러오는 중…" : "찾는 지역이 없습니다"}</div>`;
      box.hidden = false;
    };
    const pick = (h) => {
      if (!h) return;
      q.value = "";
      box.hidden = true;
      if (S.mode === "pick") {
        const lv = eff(S.pick.lv);
        if (lv === "emd" && emdState !== "ready") { toast("읍면동을 불러오는 중입니다. 잠시 뒤 다시 골라 주세요."); return; }
        const ids = convert(h.lv, h.id, lv);
        if (ids.length) addPick(ids);
        toast(`${h.full}: ${R.LEVEL_NAME[lv]} ${ids.length}곳을 넣었습니다`);
      } else setTarget({ lv: h.lv, id: h.id });
    };
    q.addEventListener("input", show);
    q.addEventListener("focus", show);
    q.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = Math.max(0, Math.min(hits.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
        box.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === sel));
      } else if (e.key === "Enter") { e.preventDefault(); pick(hits[sel]); }
      else if (e.key === "Escape") box.hidden = true;
    });
    box.addEventListener("mousedown", (e) => {
      const b = e.target.closest("button");
      if (b) { e.preventDefault(); pick(hits[+b.dataset.i]); }
    });
    q.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 120));
    (window.KRMAP.waiting.emd = window.KRMAP.waiting.emd || []).push(() => { if (document.activeElement === q) show(); });
  }

  // ---------- 내보내기 ----------
  let downloadsCap = null;
  if (window.claude && typeof window.claude.use === "function") {
    downloadsCap = window.claude.use("downloads").catch(() => null);
  }
  async function saveFile(filename, data, mime) {
    const cap = downloadsCap ? await downloadsCap : null;
    if (cap) {
      try {
        await cap.save({ filename, data });
        toast(`${filename} 저장했습니다`);
      } catch (e) {
        if (e && e.code !== "declined") toast(`저장하지 못했습니다 (${e.code || "오류"})`);
      }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = (scene) => scene.title.replace(/[\\/:*?"<>|]/g, "").replace(/[\s,]+/g, "_").slice(0, 80);
  function freshScene() {
    if (needsEmd() && emdState !== "ready") { toast("읍면동을 불러오는 중입니다"); return null; }
    return R.buildScene(D, sceneOpts(1600));
  }
  function exportSVG() {
    const scene = D && freshScene();
    if (scene) saveFile(baseName(scene) + ".svg", R.toSVG(scene), "image/svg+xml");
  }
  function sceneToPng(scene, scale) {
    return new Promise((ok, fail) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([R.toSVG(scene)], { type: "image/svg+xml" }));
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = Math.round(scene.width * scale);
        c.height = Math.round(scene.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png");
      };
      img.onerror = fail;
      img.src = url;
    });
  }
  function exportPNG() {
    const scene = D && freshScene();
    if (!scene) return;
    sceneToPng(scene, 2.5).then((b) => saveFile(baseName(scene) + ".png", b, "image/png"), () => toast("PNG를 만들지 못했습니다"));
  }
  function copyImage() {
    const scene = D && freshScene();
    if (!scene) return;
    // 바탕이 투명하면 PPT 에 붙였을 때 보기 어려워 흰 바탕(또는 테마 바탕)을 깐다
    const solid = Object.assign({}, scene, { bg: scene.bg || "#FFFFFF" });
    const png = sceneToPng(solid, 2);
    try {
      navigator.clipboard
        .write([new ClipboardItem({ "image/png": png })])
        .then(() => toast("이미지를 복사했습니다. PPT에서 붙여넣기(Ctrl+V) 하세요"), () => toast("이 화면에서는 이미지 복사가 막혀 있습니다. PNG 저장을 써 주세요"));
    } catch (e) {
      toast("이 브라우저는 이미지 복사를 지원하지 않습니다. PNG 저장을 써 주세요");
    }
  }

  function loadPptx() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "vendor/pptxgen.bundle.js";
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  async function exportPPTX() {
    const scene = D && freshScene();
    if (!scene) return;
    const btn = $("dlPptx");
    btn.disabled = true;
    try {
      await loadPptx();
      const pptx = new window.PptxGenJS();
      pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
      pptx.title = scene.title;
      const slide = pptx.addSlide();
      const SW = 13.333, SH = 7.5, M = 0.35;
      const k = Math.min((SW - 2 * M) / scene.width, (SH - 2 * M - 0.2) / scene.height); // px → inch
      const ox = (SW - scene.width * k) / 2, oy = (SH - 0.2 - scene.height * k) / 2;
      const hex = (c) => c.replace("#", "").toUpperCase();
      const r3 = (v) => Math.round(v * 10000) / 10000;
      if (scene.bg) slide.background = { color: hex(scene.bg) };

      const shape = (rings, closed, opt) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const r of rings) for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        if (!isFinite(x0)) return;
        const points = [];
        for (const r of rings) {
          r.forEach((p, i) => points.push({ x: r3((p[0] - x0) * k), y: r3((p[1] - y0) * k), moveTo: i === 0 }));
          if (closed) points.push({ close: true });
        }
        slide.addShape(pptx.ShapeType.custGeom, Object.assign({
          x: r3(ox + x0 * k), y: r3(oy + y0 * k), w: Math.max(r3((x1 - x0) * k), 0.01), h: Math.max(r3((y1 - y0) * k), 0.01), points,
        }, opt));
      };
      const ORDERG = ["context", "all", "neighbor", "shadow", "picked", "inner", "target", "sido", "pin", "legend"];
      const sh = scene.shadow;
      for (const g of ORDERG) {
        for (const p of scene.polys.filter((q) => q.group === g)) {
          shape([].concat(...p.rings), true, {
            fill: { color: hex(p.fill) },
            line: p.stroke ? { color: hex(p.stroke), width: Math.max(p.width * k * 72, 0.25) } : { type: "none" },
            objectName: g === "shadow" ? "그림자 " + p.name : p.name,
            shadow: g === "shadow" && sh
              ? { type: "outer", angle: 90, blur: Math.round(sh.blur * k * 72 * 2), offset: Math.round(sh.dy * k * 72 * 10) / 10, color: hex(sh.color), opacity: sh.opacity }
              : undefined,
          });
        }
        for (const l of scene.lines.filter((q) => q.group === g)) {
          if (!l.lines.length) continue;
          shape(l.lines, false, { line: { color: hex(l.stroke), width: Math.max(l.width * k * 72, 0.25) }, objectName: g === "sido" ? "시도 경계" : "경계선" });
        }
      }
      for (const t of scene.texts) {
        const w = (t.text.length + 1) * t.size * k * 1.1, h = t.size * k * 1.5;
        const left = t.anchor === "start";
        slide.addText(t.text, {
          x: r3(ox + t.x * k - (left ? 0 : w / 2)), y: r3(oy + t.y * k - h / 2), w: r3(w), h: r3(h), align: left ? "left" : "center",
          fontFace: "맑은 고딕", fontSize: Math.max(Math.round(t.size * k * 72 * 10) / 10, 4), bold: t.weight >= 600,
          color: hex(t.fill), valign: "middle", margin: 0,
          outline: t.halo ? { color: "FFFFFF", size: Math.max(t.size * k * 72 * 0.08, 0.5) } : undefined,
          objectName: "지명 " + t.text,
        });
      }
      if (!S.heading.note) slide.addText(`${sourceNote()} · github.com/vuski/admdongkor`, {
        x: SW - 6.2, y: SH - 0.32, w: 6, h: 0.22, fontFace: "맑은 고딕", fontSize: 7, color: "8A96A3", align: "right", margin: 0,
      });
      const blob = await pptx.write({ outputType: "blob" });
      await saveFile(baseName(scene) + ".pptx", blob, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } catch (e) {
      console.error(e);
      toast("PPTX를 만들지 못했습니다");
    } finally {
      btn.disabled = false;
    }
  }

  async function copyList() {
    if (!lastList.length) return;
    const home = S.mode === "around" ? D[S.target.lv][S.target.id].sido : D[lastList[0].lv][lastList[0].id].sido;
    const names = lastList.map(({ lv, id }) => {
      const f = D[lv][id];
      const nm = shortName(lv, f);
      return f.sido !== home && lv !== "sido" ? `${nm}(${R.sidoShort(D.sido[f.sido].nm)})` : nm;
    });
    const head = S.mode === "around" ? `${D[S.target.lv][S.target.id].full} 주변` : "고른 지역";
    const text = `${head} ${names.length}곳: ${names.join(", ")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("목록을 복사했습니다");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      toast(ok ? "목록을 복사했습니다" : text);
    }
  }

  let toastT;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.hidden = true), 2600);
  }

  // ---------- 시작 ----------
  function readHash() {
    const h = (location.hash || "").slice(1);
    if (h === "all" || h === "pick") { S.mode = h; return; }
    const m = h.match(/^(sido|si|sgg|emd)-(\d+)$/);
    if (m && (m[1] === "emd" || D[m[1]][m[2]])) S.target = { lv: m[1], id: m[2] };
  }
  function start() {
    initData();
    // 주소에 지역이 없으면 지난번 작업을 이어서 연다
    if (!location.hash) {
      try {
        const saved = localStorage.getItem(STORE);
        if (saved) { restore(saved); setTimeout(() => toast("지난 작업을 이어서 열었습니다 (↶ 되돌리기로 이전 상태로)"), 600); }
      } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    }
    readHash();
    bindControls();
    $("credit").innerHTML =
      `경계: 통계청 SGIS 행정구역 경계(공공누리 제1유형), <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener">vuski/admdongkor</a> 가공본 (CC BY 4.0). 기준 시점 ${ver()}` +
      (D.sido17 ? ". 이 시점에는 광주광역시와 전라남도가 전남광주통합특별시로 합쳐져 있습니다(2026.7.1). 17개 시도로 보려면 '지역' 탭의 \"광주·전남 나눠 보기\"를 켜세요." : ".") +
      (window.KRMAP.stats ? ` 기본 통계: 행정안전부 주민등록 인구통계 ${window.KRMAP.stats.meta.month}월말.` : "") +
      " 지점 인터넷 주소 검색: © OpenStreetMap 기여자. 슬라이드에 쓸 때 출처를 함께 적어 주세요.";
    render();
    // 검색이 바로 되도록 읍면동은 뒤에서 미리 받아 둔다
    setTimeout(loadEmd, 800);
  }
  if (window.KRMAP.base) start();
  else (window.KRMAP.waiting.base = window.KRMAP.waiting.base || []).push(start);
})();
