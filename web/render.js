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

  // ---- 타일 지도: 지역 하나를 같은 크기 칸(네모·육각) 하나에 놓는다 ----
  // 칸 후보를 실제 위치 주변에 깔고, 헝가리안 할당으로 전체 이동 거리(제곱합)가 가장 작게 배정한다 (R geogrid 와 같은 방식).
  function hungarian(cost, n, m) {
    const INF = 1e300;
    const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
    const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    const minv = new Float64Array(m + 1), used = new Uint8Array(m + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      minv.fill(INF);
      used.fill(0);
      do {
        used[j0] = 1;
        const i0 = p[j0], row = (i0 - 1) * m;
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = cost[row + j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Int32Array(n);
    for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
    return ans;
  }
  const TILE_MAX = 600;
  // 전국 시도 타일은 알아보기 쉬운 고정 배치를 쓴다 [열, 행] (16개·17개 모두)
  const SIDO_TILES = {
    11: [1, 0], 51: [2, 0],
    28: [0, 1], 41: [1, 1], 43: [2, 1], 47: [3, 1],
    44: [0, 2], 36: [1, 2], 30: [2, 2], 27: [3, 2],
    52: [0, 3], 29: [1, 3], 12: [1, 3], 48: [2, 3], 31: [3, 3],
    46: [1, 4], 26: [3, 4],
    50: [0, 5],
  };
  const tileCache = new Map();
  function tileLayout(D, items, shape) {
    const key = shape + "|" + items.map((i) => i.lv + ":" + i.id).join(",");
    if (tileCache.has(key)) return tileCache.get(key);
    const n = items.length;
    const hex = shape === "hex";
    const feats = items.map((i) => D[i.lv][i.id]);
    if (items.every((i) => i.lv === "sido" && SIDO_TILES[i.id]) && n === Object.keys(D.sido).length) {
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const f of feats) { x0 = Math.min(x0, f.bb[0]); x1 = Math.max(x1, f.bb[2]); y0 = Math.min(y0, f.bb[1]); y1 = Math.max(y1, f.bb[3]); }
      const c = (y1 - y0) / 6.2, rowH = hex ? (c * Math.sqrt(3)) / 2 : c;
      const ox = (x0 + x1) / 2 - 2 * c + c / 2;
      const out = { c, hex, cells: {} };
      items.forEach((it) => {
        const [col, row] = SIDO_TILES[it.id];
        out.cells[it.lv + ":" + it.id] = [ox + (col + (hex && row & 1 ? 0.5 : 0)) * c, y0 + c / 2 + row * rowH];
      });
      tileCache.set(key, out);
      return out;
    }
    const pts = feats.map((f) => f.lp);
    // 칸 후보 = 실제 경계 안에 중심이 들어가는 격자 칸. 칸 크기는 안쪽 칸 수가 지역 수보다 조금 많아지는 가장 큰 값으로 고른다.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const f of feats) { bx0 = Math.min(bx0, f.bb[0]); by0 = Math.min(by0, f.bb[1]); bx1 = Math.max(bx1, f.bb[2]); by1 = Math.max(by1, f.bb[3]); }
    const pip = (rings, x, y) => {
      let inside = false;
      for (const poly of rings)
        for (const r of poly)
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [xi, yi] = r[i], [xj, yj] = r[j];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
      return inside;
    };
    const inShape = (x, y) => feats.some((f) => x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3] && pip(decode(f), x, y));
    const cellsFor = (c) => {
      const rowH = hex ? (c * Math.sqrt(3)) / 2 : c;
      const out = [];
      for (let j = 0, y = by0 + rowH / 2; y <= by1; j++, y += rowH)
        for (let x = bx0 + c / 2 + (hex && j & 1 ? c / 2 : 0); x <= bx1; x += c) if (inShape(x, y)) out.push([x, y]);
      return out;
    };
    const need = Math.ceil(n * 1.04);
    let lo = Math.sqrt(((bx1 - bx0) * (by1 - by0)) / n) / 8, hi = Math.sqrt(((bx1 - bx0) * (by1 - by0)) / n) * 1.2;
    let list = cellsFor(lo), c = lo;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2, got = cellsFor(mid);
      if (got.length >= need) { lo = mid; list = got; c = mid; } else hi = mid;
    }
    const m = list.length;
    if (m < n) return null;
    const cost = new Float64Array(n * m);
    for (let a = 0; a < n; a++) {
      const p = pts[a];
      for (let b = 0; b < m; b++) cost[a * m + b] = (list[b][0] - p[0]) ** 2 + (list[b][1] - p[1]) ** 2;
    }
    const asg = hungarian(cost, n, m);
    const out = { c, hex, cells: {} };
    items.forEach((it, a) => { out.cells[it.lv + ":" + it.id] = list[asg[a]]; });
    tileCache.set(key, out);
    if (tileCache.size > 40) tileCache.delete(tileCache.keys().next().value);
    return out;
  }
  function tileRing(L, key, gap) {
    const [cx, cy] = L.cells[key];
    if (!L.hex) {
      const h = (L.c / 2) * (1 - gap);
      return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
    }
    const r = (L.c / Math.sqrt(3)) * (1 - gap);
    const out = [];
    for (let k = 0; k < 6; k++) {
      const a = ((-90 + 60 * k) * Math.PI) / 180;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }
  /** 타일 칸에 넣을 짧은 이름: 시도는 줄임말, 시군구는 끝의 시·군·구를 뗀다 (중구 처럼 두 글자는 그대로) */
  function tileName(lv, f) {
    if (lv === "sido") return sidoShort(f.nm);
    return f.nm.length >= 3 && /[시군구]$/.test(f.nm) ? f.nm.slice(0, -1) : f.nm;
  }

  /**
   * 지도 한 장의 scene 을 만든다.
   * opts.target   {lv,id} | null(전국)
   * opts.nbLevel  주변 지역 단위: sido|si|sgg|emd
   * opts.depth    0(주변 없음) | 1 | 2
   * opts.inner    대상 내부 구분 단위 (없으면 null). 전국 모드에서는 그릴 단위
   * opts.pick     {lv, ids, fit, hideOthers} — 직접 고른 지역만 강조 (target 대신)
   * opts.tiles    null | "square" | "hex" — 타일 지도, opts.tileGap 칸 사이 간격(0~0.4)
   * opts.explode  0~ 조각 벌리기, opts.offsets {"lv:id":[dx,dy]} 손으로 옮긴 위치
   * opts.styles   {"lv:id": {fill, text, hideLabel}}, opts.fills {"lv:id": 색} (데이터·그룹 색)
   * opts.values   {"lv:id": "12.3%"} 이름 아래 값
   * opts.legend   {title, items:[{color,label}], pos:"br"|"bl"|"tr"|"tl"}
   * opts.heading  {title, subtitle, note}
   * opts.context  보이는 범위의 나머지 지역을 흐리게 그림
   * opts.sidoLines 시도 경계를 진하게 덧그림
   * opts.labelMode "all"(자동 배치) | "none" | "pick"(labelPick 에 든 "lv:id" 만)
   * opts.subLabel 다른 시도·소속 시 이름을 작은 글씨로
   * opts.distinct 주변(또는 고른) 지역을 서로 다른 색으로
   * opts.aspect   null(자동) | 가로/세로 비율 숫자, opts.width 출력 너비(px)
   */
  function buildScene(D, opts) {
    const o = Object.assign(
      {
        target: null, nbLevel: "si", depth: 1, inner: null, pick: null, context: true, sidoLines: true,
        labelMode: "all", labelPick: null, tiles: null, tileGap: 0.1,
        labels: { target: true, neighbor: true, inner: true }, subLabel: true, distinct: false,
        aspect: null, width: 1600, pad: 0.06, fontScale: 1, halo: false, highlight: [], shortSido: false,
      },
      opts
    );
    const C = Object.assign({}, DEFAULT_COLORS, o.colors || {});
    const P = o.pick;
    const T = !P && o.target && D[o.target.lv][o.target.id];
    const scene = { polys: [], lines: [], texts: [], width: 0, height: 0, bg: C.bg, title: "" };
    const styles = o.styles || {};
    const fills = o.fills || {};
    const values = o.values || {};
    const moved = o.offsets || {};
    const K = (lv, id) => lv + ":" + id;

    // 1) 무엇을 그릴지
    let nbs = [], innerIds = [], allIds = [], allLv = null, picked = [];
    if (P) {
      picked = (P.ids || []).filter((k) => D[P.lv][k]);
      scene.title = !picked.length
        ? `전국 ${LEVEL_NAME[P.lv]}`
        : picked.length <= 3
          ? picked.map((k) => D[P.lv][k].full).join(", ")
          : `${D[P.lv][picked[0]].full} 외 ${picked.length - 1}곳`;
    } else if (T) {
      nbs = neighborsOf(D, o.target.lv, o.target.id, o.nbLevel, o.depth);
      if (o.inner && LEVEL_ORDER[o.inner] > LEVEL_ORDER[o.target.lv] && D[o.inner])
        innerIds = featuresInside(D, o.target.lv, o.target.id, o.inner);
      scene.title = T.full + (nbs.length ? " 주변" : "");
    } else {
      allLv = o.inner && D[o.inner] ? o.inner : "sido";
      allIds = Object.keys(D[allLv]);
      scene.title = `전국 ${LEVEL_NAME[allLv]}`;
    }

    // 1-a) 타일 지도면 칸 배치를 정한다
    let L = null;
    if (o.tiles) {
      let items;
      // 고른 영역에 맞추거나 나머지를 빼면 고른 지역만으로 타일을 짠다 (예: 충남 시군구 타일)
      if (P) items = ((P.hideOthers || P.fit) && picked.length ? picked : Object.keys(D[P.lv])).map((id) => ({ lv: P.lv, id }));
      else if (T) {
        items = innerIds.length ? innerIds.map((id) => ({ lv: o.inner, id })) : [{ lv: o.target.lv, id: o.target.id }];
        items = items.concat(nbs.map((n) => ({ lv: o.nbLevel, id: n.id })));
      } else items = allIds.map((id) => ({ lv: allLv, id }));
      if (P && items.length > TILE_MAX && picked.length && picked.length <= TILE_MAX) items = picked.map((id) => ({ lv: P.lv, id }));
      if (items.length && items.length <= TILE_MAX) L = tileLayout(D, items, o.tiles);
      if (!L) scene.warning = `지역이 ${items.length}곳이라 타일로 만들기에 너무 많습니다 (최대 ${TILE_MAX}곳).`;
    }
    const inTiles = (lv, id) => !!(L && L.cells[K(lv, id)]);
    const tileHalf = L ? (L.hex ? L.c / Math.sqrt(3) : L.c / 2) : 0;
    const lpOf = (lv, id) => (inTiles(lv, id) ? L.cells[K(lv, id)] : D[lv][id].lp);
    const bbOf = (lv, id) => {
      if (!inTiles(lv, id)) return D[lv][id].bb;
      const [cx, cy] = L.cells[K(lv, id)];
      return [cx - tileHalf, cy - tileHalf, cx + tileHalf, cy + tileHalf];
    };

    // 1-b) 조각 벌리기(explode)와 손으로 옮긴 위치(offsets, 데이터 좌표 단위)
    const ex = L ? 0 : Math.max(0, o.explode || 0);
    let bb = null;
    const union = (lv, ids) => { for (const id of ids) bb = bbUnion(bb, bbOf(lv, id)); };
    const national = () => { for (const k of Object.keys(D.sido)) bb = bbUnion(bb, D.sido[k].bb); };
    if (P) {
      if (P.fit && picked.length) union(P.lv, picked);
      else if (L) union(P.lv, Object.keys(L.cells).map((k) => k.split(":")[1]));
      else national();
    } else if (T) {
      if (innerIds.length && L) union(o.inner, innerIds);
      else bb = bbOf(o.target.lv, o.target.id).slice();
      union(o.nbLevel, nbs.map((n) => n.id));
    } else if (L) union(allLv, allIds);
    else national();
    const center = ex ? (T ? T.lp : [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]) : null;
    const offOf = (lv, id) => {
      const m = moved[K(lv, id)] || [0, 0];
      if (!center) return m;
      const lp = D[lv][id].lp;
      // 대상 안쪽 조각은 서로 가까워서 더 크게 벌린다
      const k = T && innerIds.length && lv === o.inner ? ex * 2.4 : ex;
      return [m[0] + (lp[0] - center[0]) * k, m[1] + (lp[1] - center[1]) * k];
    };
    const shifted = (lv, id) => {
      const b = bbOf(lv, id), d = offOf(lv, id);
      return [b[0] + d[0], b[1] + d[1], b[2] + d[0], b[3] + d[1]];
    };
    const innerMoved = innerIds.some((k) => moved[K(o.inner, k)]);
    if (ex || Object.keys(moved).length) {
      let fit = null;
      if (P) {
        if (!(P.fit && picked.length)) fit = bb;
        for (const k of picked) fit = bbUnion(fit, shifted(P.lv, k));
      } else if (T) {
        if (!innerIds.length) fit = shifted(o.target.lv, o.target.id);
        for (const k of innerIds) fit = bbUnion(fit, shifted(o.inner, k));
        for (const n of nbs) fit = bbUnion(fit, shifted(o.nbLevel, n.id));
      } else for (const k of allIds) fit = bbUnion(fit, shifted(allLv, k));
      if (fit) bb = fit;
    }

    // 2) 보기 범위 (여백 + 제목·출처 자리 + 비율)
    const fs = (o.width / 1600) * 32 * o.fontScale;
    const head = o.heading || {};
    const headPx = (head.title ? fs * 1.55 * 1.5 : 0) + (head.subtitle ? fs * 0.85 * 1.6 : 0) + (head.title || head.subtitle ? fs * 0.8 : 0);
    const footPx = head.note ? fs * 0.55 * 2.6 : 0;
    let [x0, y0, x1, y1] = bb;
    let w = x1 - x0, h = y1 - y0;
    const padU = Math.max(w, h) * o.pad;
    x0 -= padU; y0 -= padU; x1 += padU; y1 += padU;
    w = x1 - x0;
    const s0 = o.width / w;
    y0 -= headPx / s0;
    y1 += footPx / s0;
    h = y1 - y0;
    if (o.aspect) {
      if (w / h < o.aspect) { const nw = h * o.aspect; x0 -= (nw - w) / 2; x1 = x0 + nw; w = nw; }
      else { const nh = w / o.aspect; y0 -= (nh - h) / 2; y1 = y0 + nh; h = nh; }
    }
    const W = o.width, s = W / w, H = Math.round(h * s);
    scene.width = W;
    scene.height = H;
    scene.scale = s; // 데이터 좌표 1 단위 = s px
    scene.tiles = !!L;
    const view = [x0, y0, x1, y1];
    const tf = (p) => [(p[0] - x0) * s, (p[1] - y0) * s];
    // 흐린 배경·시도 경계선은 제목 아래, 출처 위까지만 그린다
    const cy0 = headPx * (s / s0), cy1 = H - footPx * (s / s0);
    const minStep = 0.35; // px — 이보다 가까운 점은 생략
    const ringsOf = (lv, id, f) => (inTiles(lv, id) ? [[tileRing(L, K(lv, id), o.tileGap)]] : decode(f));
    const project = (f, d, lv, id) =>
      ringsOf(lv, id, f).map((poly) =>
        poly.map((ring) => {
          const out = [];
          let last = null;
          for (const p of ring) {
            const q = d ? [(p[0] + d[0] - x0) * s, (p[1] + d[1] - y0) * s] : tf(p);
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
    const projectClean = (f, d, lv, id) => {
      const polys = project(f, d, lv, id);
      if (polys.length < 2) return polys;
      const areas = polys.map((p) => ringArea(p[0]));
      const big = areas.indexOf(Math.max(...areas));
      return polys.filter((p, i) => i === big || areas[i] >= minArea);
    };

    const base = (W / 1600) * (o.lineScale || 1);
    // 데이터·그룹 색을 쓰면 색이 없는 지역은 무채색으로 둬서 칠한 곳이 드러나게 한다
    const anyFill = Object.keys(fills).length > 0;
    const neutral = mix(C.context, C.text, 0.07);
    const add = (lv, id, f, fill, stroke, width, group, extra) => {
      const rings = projectClean(f, offOf(lv, id), lv, id);
      const k = K(lv, id);
      if (anyFill && !fills[k] && /^(picked|all|neighbor|inner)$/.test(group)) fill = neutral;
      if (fills[k] && group !== "context") fill = fills[k];
      if (styles[k] && styles[k].fill) fill = styles[k].fill;
      if (rings.length) scene.polys.push(Object.assign({ lv, id, name: f.full, rings, fill, stroke, width, group }, extra));
    };
    // 흐린 배경 지역: 화면 사각형으로 잘라서 채움과 경계선을 따로 둔다
    const addContext = (lv, k, f) => {
      if (inTiles(lv, k)) return add(lv, k, f, C.context, C.line, base * 1.2, "context");
      const rings = [];
      const outl = [];
      for (const poly of projectClean(f, null, lv, k)) {
        const cp = poly.map((r) => clipRing(r, 0, cy0, W, cy1)).filter(Boolean);
        if (cp.length) rings.push(cp);
        for (const r of poly) outl.push(...clipOutline(r, 0, cy0, W, cy1));
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
      if (!P.hideOthers && !ex) {
        for (const k in D[P.lv]) {
          if (sel.has(k)) continue;
          if (L ? inTiles(P.lv, k) : bbHit(D[P.lv][k].bb, view)) addContext(P.lv, k, D[P.lv][k]);
        }
      }
      const colors = o.distinct ? distinctColors(P.lv, picked) : null;
      for (const k of picked) add(P.lv, k, D[P.lv][k], colors ? colors[k] : C.target, C.line, base * 1.4, "picked");
    } else if (T) {
      // 3) 흐린 배경 지역
      const ctxLv = o.nbLevel || "si";
      const nbSet = new Set(nbs.map((n) => n.id));
      if (o.context && D[ctxLv] && !ex && !L) {
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
        const pieces = ex || innerMoved || L;
        innerIds.forEach((k) => add(o.inner, k, D[o.inner][k], C.target, pieces ? C.line : mix(C.target, "#FFFFFF", 0.55), base * (pieces ? 1.6 : 1.0), "inner"));
        if (!pieces) {
          const outline = [];
          for (const poly of project(T)) outline.push(...poly.map((r) => r.concat([r[0]])));
          scene.lines.push({ lines: outline, stroke: C.line, width: base * 2.4, group: "target" });
        }
      } else {
        add(o.target.lv, o.target.id, T, C.target, C.line, base * 2.0, "target");
      }
    } else {
      const hl = new Set(o.highlight || []);
      const colors = o.distinct ? distinctColors(allLv, allIds) : null;
      for (const k of allIds) {
        const f = D[allLv][k];
        const fill = hl.has(k) ? C.target : colors ? colors[k] : C.neighbor;
        add(allLv, k, f, fill, C.line, base * (allLv === "emd" && !L ? 0.5 : 1.0), hl.has(k) ? "target" : "all");
      }
    }

    // 대상(또는 고른 지역)을 살짝 띄우는 그림자 — 같은 모양을 아래에 한 번 더 깔고 흐린다
    if (o.shadow) {
      const lifted = T && innerIds.length && !ex && !innerMoved && !L
        ? [{ lv: o.target.lv, id: o.target.id, name: T.full, rings: projectClean(T) }]
        : scene.polys.filter((p) => p.group === "target" || p.group === "picked" || p.group === "inner");
      for (const p of lifted) scene.polys.push({ lv: p.lv, id: p.id, name: p.name, rings: p.rings, fill: C.target, stroke: null, width: 0, group: "shadow" });
      scene.shadow = { dy: base * 3, blur: base * 7, color: C.shadow || "#0B1A33", opacity: C.bg && luminance(C.bg) < 0.2 ? 0.55 : 0.28 };
    }

    // 6) 시도 경계: 실제 지도는 시도 경계선을 덧그리고, 타일은 시도가 바뀌는 칸 사이에 선을 긋는다
    const fineLv = P ? P.lv : T ? (LEVEL_ORDER[o.nbLevel] > 0 || innerIds.length ? o.nbLevel : null) : allLv;
    if (o.sidoLines && fineLv && fineLv !== "sido" && !ex) {
      const lines = [];
      if (L) {
        const keys = Object.keys(L.cells).filter((k) => !moved[k]);
        const near = L.c * 1.05, half = L.hex ? L.c / (2 * Math.sqrt(3)) : L.c / 2;
        for (let a = 0; a < keys.length; a++) {
          const [la, ia] = keys[a].split(":"), pa = L.cells[keys[a]], sa = D[la][ia].sido;
          for (let b = a + 1; b < keys.length; b++) {
            const [lb, ib] = keys[b].split(":"), pb = L.cells[keys[b]];
            const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dist = Math.hypot(dx, dy);
            if (dist > near || D[lb][ib].sido === sa) continue;
            const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2, nx = -dy / dist, ny = dx / dist;
            lines.push([tf([mx + nx * half, my + ny * half]), tf([mx - nx * half, my - ny * half])]);
          }
        }
      } else {
        for (const k in D.sido) {
          const f = D.sido[k];
          if (!bbHit(f.bb, view)) continue;
          for (const poly of project(f)) for (const r of poly) lines.push(...clipOutline(r, 0, cy0, W, cy1));
        }
      }
      if (lines.length) scene.lines.push({ lines, stroke: C.sidoLine, width: base * (L ? 3 : 1.7), group: "sido" });
    }

    // 7) 글자
    // 넓은 지도(전국 등)에서는 시도 이름을 줄여 쓴다: 충청남도 → 충남
    const shortSido = o.shortSido === "auto" ? (x1 - x0) * 10 > 250000 : !!o.shortSido;
    const placed = [];
    const overlaps = (b) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    const textW = (t, size) => [...String(t)].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 1 : 0.58), 0) * size;
    const homeSido = T ? T.sido : P && picked.length ? D[P.lv][picked[0]].sido : null;
    const label = (lv, id, fill, size, weight, force) => {
      const f = D[lv][id];
      const st = styles[K(lv, id)] || {};
      if (st.hideLabel) return;
      const d = offOf(lv, id);
      const lp = lpOf(lv, id);
      const p = tf([lp[0] + d[0], lp[1] + d[1]]);
      if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return;
      const tile = inTiles(lv, id);
      let main = st.text || (tile ? tileName(lv, f) : lv === "sido" && shortSido ? sidoShort(f.nm) : f.nm);
      const lines = [];
      const val = values[K(lv, id)];
      const vals = Array.isArray(val) ? val : val != null && val !== "" ? [val] : [];
      vals.forEach((v, i) => lines.push({ text: String(v), k: i ? 0.66 : 0.78, weight: i ? 600 : 700 }));
      if (o.subLabel && !tile) {
        const sub = [];
        if (lv === "sgg" && f.city) sub.push(f.city);
        const sShort = sidoShort(D.sido[f.sido].nm);
        if (homeSido && f.sido !== homeSido && lv !== "sido" && !f.nm.startsWith(sShort)) sub.push(sShort);
        if (sub.length) lines.push({ text: sub.join(" · "), k: 0.64, weight: 500, muted: true });
      }
      if (tile) {
        // 칸 안에 들어가게 글자 크기를 맞춘다
        const room = tileHalf * 2 * s * (1 - o.tileGap) * (L.hex ? 0.8 : 0.86);
        size = Math.min(fs * 1.15, room / Math.max(textW(main, 1), 1.6), room / (1.25 + lines.reduce((a, l) => a + l.k * 1.15, 0)));
        force = true;
      }
      if (st.text) force = true;
      const tw = Math.max(textW(main, size), ...lines.map((l) => textW(l.text, size * l.k)));
      const th = size + lines.reduce((a, l) => a + size * l.k * 1.15, 0);
      if (!force) {
        const fb = bbOf(lv, id), fw = (fb[2] - fb[0]) * s, fh = (fb[3] - fb[1]) * s;
        if (tw > fw * 1.05 || size > fh * 0.9) return;
      }
      const box = [p[0] - tw / 2 - 2, p[1] - th / 2 - 2, p[0] + tw / 2 + 2, p[1] + th / 2 + 2];
      if (!force && overlaps(box)) return;
      placed.push(box);
      const color = textOn(fill, C.text);
      let y = p[1] - th / 2;
      scene.texts.push({ lv, id, x: p[0], y: y + size * 0.5, text: main, size, weight, fill: color, halo: o.halo });
      y += size;
      for (const l of lines) {
        const ls = size * l.k;
        scene.texts.push({ lv, id, x: p[0], y: y + ls * 0.62, text: l.text, size: ls, weight: l.weight, fill: l.muted ? mix(color, fill, 0.38) : color, halo: o.halo, sub: true });
        y += ls * 1.15;
      }
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
        const key = K(p.lv, p.id);
        if (!want.has(key) || seen.has(key) || p.group === "shadow") continue;
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
      if (L) for (const p of of("context")) label(p.lv, p.id, p.fill, ...style(p), true);
      if (o.labels.inner !== false && (allLv !== "emd" || L))
        for (const p of of("all").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), allLv === "sido" || !!L);
    }

    // 7-b) 지점 핀: [{x, y(데이터 좌표), keys:{sido,si,sgg,emd}, label, color}]
    const pins = o.pins || [];
    if (pins.length) {
      const ps = o.pinStyle || {};
      const r = fs * 0.72 * (ps.size || 1);
      const drawn = new Set(scene.polys.filter((p) => p.lv).map((p) => K(p.lv, p.id)));
      const perTile = {};
      const circle = (cx, cy, rr, n) => { const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } return out; };
      for (const pin of pins) {
        const keys = Object.values(pin.keys || {});
        const home = keys.find((k) => drawn.has(k));
        let p;
        if (L) {
          const tk = keys.find((k) => L.cells[k]);
          if (!tk) continue;
          // 타일에서는 그 지역 칸 안에 나란히 놓는다
          const n = (perTile[tk] = (perTile[tk] || 0) + 1) - 1;
          const [kl, ki] = tk.split(":");
          const d = offOf(kl, ki), c = L.cells[tk];
          const ang = n * 2.4, rad = n ? tileHalf * 0.35 * Math.sqrt(n / 6) : 0;
          p = tf([c[0] + d[0] + Math.cos(ang) * rad, c[1] + d[1] + Math.sin(ang) * rad - (n ? 0 : tileHalf * 0.25)]);
        } else {
          const [kl, ki] = home ? home.split(":") : [null, null];
          const d = home ? offOf(kl, ki) : [0, 0];
          p = tf([pin.x + d[0], pin.y + d[1]]);
          // 같은 자리에 겹친 핀(주소로 대략 찾은 핀 등)은 둥글게 펼친다
          const at = Math.round(p[0]) + "," + Math.round(p[1]);
          const n = (perTile[at] = (perTile[at] || 0) + 1) - 1;
          if (n) { const ang = n * 2.4, rad = r * 1.25 * Math.sqrt(n); p = [p[0] + Math.cos(ang) * rad, p[1] + Math.sin(ang) * rad]; }
        }
        if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) continue;
        let ring;
        if (ps.shape === "dot") ring = circle(p[0], p[1], r * 0.75, 24);
        else if (ps.shape === "square") ring = [[p[0] - r * 0.7, p[1] - r * 0.7], [p[0] + r * 0.7, p[1] - r * 0.7], [p[0] + r * 0.7, p[1] + r * 0.7], [p[0] - r * 0.7, p[1] + r * 0.7]];
        else {
          // 물방울 모양 핀: 끝이 정확한 자리를 가리킨다
          // 원 중심은 끝점 위 1.9r, 끝점에서 그은 두 접선 사이로 원의 위쪽을 돈다 (화면 좌표: y 가 아래로 증가)
          const cy = p[1] - r * 1.9, beta = Math.acos(1 / 1.9);
          ring = [[p[0], p[1]]];
          for (let i = 0; i <= 24; i++) {
            const a = Math.PI / 2 + beta + ((2 * Math.PI - 2 * beta) * i) / 24;
            ring.push([p[0] + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
        }
        scene.polys.push({ name: "지점 " + (pin.label || ""), rings: [[ring]], fill: pin.color || ps.color || "#E5484D", stroke: "#FFFFFF", width: base * 1.6, group: "pin" });
        if (ps.shape !== "dot" && ps.shape !== "square") scene.polys.push({ name: "지점 점", rings: [[circle(p[0], p[1] - r * 1.9, r * 0.38, 16)]], fill: "#FFFFFF", stroke: null, width: 0, group: "pin" });
        if (ps.labels !== false && pin.label) {
          const ty = ps.shape === "dot" || ps.shape === "square" ? p[1] : p[1] - r * 1.9;
          scene.texts.push({ x: p[0] + r * 1.15, y: ty, text: pin.label, size: fs * 0.62 * (ps.labelScale || 1), weight: 700, fill: C.text, halo: true, anchor: "start", role: "pin" });
        }
      }
    }

    // 8) 제목 · 부제 · 출처
    const margin = fs * 0.9;
    const muted = mix(C.text, C.bg || "#FFFFFF", 0.4);
    if (head.title || head.subtitle) {
      let y = margin;
      if (head.title) {
        const ts = fs * 1.55;
        scene.texts.push({ x: margin, y: y + ts * 0.5, text: head.title, size: ts, weight: 700, fill: C.text, anchor: "start", role: "heading" });
        y += ts * 1.5;
      }
      if (head.subtitle) {
        const ss = fs * 0.85;
        scene.texts.push({ x: margin, y: y + ss * 0.5, text: head.subtitle, size: ss, weight: 400, fill: muted, anchor: "start", role: "heading" });
      }
    }
    if (head.note) {
      const ns = fs * 0.55;
      scene.texts.push({ x: margin, y: H - margin * 0.6 - ns * 0.5, text: head.note, size: ns, weight: 400, fill: muted, anchor: "start", role: "heading" });
    }

    // 9) 범례
    const lg = o.legend;
    if (lg && lg.items && lg.items.length && lg.pos !== "none") {
      const ls = fs * 0.62, pad = ls * 0.9, row = ls * 1.65, sw = ls * 1.15;
      const tw = Math.max(lg.title ? textW(lg.title, ls * 1.05) : 0, sw + ls * 0.6 + Math.max(...lg.items.map((it) => textW(it.label, ls))));
      const bw = tw + pad * 2, bh = pad * 2 + (lg.title ? ls * 1.05 * 1.7 : 0) + row * lg.items.length - (row - sw);
      const pos = lg.pos || "br";
      const bx = pos[1] === "l" ? margin : W - margin - bw;
      const by = pos[0] === "t" ? margin + headPx : H - margin - bh - footPx;
      const rect = (x, y, rw, rh) => [[[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]]];
      const panel = C.bg && luminance(C.bg) < 0.2 ? mix(C.bg, "#FFFFFF", 0.08) : "#FFFFFF";
      scene.polys.push({ name: "범례", rings: [rect(bx, by, bw, bh)], fill: panel, stroke: mix(panel, C.text, 0.15), width: base * 1.2, group: "legend" });
      let y = by + pad;
      if (lg.title) {
        scene.texts.push({ x: bx + pad, y: y + ls * 0.55, text: lg.title, size: ls * 1.05, weight: 700, fill: C.text, anchor: "start", role: "legend" });
        y += ls * 1.05 * 1.7;
      }
      for (const it of lg.items) {
        scene.polys.push({ name: "범례 " + it.label, rings: [rect(bx + pad, y, sw, sw)], fill: it.color, stroke: null, width: 0, group: "legend" });
        scene.texts.push({ x: bx + pad + sw + ls * 0.6, y: y + sw / 2, text: it.label, size: ls, weight: 500, fill: C.text, anchor: "start", role: "legend" });
        y += row;
      }
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
        const dk = opt.interactive ? ` data-k="${p.lv}:${p.id}"` : "";
        if (g === "shadow") { out.push(`<path${dk} d="${polyD(p.rings)}" fill="${p.fill}"/>`); continue; }
        const attrs = opt.interactive ? ` data-lv="${p.lv}" data-id="${p.id}"${dk}` : "";
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
    const textEl = (t) => {
      const dk = opt.interactive && t.lv ? ` data-k="${t.lv}:${t.id}"` : "";
      const anchor = t.anchor === "start" ? ` text-anchor="start"` : "";
      const common = `${dk}${anchor} x="${num(t.x)}" y="${num(t.y + t.size * 0.36)}" font-size="${num(t.size)}" font-weight="${t.weight}"`;
      const halo = t.halo ? `<text ${common} fill="none" stroke="#FFFFFF" stroke-width="${num(t.size * 0.22)}" stroke-linejoin="round">${esc(t.text)}</text>` : "";
      return halo + `<text ${common} fill="${t.fill}">${esc(t.text)}</text>`;
    };
    const names = scene.texts.filter((t) => !t.role);
    if (names.length) {
      out.push(`<g id="지명" text-anchor="middle"${opt.interactive ? ' pointer-events="none"' : ""}>`);
      for (const t of names) out.push(textEl(t));
      out.push(`</g>`);
    }
    const pinPolys = scene.polys.filter((p) => p.group === "pin");
    const pinTexts = scene.texts.filter((t) => t.role === "pin");
    if (pinPolys.length) {
      out.push(`<g id="지점"${opt.interactive ? ' pointer-events="none"' : ""}>`);
      for (const p of pinPolys) out.push(`<path d="${polyD(p.rings)}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}" stroke-linejoin="round"` : ""}/>`);
      for (const t of pinTexts) out.push(textEl(t));
      out.push(`</g>`);
    }
    const legend = scene.polys.filter((p) => p.group === "legend");
    const legendTexts = scene.texts.filter((t) => t.role === "legend");
    if (legend.length) {
      out.push(`<g id="범례"${opt.interactive ? ' pointer-events="none"' : ""}>`);
      for (const p of legend) {
        const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}"` : "";
        out.push(`<path d="${polyD(p.rings)}" fill="${p.fill}"${stroke}/>`);
      }
      for (const t of legendTexts) out.push(textEl(t));
      out.push(`</g>`);
    }
    const heads = scene.texts.filter((t) => t.role === "heading");
    if (heads.length) {
      out.push(`<g id="제목"${opt.interactive ? ' pointer-events="none"' : ""}>`);
      for (const t of heads) out.push(textEl(t));
      out.push(`</g>`);
    }
    out.push(`</svg>`);
    return out.join("\n");
  }

  return { buildScene, toSVG, useSido17, tileLayout, tileName, neighborsOf, featuresInside, contains, decode, sidoShort, DEFAULT_COLORS, DISTINCT, LEVEL_NAME, LEVEL_ORDER, FONT };
});
