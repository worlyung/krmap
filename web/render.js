/*
 * 대한민국 행정구역 지도 렌더러 — 브라우저와 Node 양쪽에서 쓴다.
 *
 * buildScene(data, opts) 가 지도 한 장을 도형/선/글자 목록(scene)으로 만들고,
 * toSVG(scene) 이 그것을 SVG 문자열로 만든다. PPTX 내보내기도 같은 scene 을 쓴다.
 * 좌표: data 의 정수 좌표(EPSG:5179, 10m 격자, y 아래로 증가) → scene 의 px 좌표.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LEVEL_ORDER = { sido: 0, si: 1, sgg: 2, emd: 3 };
  const LEVEL_NAME = { sido: "시도", si: "시군구", sgg: "시군구(일반구)", emd: "읍면동" };
  const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif";

  const SIDO_SHORT = {
    서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주",
    대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원특별자치도: "강원",
    강원도: "강원", 충청북도: "충북", 충청남도: "충남", 전북특별자치도: "전북", 전라북도: "전북",
    전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주", 전남광주통합특별시: "전남광주",
  };
  function sidoShort(nm) {
    return SIDO_SHORT[nm] || nm.replace(/(특별자치시|특별자치도|통합특별시|특별시|광역시|도)$/, "");
  }

  const DEFAULT_COLORS = {
    target: "#3361E0",
    neighbor: "#C9D6F6",
    context: "#EDF0F4",
    line: "#FFFFFF",
    sidoLine: "#9AA6B5",
    text: "#1E2633",
    bg: null,
  };
  // 이웃끼리 겹치지 않게 칠할 부드러운 색 (PPT 배경 위에서 무난한 톤)
  const DISTINCT = ["#F7C6B3", "#F8DFA0", "#C9E5AE", "#A8DCD1", "#B6CCF4", "#D3C4EF", "#F2BFD5", "#E3D1B5", "#BADDEB", "#F1CDA6"];

  function decode(f) {
    if (!f._p) {
      f._p = f.g.map((poly) =>
        poly.map((r) => {
          const pts = new Array(r.length / 2);
          let x = r[0], y = r[1];
          pts[0] = [x, y];
          for (let i = 2, k = 1; i < r.length; i += 2, k++) {
            x += r[i];
            y += r[i + 1];
            pts[k] = [x, y];
          }
          return pts;
        })
      );
    }
    return f._p;
  }

  /** a 가 b 를 포함하거나 같으면 true (lv 는 sido/si/sgg/emd). */
  function contains(D, aLv, aId, bLv, bId) {
    if (aLv === bLv) return aId === bId;
    if (LEVEL_ORDER[aLv] > LEVEL_ORDER[bLv]) return false;
    const b = D[bLv][bId];
    if (aLv === "sido") return b.sido === aId;
    if (aLv === "si") return b.si === aId;
    if (aLv === "sgg") return bLv === "emd" && b.sgg === aId;
    return false;
  }

  function bbUnion(a, b) {
    return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice();
  }
  function bbHit(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  /** 대상 주변 지역 목록 (depth 1: 맞닿은 곳, depth 2: 그 바깥 한 겹 더). */
  function neighborsOf(D, lv, id, nbLv, depth) {
    if (!depth || !nbLv) return [];
    const t1 = D.nb[`${lv}>${nbLv}`];
    if (!t1) return [];
    const ring1 = t1[id] || [];
    const seen = new Set(ring1);
    const out = ring1.map((c) => ({ id: c, ring: 1 }));
    if (depth >= 2) {
      const same = D.nb[`${nbLv}>${nbLv}`];
      for (const c of ring1) {
        for (const n of same[c] || []) {
          if (seen.has(n) || contains(D, lv, id, nbLv, n) || contains(D, nbLv, n, lv, id)) continue;
          seen.add(n);
          out.push({ id: n, ring: 2 });
        }
      }
    }
    return out;
  }

  function featuresInside(D, lv, id, innerLv) {
    const out = [];
    for (const k in D[innerLv]) if (contains(D, lv, id, innerLv, k)) out.push(k);
    return out;
  }

  // ---- 색 계산 ----
  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(h) {
    const [r, g, b] = hexRgb(h).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function mix(h, toward, t) {
    const a = hexRgb(h), b = hexRgb(toward);
    return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  function textOn(fill, dark) {
    return luminance(fill) < 0.32 ? "#FFFFFF" : dark;
  }

  // ---- 사각형 자르기 ----
  function clipRing(pts, x0, y0, x1, y1) {
    const edges = [
      (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1,
    ];
    const cut = [
      (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
      (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
      (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
      (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
    ];
    let out = pts;
    for (let e = 0; e < 4 && out.length; e++) {
      const inp = out;
      out = [];
      for (let i = 0; i < inp.length; i++) {
        const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        const ci = edges[e](cur), pi = edges[e](prev);
        if (ci) {
          if (!pi) out.push(cut[e](prev, cur));
          out.push(cur);
        } else if (pi) out.push(cut[e](prev, cur));
      }
    }
    return out.length >= 3 ? out : null;
  }
  /** 닫힌 고리를 사각형 안쪽 선분들(열린 polyline 목록)로 자른다. */
  function clipOutline(pts, x0, y0, x1, y1) {
    const lines = [];
    let cur = null;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const P = [-dx, dx, -dy, dy], Q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        if (P[k] === 0) {
          if (Q[k] < 0) { ok = false; break; }
        } else {
          const r = Q[k] / P[k];
          if (P[k] < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
          else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
        }
      }
      if (!ok) { cur = null; continue; }
      const pa = [a[0] + t0 * dx, a[1] + t0 * dy], pb = [a[0] + t1 * dx, a[1] + t1 * dy];
      if (!cur || t0 > 0) {
        cur = [pa];
        lines.push(cur);
      }
      cur.push(pb);
      if (t1 < 1) cur = null;
    }
    // 고리 시작점이 안쪽이면 처음과 끝 조각을 잇는다
    if (lines.length > 1) {
      const first = lines[0], last = lines[lines.length - 1];
      const lp = last[last.length - 1], fp = first[0];
      if (lp[0] === fp[0] && lp[1] === fp[1]) {
        lines[0] = last.concat(first.slice(1));
        lines.pop();
      }
    }
    return lines;
  }

  /**
   * 17개 시도 보기 켜기/끄기. 통합특별시를 광주·전남으로 나눈 시도 경계, 인접표,
   * 소속 시도와 전체 이름을 바꿔 끼운다 (데이터에 *17 필드가 있을 때만).
   * 읍면동을 나중에 불러왔으면 다시 불러 주면 된다.
   */
  function useSido17(D, on) {
    if (!D.sido17) return false;
    if (!D._s16) { D._s16 = D.sido; D._nb16 = {}; }
    if (on) {
      const s = {};
      for (const k in D._s16) if (k !== D.meta.merged) s[k] = D._s16[k];
      D.sido = Object.assign(s, D.sido17);
    } else D.sido = D._s16;
    for (const k in D.nb17 || {}) {
      if (!(k in D._nb16)) D._nb16[k] = D.nb[k];
      D.nb[k] = on ? D.nb17[k] : D._nb16[k];
    }
    for (const lv of ["si", "sgg", "emd"]) {
      const L = D[lv];
      if (!L) continue;
      for (const id in L) {
        const f = L[id];
        if (!f.sido17) continue;
        if (f._s16 === undefined) { f._s16 = f.sido; f._full16 = f.full; }
        f.sido = on ? f.sido17 : f._s16;
        f.full = on ? f.full17 : f._full16;
      }
    }
    D.split = !!on;
    return true;
  }

  /**
   * 지도 한 장의 scene 을 만든다.
   * opts.target   {lv,id} | null(전국)
   * opts.nbLevel  주변 지역 단위: sido|si|sgg|emd
   * opts.depth    0(주변 없음) | 1 | 2
   * opts.inner    대상 내부 구분 단위 (없으면 null). 전국 모드에서는 그릴 단위
   * opts.pick     {lv, ids, fit, hideOthers} — 직접 고른 지역만 강조 (target 대신)
   * opts.context  보이는 범위의 나머지 지역을 흐리게 그림
   * opts.sidoLines 시도 경계를 진하게 덧그림
   * opts.labelMode "all"(자동 배치) | "none" | "pick"(labelPick 에 든 "lv:id" 만)
   * opts.labels   {target, neighbor, inner} — "all" 일 때 종류별로 끄기
   * opts.subLabel 다른 시도·소속 시 이름을 작은 글씨로
   * opts.distinct 주변(또는 고른) 지역을 서로 다른 색으로
   * opts.aspect   null(자동) | 가로/세로 비율 숫자
   * opts.width    출력 너비(px)
   */
  function buildScene(D, opts) {
    const o = Object.assign(
      {
        target: null, nbLevel: "si", depth: 1, inner: null, pick: null, context: true, sidoLines: true,
        labelMode: "all", labelPick: null,
        labels: { target: true, neighbor: true, inner: true }, subLabel: true, distinct: false,
        aspect: null, width: 1600, pad: 0.06, fontScale: 1, halo: false, highlight: [], shortSido: false,
      },
      opts
    );
    const C = Object.assign({}, DEFAULT_COLORS, o.colors || {});
    const P = o.pick;
    const T = !P && o.target && D[o.target.lv][o.target.id];
    const scene = { polys: [], lines: [], texts: [], width: 0, height: 0, bg: C.bg, title: "" };

    // 1) 무엇을 그릴지
    let nbs = [], innerIds = [], bb = null, allIds = [], allLv = null, picked = [];
    const national = () => { for (const k of Object.keys(D.sido)) bb = bbUnion(bb, D.sido[k].bb); };
    if (P) {
      picked = (P.ids || []).filter((k) => D[P.lv][k]);
      if (P.fit && picked.length) for (const k of picked) bb = bbUnion(bb, D[P.lv][k].bb);
      else national();
      scene.title = !picked.length
        ? `전국 ${LEVEL_NAME[P.lv]}`
        : picked.length <= 3
          ? picked.map((k) => D[P.lv][k].full).join(", ")
          : `${D[P.lv][picked[0]].full} 외 ${picked.length - 1}곳`;
    } else if (T) {
      nbs = neighborsOf(D, o.target.lv, o.target.id, o.nbLevel, o.depth);
      bb = T.bb.slice();
      for (const n of nbs) bb = bbUnion(bb, D[o.nbLevel][n.id].bb);
      if (o.inner && LEVEL_ORDER[o.inner] > LEVEL_ORDER[o.target.lv] && D[o.inner])
        innerIds = featuresInside(D, o.target.lv, o.target.id, o.inner);
      scene.title = T.full + (nbs.length ? " 주변" : "");
    } else {
      allLv = o.inner && D[o.inner] ? o.inner : "sido";
      allIds = Object.keys(D[allLv]);
      national();
      scene.title = `전국 ${LEVEL_NAME[allLv]}`;
    }

    // 2) 보기 범위 (여백 + 비율)
    let [x0, y0, x1, y1] = bb;
    let w = x1 - x0, h = y1 - y0;
    const padU = Math.max(w, h) * o.pad;
    x0 -= padU; y0 -= padU; x1 += padU; y1 += padU;
    w = x1 - x0; h = y1 - y0;
    if (o.aspect) {
      if (w / h < o.aspect) { const nw = h * o.aspect; x0 -= (nw - w) / 2; x1 = x0 + nw; w = nw; }
      else { const nh = w / o.aspect; y0 -= (nh - h) / 2; y1 = y0 + nh; h = nh; }
    }
    const W = o.width, s = W / w, H = Math.round(h * s);
    scene.width = W;
    scene.height = H;
    const view = [x0, y0, x1, y1];
    const tf = (p) => [(p[0] - x0) * s, (p[1] - y0) * s];
    const minStep = 0.35; // px — 이보다 가까운 점은 생략
    const project = (f) =>
      decode(f).map((poly) =>
        poly.map((ring) => {
          const out = [];
          let last = null;
          for (const p of ring) {
            const q = tf(p);
            if (last && Math.abs(q[0] - last[0]) < minStep && Math.abs(q[1] - last[1]) < minStep) continue;
            out.push(q);
            last = q;
          }
          return out;
        }).filter((r) => r.length >= 3)
      ).filter((p) => p.length);
    // 화면에서 점처럼 보이는 아주 작은 섬은 뺀다 (가장 큰 덩어리는 항상 남김)
    const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
    const minArea = 3 * (W / 1600) * (W / 1600);
    const projectClean = (f) => {
      const polys = project(f);
      if (polys.length < 2) return polys;
      const areas = polys.map((p) => ringArea(p[0]));
      const big = areas.indexOf(Math.max(...areas));
      return polys.filter((p, i) => i === big || areas[i] >= minArea);
    };

    const base = (W / 1600) * (o.lineScale || 1);
    const add = (lv, id, f, fill, stroke, width, group, extra) => {
      const rings = projectClean(f);
      if (rings.length) scene.polys.push(Object.assign({ lv, id, name: f.full, rings, fill, stroke, width, group }, extra));
    };
    // 흐린 배경 지역: 화면 사각형으로 잘라서 채움과 경계선을 따로 둔다
    const addContext = (lv, k, f) => {
      const rings = [];
      const outl = [];
      for (const poly of projectClean(f)) {
        const cp = poly.map((r) => clipRing(r, 0, 0, W, H)).filter(Boolean);
        if (cp.length) rings.push(cp);
        for (const r of poly) outl.push(...clipOutline(r, 0, 0, W, H));
      }
      if (rings.length) scene.polys.push({ lv, id: k, name: f.full, rings, fill: C.context, stroke: null, width: 0, group: "context" });
      if (outl.length) scene.lines.push({ lines: outl, stroke: C.line, width: base * 1.2, group: "context" });
    };
    // 이웃끼리 다른 색 (greedy)
    const distinctColors = (lv, ids) => {
      const assigned = {};
      const same = D.nb[`${lv}>${lv}`] || {};
      for (const id of ids) {
        const used = new Set((same[id] || []).map((m) => assigned[m]).filter(Boolean));
        assigned[id] = DISTINCT.find((c) => !used.has(c)) || DISTINCT[0];
      }
      return assigned;
    };

    if (P) {
      // 3') 직접 고른 지역
      const sel = new Set(picked);
      if (!P.hideOthers) {
        for (const k in D[P.lv]) {
          const f = D[P.lv][k];
          if (!sel.has(k) && bbHit(f.bb, view)) addContext(P.lv, k, f);
        }
      }
      const colors = o.distinct ? distinctColors(P.lv, picked) : null;
      for (const k of picked) add(P.lv, k, D[P.lv][k], colors ? colors[k] : C.target, C.line, base * 1.4, "picked");
    } else if (T) {
      // 3) 흐린 배경 지역
      const ctxLv = o.nbLevel || "si";
      const nbSet = new Set(nbs.map((n) => n.id));
      if (o.context && D[ctxLv]) {
        for (const k in D[ctxLv]) {
          const f = D[ctxLv][k];
          if (!bbHit(f.bb, view) || nbSet.has(k)) continue;
          if (contains(D, o.target.lv, o.target.id, ctxLv, k)) continue;
          addContext(ctxLv, k, f);
        }
      }
      // 4) 주변 지역
      const colors = o.distinct ? distinctColors(o.nbLevel, nbs.map((n) => n.id)) : null;
      for (const n of nbs) {
        let fill = colors ? colors[n.id] : C.neighbor;
        if (n.ring === 2 && !colors) fill = mix(fill, "#FFFFFF", 0.55);
        add(o.nbLevel, n.id, D[o.nbLevel][n.id], fill, C.line, base * 1.6, "neighbor", { ring: n.ring });
      }
      // 5) 대상 (내부 구분이 있으면 하위 지역들로)
      if (innerIds.length) {
        innerIds.forEach((k) => add(o.inner, k, D[o.inner][k], C.target, mix(C.target, "#FFFFFF", 0.55), base * 1.0, "inner"));
        const outline = [];
        for (const poly of project(T)) outline.push(...poly.map((r) => r.concat([r[0]])));
        scene.lines.push({ lines: outline, stroke: C.line, width: base * 2.4, group: "target" });
      } else {
        add(o.target.lv, o.target.id, T, C.target, C.line, base * 2.0, "target");
      }
    } else {
      const hl = new Set(o.highlight || []);
      const colors = o.distinct ? distinctColors(allLv, allIds) : null;
      for (const k of allIds) {
        const f = D[allLv][k];
        const fill = hl.has(k) ? C.target : colors ? colors[k] : C.neighbor;
        add(allLv, k, f, fill, C.line, base * (allLv === "emd" ? 0.5 : 1.0), hl.has(k) ? "target" : "all");
      }
    }

    // 대상(또는 고른 지역)을 살짝 띄우는 그림자 — 같은 모양을 아래에 한 번 더 깔고 흐린다
    if (o.shadow) {
      const lifted = T && innerIds.length
        ? [{ lv: o.target.lv, id: o.target.id, name: T.full, rings: projectClean(T) }]
        : scene.polys.filter((p) => p.group === "target" || p.group === "picked");
      for (const p of lifted) scene.polys.push({ lv: p.lv, id: p.id, name: p.name, rings: p.rings, fill: C.target, stroke: null, width: 0, group: "shadow" });
      scene.shadow = { dy: base * 3, blur: base * 7, color: C.shadow || "#0B1A33", opacity: C.bg && luminance(C.bg) < 0.2 ? 0.55 : 0.28 };
    }

    // 6) 시도 경계 덧그리기
    const fineLv = P ? P.lv : T ? (LEVEL_ORDER[o.nbLevel] > 0 || innerIds.length ? o.nbLevel : null) : allLv;
    if (o.sidoLines && fineLv && fineLv !== "sido") {
      const lines = [];
      for (const k in D.sido) {
        const f = D.sido[k];
        if (!bbHit(f.bb, view)) continue;
        for (const poly of project(f)) for (const r of poly) lines.push(...clipOutline(r, 0, 0, W, H));
      }
      scene.lines.push({ lines, stroke: C.sidoLine, width: base * 1.7, group: "sido" });
    }

    // 7) 글자
    const fs = (W / 1600) * 32 * o.fontScale;
    // 넓은 지도(전국 등)에서는 시도 이름을 줄여 쓴다: 충청남도 → 충남
    const shortSido = o.shortSido === "auto" ? (x1 - x0) * 10 > 250000 : !!o.shortSido;
    const placed = [];
    const overlaps = (b) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    const textW = (t, size) => [...t].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 1 : 0.58), 0) * size;
    const homeSido = T ? T.sido : P && picked.length ? D[P.lv][picked[0]].sido : null;
    const label = (lv, id, fill, size, weight, force) => {
      const f = D[lv][id];
      const p = tf(f.lp);
      if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return;
      let sub = [];
      if (o.subLabel) {
        if (lv === "sgg" && f.city) sub.push(f.city);
        const sShort = sidoShort(D.sido[f.sido].nm);
        if (homeSido && f.sido !== homeSido && lv !== "sido" && !f.nm.startsWith(sShort)) sub.push(sShort);
      }
      const main = lv === "sido" && shortSido ? sidoShort(f.nm) : f.nm;
      const subTxt = sub.join(" · ");
      const ss = size * 0.64;
      const tw = Math.max(textW(main, size), subTxt ? textW(subTxt, ss) : 0);
      const th = size + (subTxt ? ss * 1.15 : 0);
      if (!force) {
        const fw = (f.bb[2] - f.bb[0]) * s, fh = (f.bb[3] - f.bb[1]) * s;
        if (tw > fw * 1.05 || size > fh * 0.9) return;
      }
      const box = [p[0] - tw / 2 - 2, p[1] - th / 2 - 2, p[0] + tw / 2 + 2, p[1] + th / 2 + 2];
      if (!force && overlaps(box)) return;
      placed.push(box);
      const color = textOn(fill, C.text);
      const y0t = p[1] - th / 2;
      scene.texts.push({ lv, id, x: p[0], y: y0t + size * 0.5, text: main, size, weight, fill: color, halo: o.halo });
      if (subTxt) scene.texts.push({ lv, id, x: p[0], y: y0t + size + ss * 0.7, text: subTxt, size: ss, weight: 500, fill: mix(color, fill, 0.38), halo: o.halo, sub: true });
    };
    const style = (p) => {
      switch (p.group) {
        case "target": return [fs * 1.3, 700];
        case "neighbor": return [fs * (p.ring === 2 ? 0.82 : 1.0), 600];
        case "picked": return [fs * (p.lv === "sido" ? 1.0 : p.lv === "emd" ? 0.6 : 0.85), 600];
        case "all": return [allLv === "sido" ? fs * 0.9 : allLv === "emd" ? fs * 0.3 : fs * 0.45, allLv === "sido" ? 700 : 500];
        default: return [fs * 0.8, 500];
      }
    };
    const byArea = (a, b) => D[b.lv][b.id].a - D[a.lv][a.id].a;
    if (o.labelMode === "pick") {
      const want = o.labelPick || new Set();
      const seen = new Set();
      for (const p of scene.polys) {
        const key = p.lv + ":" + p.id;
        if (!want.has(key) || seen.has(key)) continue;
        seen.add(key);
        const [size, weight] = style(p);
        label(p.lv, p.id, p.fill, size, weight, true);
      }
    } else if (o.labelMode !== "none") {
      const of = (g) => scene.polys.filter((p) => p.group === g);
      for (const p of of("target")) if (o.labels.target && T) label(p.lv, p.id, p.fill, ...style(p), true);
      if (o.labels.neighbor) for (const p of of("neighbor")) label(p.lv, p.id, p.fill, ...style(p), false);
      if (o.labels.inner) for (const p of of("inner").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), false);
      for (const p of of("picked").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), p.lv === "sido");
      if (o.labels.inner !== false && allLv !== "emd")
        for (const p of of("all").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), allLv === "sido");
    }
    return scene;
  }

  // ---- SVG ----
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = (v) => (Math.round(v * 10) / 10).toString();
  function ringD(r, close) {
    let d = "M" + num(r[0][0]) + " " + num(r[0][1]);
    for (let i = 1; i < r.length; i++) d += (i === 1 ? "L" : " ") + num(r[i][0]) + " " + num(r[i][1]);
    return close ? d + "Z" : d;
  }
  function polyD(rings) {
    return rings.map((poly) => poly.map((r) => ringD(r, true)).join("")).join("");
  }
  function safeId(t, used) {
    let id = String(t).replace(/[\s.·]+/g, "_").replace(/[^\wㄱ-힣_-]/g, "");
    if (!/^[A-Za-z_ㄱ-힣]/.test(id)) id = "_" + id;
    let k = id, i = 2;
    while (used.has(k)) k = `${id}_${i++}`;
    used.add(k);
    return k;
  }

  const GROUPS = [
    ["context", "배경"], ["all", "지역"], ["neighbor", "주변"], ["shadow", "그림자"], ["picked", "선택"], ["inner", "대상_내부"], ["target", "대상"], ["sido", "시도경계"],
  ];

  function toSVG(scene, opt) {
    opt = opt || {};
    const used = new Set();
    const W = scene.width, H = scene.height;
    const out = [];
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">`
    );
    out.push(`<title>${esc(scene.title)}</title>`);
    if (scene.shadow) {
      const sh = scene.shadow;
      out.push(
        `<defs><filter id="liftShadow" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB">` +
          `<feDropShadow dx="0" dy="${num(sh.dy)}" stdDeviation="${num(sh.blur)}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/></filter></defs>`
      );
    }
    if (scene.bg) out.push(`<rect id="바탕" x="0" y="0" width="${W}" height="${H}" fill="${scene.bg}"/>`);
    for (const [g, gname] of GROUPS) {
      const ps = scene.polys.filter((p) => p.group === g);
      const ls = scene.lines.filter((l) => l.group === g);
      if (!ps.length && !ls.length) continue;
      out.push(g === "shadow" ? `<g id="${gname}" filter="url(#liftShadow)">` : `<g id="${gname}">`);
      for (const p of ps) {
        if (g === "shadow") { out.push(`<path d="${polyD(p.rings)}" fill="${p.fill}"/>`); continue; }
        const attrs = opt.interactive ? ` data-lv="${p.lv}" data-id="${p.id}"` : "";
        const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}" stroke-linejoin="round"` : "";
        const id = g === "context" ? "" : ` id="${safeId(p.name, used)}"`;
        out.push(
          `<path${id}${attrs} d="${polyD(p.rings)}" fill="${p.fill}" fill-rule="evenodd"${stroke}>` +
            (g === "context" && !opt.interactive ? "" : `<title>${esc(p.name)}</title>`) +
            `</path>`
        );
      }
      for (const l of ls) {
        const d = l.lines.map((r) => ringD(r, false)).join("");
        if (d) out.push(`<path d="${d}" fill="none" stroke="${l.stroke}" stroke-width="${num(l.width)}" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
      out.push(`</g>`);
    }
    if (scene.texts.length) {
      out.push(`<g id="지명" text-anchor="middle">`);
      for (const t of scene.texts) {
        const common = `x="${num(t.x)}" y="${num(t.y + t.size * 0.36)}" font-size="${num(t.size)}" font-weight="${t.weight}"`;
        if (t.halo)
          out.push(`<text ${common} fill="none" stroke="#FFFFFF" stroke-width="${num(t.size * 0.22)}" stroke-linejoin="round">${esc(t.text)}</text>`);
        out.push(`<text ${common} fill="${t.fill}">${esc(t.text)}</text>`);
      }
      out.push(`</g>`);
    }
    out.push(`</svg>`);
    return out.join("\n");
  }

  return { buildScene, toSVG, useSido17, neighborsOf, featuresInside, contains, decode, sidoShort, DEFAULT_COLORS, DISTINCT, LEVEL_NAME, LEVEL_ORDER, FONT };
});
