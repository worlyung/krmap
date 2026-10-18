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
    target: { lv: "sido", id: "30" },
    depth: 1,
    nbLevel: "si",
    inner: "",
    splitGu: false,
    context: true,
    sidoLines: true,
    labels: { target: true, neighbor: true, inner: true },
    subLabel: true,
    halo: false,
    fontScale: 1,
    lineScale: 1,
    colors: Object.assign({}, PRESETS[0]),
    distinct: false,
    whiteBg: false,
    aspect: null,
  };

  let D = null; // 병합된 데이터 {meta, sido, si, sgg, emd?, nb}
  let emdState = "none"; // none | loading | ready
  let index = [];
  let lastNbs = [];

  // ---------- 데이터 ----------
  function initData() {
    const B = window.KRMAP.base;
    D = { meta: B.meta, sido: B.sido, si: B.si, sgg: B.sgg, emd: null, nb: Object.assign({}, B.nb) };
    buildIndex();
  }
  function loadEmd() {
    if (emdState !== "none") return;
    emdState = "loading";
    (window.KRMAP.waiting.emd = window.KRMAP.waiting.emd || []).unshift(() => {
      const E = window.KRMAP.emd;
      D.emd = E.emd;
      Object.assign(D.nb, E.nb);
      emdState = "ready";
      buildIndex();
      render();
    });
    const s = document.createElement("script");
    s.src = "data/emd.js";
    s.onerror = () => { emdState = "none"; toast("읍면동 데이터를 불러오지 못했습니다. 새로고침해 보세요."); };
    document.head.appendChild(s);
  }
  const needsEmd = () => S.nbLevel === "emd" || S.inner === "emd" || (S.target && S.target.lv === "emd");

  function buildIndex() {
    index = [];
    const push = (lv, id, f) => index.push({ lv, id, full: f.full, nm: f.nm, key: f.full.replace(/\s+/g, "") });
    for (const id in D.sido) push("sido", id, D.sido[id]);
    for (const id in D.si) push("si", id, D.si[id]);
    for (const id in D.sgg) if (D.sgg[id].city) push("sgg", id, D.sgg[id]);
    if (D.emd) for (const id in D.emd) push("emd", id, D.emd[id]);
  }

  // ---------- 상태 → 렌더 옵션 ----------
  const eff = (lv) => (lv === "si" && S.splitGu ? "sgg" : lv);
  function innerFor(target) {
    if (!S.inner) return null;
    const lv = eff(S.inner);
    if (!target) return lv;
    if (ORDER[lv] <= ORDER[target.lv]) return null;
    if (lv === "sgg" && !(target.lv === "sido" || (target.lv === "si" && D.si[target.id].gu))) return null;
    return lv;
  }
  function sceneOpts(width) {
    return {
      target: S.target,
      depth: S.target ? S.depth : 0,
      nbLevel: eff(S.nbLevel),
      inner: S.target ? innerFor(S.target) : eff(S.inner || "sido"),
      context: S.context,
      sidoLines: S.sidoLines,
      labels: S.labels,
      subLabel: S.subLabel,
      halo: S.halo,
      fontScale: S.fontScale,
      lineScale: S.lineScale,
      distinct: S.distinct,
      aspect: S.aspect,
      shortSido: !S.target,
      width: width || 1600,
      colors: { target: S.colors.target, neighbor: S.colors.neighbor, context: S.colors.context, bg: S.whiteBg ? "#FFFFFF" : null },
    };
  }

  // ---------- 그리기 ----------
  function render() {
    if (!D) return;
    if (needsEmd() && emdState !== "ready") {
      loadEmd();
      $("map").innerHTML = '<span class="loading">읍면동 경계를 불러오는 중입니다…</span>';
      return;
    }
    syncControls();
    const scene = R.buildScene(D, sceneOpts(1600));
    $("map").innerHTML = R.toSVG(scene, { interactive: true });
    $("slide").classList.toggle("solid", S.whiteBg);
    renderInfo();
    try { history.replaceState(null, "", S.target ? `#${S.target.lv}-${S.target.id}` : "#all"); } catch (e) { /* 미리보기 환경 */ }
  }

  function renderInfo() {
    const T = S.target && D[S.target.lv][S.target.id];
    const m = D.meta.version;
    const ver = `${m.slice(0, 4)}.${m.slice(4, 6)}.${m.slice(6)}`;
    if (!T) {
      $("title").textContent = "전국";
      $("meta").textContent = `${R.LEVEL_NAME[eff(S.inner || "sido")]} 단위 · 기준 ${ver}`;
      $("nbHead").textContent = "지역을 누르면 그 지역과 주변이 나옵니다";
      $("nbList").innerHTML = "";
      lastNbs = [];
      return;
    }
    $("title").textContent = T.full + (S.depth ? " 주변" : "");
    $("meta").textContent = `${LV_KO[S.target.lv]} · 코드 ${S.target.id} · 면적 ${T.a.toLocaleString("ko-KR")} km² · 기준 ${ver}`;
    const nbLv = eff(S.nbLevel);
    const nbs = S.depth ? R.neighborsOf(D, S.target.lv, S.target.id, nbLv, S.depth) : [];
    lastNbs = nbs.map((n) => Object.assign({ lv: nbLv }, n));
    const r1 = nbs.filter((n) => n.ring === 1).length;
    $("nbHead").textContent = S.depth
      ? `맞닿은 ${R.LEVEL_NAME[nbLv]} ${r1}곳` + (S.depth === 2 ? ` · 한 겹 더 ${nbs.length - r1}곳` : "")
      : "주변 지역 표시가 꺼져 있습니다";
    const list = $("nbList");
    list.innerHTML = "";
    for (const n of nbs) {
      const f = D[nbLv][n.id];
      const b = document.createElement("button");
      b.className = "chip" + (n.ring === 2 ? " r2" : "");
      b.textContent = f.city && nbLv === "sgg" ? `${f.city} ${f.nm}` : f.nm;
      if (f.sido !== T.sido && nbLv !== "sido") {
        const sm = document.createElement("small");
        sm.textContent = R.sidoShort(D.sido[f.sido].nm);
        b.appendChild(sm);
      }
      b.title = f.full;
      b.onclick = () => setTarget({ lv: nbLv, id: n.id });
      list.appendChild(b);
    }
    if (!nbs.length && S.depth) list.innerHTML = '<span class="empty">맞닿은 지역이 없습니다 (섬 지역 등).</span>';
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
    ["depth", "nbLevel", "inner", "aspect"].forEach((id) => $(id)._sync());
    // 대상보다 큰 단위로는 안쪽을 나눌 수 없다
    $("inner").querySelectorAll("button").forEach((b) => {
      const v = b.dataset.v;
      b.disabled = !!(v && S.target && ORDER[eff(v)] <= ORDER[S.target.lv]);
    });
    $("inner").querySelector('[data-v=""]').textContent = S.target ? "나누지 않음" : "—";
    $("inner").querySelector('[data-v=""]').disabled = !S.target;
    $("innerLbl").textContent = S.target ? "대상 안쪽 나누기" : "전국 지도 단위";
    $("depth").querySelectorAll("button").forEach((b) => (b.disabled = !S.target));
    $("nbLevel").querySelectorAll("button").forEach((b) => (b.disabled = !S.target || !S.depth));
    $("cTarget").value = S.colors.target;
    $("cNeighbor").value = S.colors.neighbor;
    $("cContext").value = S.colors.context;
    document.querySelectorAll(".sw").forEach((b, i) => {
      const p = PRESETS[i];
      b.classList.toggle("on", p.target === S.colors.target && p.neighbor === S.colors.neighbor && p.context === S.colors.context);
    });
    renderCrumbs();
  }

  function renderCrumbs() {
    const el = $("crumbs");
    el.innerHTML = "";
    const chain = [{ label: "전국", t: null }];
    const t = S.target;
    if (t) {
      const f = D[t.lv][t.id];
      chain.push({ label: D.sido[f.sido].nm, t: { lv: "sido", id: f.sido } });
      if (t.lv !== "sido") {
        const si = D.si[f.si];
        if (si) chain.push({ label: si.nm, t: { lv: "si", id: f.si } });
        const sggId = t.lv === "emd" ? f.sgg : t.lv === "sgg" ? t.id : null;
        if (sggId && D.sgg[sggId].city) chain.push({ label: D.sgg[sggId].nm, t: { lv: "sgg", id: sggId } });
        if (t.lv === "emd") chain.push({ label: f.nm, t });
      }
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
      if (!last) n.onclick = () => setTarget(c.t);
      el.appendChild(n);
    });
  }

  function setTarget(t) {
    if (t && S.target && t.lv === S.target.lv && t.id === S.target.id) return;
    S.target = t;
    if (!t && (!S.inner || S.inner === "emd")) S.inner = "sido";
    if (t && S.inner && ORDER[eff(S.inner)] <= ORDER[t.lv]) S.inner = "";
    render();
  }

  function bindControls() {
    seg("depth", () => S.depth, (v) => (S.depth = +v));
    seg("nbLevel", () => S.nbLevel, (v) => (S.nbLevel = v));
    seg("inner", () => S.inner, (v) => (S.inner = v));
    seg("aspect", () => (S.aspect ? String(S.aspect) : ""), (v) => (S.aspect = v ? +v : null));
    const chk = (id, set) => $(id).addEventListener("change", (e) => { set(e.target.checked); render(); });
    chk("splitGu", (v) => (S.splitGu = v));
    chk("context", (v) => (S.context = v));
    chk("sidoLines", (v) => (S.sidoLines = v));
    chk("lblTarget", (v) => (S.labels.target = v));
    chk("lblNb", (v) => (S.labels.neighbor = v));
    chk("lblInner", (v) => (S.labels.inner = v));
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

    // 지도 클릭 → 그 지역으로 이동
    $("map").addEventListener("click", (e) => {
      const p = e.target.closest("[data-id]");
      if (p) setTarget({ lv: p.dataset.lv, id: p.dataset.id });
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
      setTarget({ lv: h.lv, id: h.id });
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
  function baseName() {
    const T = S.target && D[S.target.lv][S.target.id];
    const name = T ? T.full + (S.depth ? " 주변" : "") : `전국 ${R.LEVEL_NAME[eff(S.inner || "sido")]}`;
    return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
  }
  function exportSVG() {
    if (!D) return;
    const scene = R.buildScene(D, sceneOpts(1600));
    saveFile(baseName() + ".svg", R.toSVG(scene), "image/svg+xml");
  }
  function exportPNG() {
    if (!D) return;
    const scene = R.buildScene(D, sceneOpts(1600));
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
      c.toBlob((b) => saveFile(baseName() + ".png", b, "image/png"), "image/png");
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
    if (!D) return;
    const btn = $("dlPptx");
    btn.disabled = true;
    try {
      await loadPptx();
      const scene = R.buildScene(D, sceneOpts(1600));
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
      const ORDERG = ["context", "all", "neighbor", "inner", "target", "sido"];
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
      const v = D.meta.version;
      slide.addText(`출처: 통계청 SGIS 행정구역 경계(${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}), github.com/vuski/admdongkor`, {
        x: SW - 6.2, y: SH - 0.32, w: 6, h: 0.22, fontFace: "맑은 고딕", fontSize: 7, color: "8A96A3", align: "right", margin: 0,
      });
      const blob = await pptx.write({ outputType: "blob" });
      await saveFile(baseName() + ".pptx", blob, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } catch (e) {
      console.error(e);
      toast("PPTX를 만들지 못했습니다");
    } finally {
      btn.disabled = false;
    }
  }

  async function copyList() {
    if (!S.target) return;
    const T = D[S.target.lv][S.target.id];
    const names = lastNbs.map((n) => {
      const f = D[n.lv][n.id];
      const nm = f.city && n.lv === "sgg" ? `${f.city} ${f.nm}` : f.nm;
      return f.sido !== T.sido && n.lv !== "sido" ? `${nm}(${R.sidoShort(D.sido[f.sido].nm)})` : nm;
    });
    const text = `${T.full} 주변 ${names.length}곳: ${names.join(", ")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("주변 지역 목록을 복사했습니다");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      toast(ok ? "주변 지역 목록을 복사했습니다" : text);
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
    if (h === "all") return null;
    const m = h.match(/^(sido|si|sgg|emd)-(\d+)$/);
    return m ? { lv: m[1], id: m[2] } : undefined;
  }
  function start() {
    initData();
    const ht = readHash();
    if (ht === null) { S.target = null; S.inner = "sido"; }
    else if (ht && (ht.lv === "emd" || D[ht.lv][ht.id])) S.target = ht;
    bindControls();
    const m = D.meta;
    $("credit").innerHTML =
      `경계: 통계청 SGIS 행정구역 경계(공공누리 제1유형), <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener">vuski/admdongkor</a> 가공본 (CC BY 4.0). 기준 시점 ${m.version.slice(0, 4)}.${m.version.slice(4, 6)}.${m.version.slice(6)}. 슬라이드에 쓸 때 출처를 함께 적어 주세요.`;
    render();
    // 검색이 바로 되도록 읍면동은 뒤에서 미리 받아 둔다
    setTimeout(loadEmd, 800);
  }
  if (window.KRMAP.base) start();
  else (window.KRMAP.waiting.base = window.KRMAP.waiting.base || []).push(start);
})();
