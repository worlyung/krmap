/* 행정구역 지도 추출기 — 화면 조작, 검색, 내보내기(SVG/PNG/PPTX). 지도 그리기는 render.js */
(function () {
  const R = window.KRMapRender;
  const $ = (id) => document.getElementById(id);
  const ORDER = R.LEVEL_ORDER;
  const LV_KO = { sido: "시도", si: "시군구", sgg: "구", emd: "읍면동" };

  const PRESETS = [
    { name: "파랑", target: "#2F5BD3", neighbor: "#BCCDF2", context: "#E7EBF0" },
    { name: "주황", target: "#E0582F", neighbor: "#F7CBB7", context: "#EDEBE8" },
    { name: "초록", target: "#1E8A5A", neighbor: "#B6E0C8", context: "#E7ECE9" },
    { name: "보라", target: "#6B4FC8", neighbor: "#D3C8F2", context: "#ECEAF2" },
    { name: "먹색", target: "#2D3846", neighbor: "#BAC3CE", context: "#EDEFF2" },
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
    clickAction: "label",
    subLabel: true,
    halo: false,
    fontScale: 1,
    // 모양
    sidoLines: true,
    lineScale: 1,
    colors: Object.assign({}, PRESETS[0]),
    distinct: false,
    whiteBg: false,
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
      aspect: S.aspect,
      width: width || 1600,
      colors: { target: S.colors.target, neighbor: S.colors.neighbor, context: S.colors.context, bg: S.whiteBg ? "#FFFFFF" : null },
    };
    if (S.mode === "pick") {
      o.pick = { lv: eff(S.pick.lv), ids: S.pick.ids, fit: S.pick.fit, hideOthers: S.pick.hideOthers };
    } else if (S.mode === "all") {
      o.target = null;
      o.inner = eff(S.allLv);
      o.shortSido = true;
    } else {
      Object.assign(o, { target: S.target, depth: S.depth, nbLevel: eff(S.nbLevel), inner: innerFor(S.target), context: S.context });
    }
    return o;
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
    $("slide").classList.toggle("solid", S.whiteBg);
    renderInfo(scene);
    renderLabelPick(scene);
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
    $("searchLbl").textContent = S.mode === "pick" ? "찾아서 넣기" : "지역 찾기";
    $("inner").querySelectorAll("button").forEach((b) => {
      const v = b.dataset.v;
      b.disabled = !!(v && ORDER[eff(v)] <= ORDER[S.target.lv]);
    });
    $("nbLevel").querySelectorAll("button").forEach((b) => (b.disabled = !S.depth));
    $("hideOthers").checked = S.pick.hideOthers;
    $("sido17").checked = S.sido17;
    $("sido17").closest("label").hidden = !D.sido17;
    $("labelHint").hidden = S.labelMode !== "pick";
    $("clickBar").hidden = S.labelMode !== "pick";
    $("clickMain").textContent = S.mode === "pick" ? "영역 넣기·빼기" : "그 지역으로 이동";
    $("cTargetLbl").firstChild.textContent = S.mode === "pick" ? "고른 지역" : S.mode === "all" ? "강조" : "대상";
    $("cNeighborLbl").firstChild.textContent = S.mode === "all" ? "지역" : "주변";
    $("cTarget").value = S.colors.target;
    $("cNeighbor").value = S.colors.neighbor;
    $("cContext").value = S.colors.context;
    document.querySelectorAll(".sw").forEach((b, i) => {
      const p = PRESETS[i];
      b.classList.toggle("on", p.target === S.colors.target && p.neighbor === S.colors.neighbor && p.context === S.colors.context);
    });
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
    seg("clickAction", () => S.clickAction, (v) => (S.clickAction = v));

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
    chk("whiteBg", (v) => (S.whiteBg = v));
    let t;
    const slider = (id, set) => $(id).addEventListener("input", (e) => { set(+e.target.value); clearTimeout(t); t = setTimeout(render, 60); });
    slider("fontScale", (v) => (S.fontScale = v));
    slider("lineScale", (v) => (S.lineScale = v));
    const col = (id, key) => $(id).addEventListener("input", (e) => { S.colors[key] = e.target.value.toUpperCase(); clearTimeout(t); t = setTimeout(render, 60); });
    col("cTarget", "target");
    col("cNeighbor", "neighbor");
    col("cContext", "context");

    const ps = $("presets");
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "sw";
      b.title = p.name;
      b.setAttribute("aria-label", `색 조합: ${p.name}`);
      b.innerHTML = `<i style="background:${p.target}"></i><i style="background:${p.neighbor}"></i>`;
      b.onclick = () => { S.colors = Object.assign({}, p); render(); };
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
  function exportPNG() {
    const scene = D && freshScene();
    if (!scene) return;
    const svg = R.toSVG(scene);
    const scale = 2.5;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(scene.width * scale);
      c.height = Math.round(scene.height * scale);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => saveFile(baseName(scene) + ".png", b, "image/png"), "image/png");
    };
    img.onerror = () => toast("PNG를 만들지 못했습니다");
    img.src = url;
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
      const ORDERG = ["context", "all", "neighbor", "picked", "inner", "target", "sido"];
      for (const g of ORDERG) {
        for (const p of scene.polys.filter((q) => q.group === g)) {
          shape([].concat(...p.rings), true, {
            fill: { color: hex(p.fill) },
            line: p.stroke ? { color: hex(p.stroke), width: Math.max(p.width * k * 72, 0.25) } : { type: "none" },
            objectName: p.name,
          });
        }
        for (const l of scene.lines.filter((q) => q.group === g)) {
          if (!l.lines.length) continue;
          shape(l.lines, false, { line: { color: hex(l.stroke), width: Math.max(l.width * k * 72, 0.25) }, objectName: g === "sido" ? "시도 경계" : "경계선" });
        }
      }
      for (const t of scene.texts) {
        const w = (t.text.length + 1) * t.size * k * 1.1, h = t.size * k * 1.5;
        slide.addText(t.text, {
          x: r3(ox + t.x * k - w / 2), y: r3(oy + t.y * k - h / 2), w: r3(w), h: r3(h),
          fontFace: "맑은 고딕", fontSize: Math.max(Math.round(t.size * k * 72 * 10) / 10, 4), bold: t.weight >= 600,
          color: hex(t.fill), align: "center", valign: "middle", margin: 0,
          outline: t.halo ? { color: "FFFFFF", size: Math.max(t.size * k * 72 * 0.08, 0.5) } : undefined,
          objectName: "지명 " + t.text,
        });
      }
      slide.addText(`출처: 통계청 SGIS 행정구역 경계(${ver()}), github.com/vuski/admdongkor`, {
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
    readHash();
    bindControls();
    $("credit").innerHTML =
      `경계: 통계청 SGIS 행정구역 경계(공공누리 제1유형), <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener">vuski/admdongkor</a> 가공본 (CC BY 4.0). 기준 시점 ${ver()}` +
      (D.sido17 ? ". 이 시점에는 광주광역시와 전라남도가 전남광주통합특별시로 합쳐져 있습니다(2026.7.1). 17개 시도로 보려면 위에서 \"광주·전남 나눠 보기\"를 켜세요." : ".") +
      " 슬라이드에 쓸 때 출처를 함께 적어 주세요.";
    render();
    // 검색이 바로 되도록 읍면동은 뒤에서 미리 받아 둔다
    setTimeout(loadEmd, 800);
  }
  if (window.KRMAP.base) start();
  else (window.KRMAP.waiting.base = window.KRMAP.waiting.base || []).push(start);
})();
