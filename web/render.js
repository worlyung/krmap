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
  // 프리텐다드(Pretendard)가 있으면 그것으로, 없으면 컴퓨터의 한글 글꼴로
  const FONT = "Pretendard,'Pretendard Variable','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR','Noto Sans CJK KR',sans-serif";

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

  // 전국 지도의 확대 상자: 작은 구가 몰린 특별시·광역시. 광주는 통합특별시 안의 다섯 구로 찾는다
  const INSETS = {
    서울: { sido: "11" }, 부산: { sido: "26" }, 대구: { sido: "27" }, 인천: { sido: "28", skip: ["28720"] },
    광주: { sido: "29", si: ["12210", "12240", "12270", "12300", "12330", "29110", "29140", "29155", "29170", "29200"] },
    대전: { sido: "30" }, 울산: { sido: "31" },
  };
  /** 확대 상자에 넣을 지역 id 들 (lv 단위). 옹진군처럼 멀리 떨어진 섬은 뺀다 */
  function insetMembers(D, name, lv) {
    const def = INSETS[name];
    if (!def || !D[lv]) return [];
    let ids = [];
    if (D.sido[def.sido]) ids = featuresInside(D, "sido", def.sido, lv);
    else if (def.si) for (const si of def.si) if (D.si[si]) ids = ids.concat(lv === "si" ? [si] : featuresInside(D, "si", si, lv));
    const skip = new Set(def.skip || []);
    return ids.filter((id) => !skip.has(lv === "si" || lv === "sgg" ? id : D[lv][id].si) && !skip.has(String(D[lv][id].si || "")));
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
  // 칠한 색 위의 글자색: 흰 글자가 3:1 이상 읽히면 흰색, 아니면 진한 글자 (어두운 테마의 밝은 글자색은 쓰지 않는다)
  function textOn(fill, ink) {
    const L = luminance(fill);
    if (1.05 / (L + 0.05) >= 3) return "#FFFFFF";
    return luminance(ink) < 0.3 ? ink : "#1C2330";
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
    const scene = { polys: [], lines: [], texts: [], width: 0, height: 0, bg: o.backdrop ? o.backdrop.mid : C.bg, backdrop: o.backdrop || null, look: o.look || "flat", title: "" };
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
    w = x1 - x0; h = y1 - y0;
    const W = o.width;
    const tw0 = (t, size) => [...String(t)].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 1 : 0.58), 0) * size;
    // 양옆 줄에 반씩: 가로 위치의 가운데값을 기준으로 왼쪽 · 오른쪽을 나눈다
    function splitSides(items, xOf) {
      const order = items.slice().sort((a, b) => xOf(a) - xOf(b));
      const half = Math.ceil(order.length / 2);
      order.forEach((it, i) => (it.left = i < half));
    }
    // 원 크기(버블): 넓이가 값에 비례. 가장 큰 원의 반지름은 그릴 원 개수에 따라 (적으면 크게)
    const bub = o.bubbles && o.bubbles.values && Object.keys(o.bubbles.values).length && o.bubbles.max > 0 && !o.tiles ? o.bubbles : null;
    const bubR = bub ? fs * Math.min(2.8, Math.max(0.9, 8 / Math.sqrt(Object.keys(bub.values).length))) * (bub.scale || 1) : 0;
    const rOf = (v) => bubR * Math.sqrt(Math.max(v, 0) / bub.max);
    // 범례 자리: 지도 옆(왼쪽·오른쪽)에 따로 비워 두어 지역을 가리지 않게 한다 (px)
    const lgItems = (o.legend && o.legend.items) || [];
    const lgSizes = bub && o.legend && o.legend.sizes ? o.legend.sizes : [];
    const lgOn = !!(o.legend && o.legend.pos !== "none" && (lgItems.length || lgSizes.length));
    function legendDims() {
      const ls = fs * 0.62, pad = ls * 0.9, row = ls * 1.65, sw = ls * 1.15;
      const titleH = o.legend.title ? ls * 1.05 * 1.7 : 0;
      const itemsW = lgItems.length ? sw + ls * 0.6 + Math.max(...lgItems.map((it) => tw0(it.label, ls))) : 0;
      const itemsH = lgItems.length ? row * lgItems.length - (row - sw) : 0;
      const rL = lgSizes.length ? rOf(lgSizes[0].value) : 0;
      const sizesW = lgSizes.length ? rL * 2 + ls * 0.9 + Math.max(...lgSizes.map((it) => tw0(it.label, ls))) : 0;
      const sizesH = lgSizes.length ? Math.max(rL * 2, ls * 1.2 * lgSizes.length) : 0;
      const gap = itemsH && sizesH ? ls : 0;
      const tw = Math.max(o.legend.title ? tw0(o.legend.title, ls * 1.05) : 0, itemsW, sizesW);
      return { ls, pad, row, sw, titleH, itemsH, rL, sizesH, gap, bw: tw + pad * 2, bh: pad * 2 + titleH + itemsH + gap + sizesH };
    }
    let room = lgOn ? legendDims().bw + fs * 0.9 * 1.6 : 0;
    // 확대 상자: 전국 지도(시군구·읍면동)에서만, 오른쪽 한 줄(넷 이상이면 두 줄). 범례가 오른쪽이면 같은 줄 아래·위에 둔다
    const insetDefs = !T && !P && !L && allLv && allLv !== "sido" && o.labelPlace !== "side" && Array.isArray(o.insets)
      ? o.insets.filter((n) => INSETS[n]).map((name) => ({ name, ids: insetMembers(D, name, allLv) })).filter((d) => d.ids.length) : [];
    const insetKeys = new Set(insetDefs.flatMap((d) => d.ids.map((id) => K(allLv, id))));
    let insetW = 0, insetRoom = 0;
    const lgRight = lgOn && (o.legend.pos || "br")[1] !== "l";
    if (insetDefs.length) {
      insetW = W * (insetDefs.length > 3 ? 0.3 : 0.2);
      if (lgRight) room = 0; // 범례는 확대 상자 줄 바로 왼쪽, 지도 오른쪽 아래 바다 자리에 둔다
      insetRoom = insetW + fs * 0.9 * 1.4;
    }
    // 이름을 지도 양옆 줄에 모두 빼는 모드 (연합뉴스 인포그래픽처럼): 줄 폭만큼 좌우를 비운다
    const sideSize = fs * 0.7;
    const shortSido0 = o.shortSido === "auto" ? (bb[2] - bb[0]) * 10 > 250000 : !!o.shortSido;
    const sideText = (lv, id) => {
      const f = D[lv][id], st = styles[K(lv, id)] || {};
      const name = st.text || (lv === "sido" && shortSido0 ? sidoShort(f.nm) : f.nm);
      const v = values[K(lv, id)];
      return { name, value: (Array.isArray(v) ? v : v != null && v !== "" ? [v] : []).join(" · ") };
    };
    let sideItems = null, sideL = 0, sideR = 0;
    if (o.labelPlace === "side" && !L && o.labelMode !== "none") {
      let subj = [];
      if (P) subj = picked.map((id) => [P.lv, id]);
      else if (T) subj = innerIds.length ? innerIds.map((id) => [o.inner, id]) : [[o.target.lv, o.target.id]].concat(nbs.map((n) => [o.nbLevel, n.id]));
      else subj = allIds.map((id) => [allLv, id]);
      subj = subj.filter(([lv, id]) => !(styles[K(lv, id)] || {}).hideLabel && (o.labelMode !== "pick" || (o.labelPick && o.labelPick.has(K(lv, id)))));
      if (subj.length && subj.length <= 80) {
        sideItems = subj.map(([lv, id]) => {
          const d = offOf(lv, id), lp = lpOf(lv, id);
          const t = sideText(lv, id);
          const w = tw0(t.name, sideSize) + (t.value ? tw0(t.value, sideSize * 0.9) + sideSize * 0.4 : 0);
          return { lv, id, x: lp[0] + d[0], y: lp[1] + d[1], name: t.name, value: t.value, w };
        });
        splitSides(sideItems, (it) => it.x);
        const gapPx = fs * 2.2;
        const wl = sideItems.filter((it) => it.left).map((it) => it.w), wr = sideItems.filter((it) => !it.left).map((it) => it.w);
        sideL = wl.length ? Math.max(...wl) + gapPx : 0;
        sideR = wr.length ? Math.max(...wr) + gapPx : 0;
      }
    }
    let s = (W - room - sideL - sideR - insetRoom) / w;
    // 제목·출처 자리는 px 로 정해져 있으니, 배율을 정한 다음에 그만큼 위아래로 늘린다
    let H = h * s + headPx + footPx;
    if (o.aspect) {
      const Ht = W / o.aspect;
      if (H > Ht) s = Math.max((Ht - headPx - footPx) / h, 1e-9);
      else { const e = (Ht - H) / 2 / s; y0 -= e; y1 += e; h = y1 - y0; }
      H = Ht;
    }
    // 가로 남는 자리(px): 넉넉하면 지도를 가운데에, 모자라면 범례 쪽에 범례 폭만큼 둔다 (양옆 이름 줄 자리는 먼저 뺀다)
    const slack = W - w * s - sideL - sideR - insetRoom;
    const lgLeft = room && (o.legend.pos || "br")[1] === "l";
    const padL = sideL + (slack >= 2 * room ? slack / 2 : lgLeft ? room : slack - room);
    x0 -= padL / s; x1 = x0 + W / s; w = x1 - x0;
    y0 -= headPx / s; y1 += footPx / s; h = y1 - y0;
    H = Math.round(H);
    scene.width = W;
    scene.height = H;
    scene.scale = s; // 데이터 좌표 1 단위 = s px
    scene.tiles = !!L;
    scene.tileGrid = L;
    const view = [x0, y0, x1, y1];
    const tf = (p) => [(p[0] - x0) * s, (p[1] - y0) * s];
    scene.projectPoint = tf;
    // 흐린 배경·시도 경계선은 제목 아래, 출처 위까지만 그린다
    const cy0 = headPx, cy1 = H - footPx;
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
    const anyFill = Object.keys(fills).length > 0 || !!bub;
    const neutral = mix(C.context, C.text, 0.07);
    const add = (lv, id, f, fill, stroke, width, group, extra) => {
      const rings = projectClean(f, offOf(lv, id), lv, id);
      const k = K(lv, id);
      if (anyFill && !fills[k] && /^(picked|all|neighbor|inner)$/.test(group)) fill = neutral;
      if (bub && !fills[k] && group === "target") fill = mix(C.context, C.text, 0.16); // 원이 주인공이라 대상은 조금 진한 회색으로만
      if (fills[k] && group !== "context") fill = fills[k];
      if (styles[k] && styles[k].fill) fill = styles[k].fill;
      const d=offOf(lv,id),lp=lpOf(lv,id);
      if (rings.length) scene.polys.push(Object.assign({ lv, id, name: f.full, rings, fill, stroke, width, group,regionAnchor:tf([lp[0]+d[0],lp[1]+d[1]]) }, extra));
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
        const keys = Object.keys(L.cells);
        const cell=k=>L.cells[k].map((v,i)=>v+(moved[k]||[0,0])[i]);
        const near = L.c * 1.05, half = L.hex ? L.c / (2 * Math.sqrt(3)) : L.c / 2;
        for (let a = 0; a < keys.length; a++) {
          const [la, ia] = keys[a].split(":"), pa = cell(keys[a]), sa = D[la][ia].sido;
          for (let b = a + 1; b < keys.length; b++) {
            const [lb, ib] = keys[b].split(":"), pb = cell(keys[b]);
            const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dist = Math.hypot(dx, dy);
            if (dist < L.c*.5 || dist > near || D[lb][ib].sido === sa) continue;
            const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2, nx = -dy / dist, ny = dx / dist;
            lines.push([tf([mx + nx * half, my + ny * half]), tf([mx - nx * half, my - ny * half])]);
          }
        }
      } else if (!(T && !o.context) && !(P && P.hideOthers)) {
        // 배경을 숨긴 지도에는 화면 전체의 시도 윤곽을 덧그리지 않는다.
        // 표시된 지역들의 경계는 각 도형의 stroke로 그대로 남는다.
        for (const k in D.sido) {
          const f = D.sido[k];
          if (!bbHit(f.bb, view)) continue;
          for (const poly of project(f)) for (const r of poly) lines.push(...clipOutline(r, 0, cy0, W, cy1));
        }
      }
      if (lines.length) scene.lines.push({ lines, stroke: C.sidoLine, width: base * (L ? 3 : 1.7), group: "sido" });
    }

    // 6-a) 디자인 방식: 유리(반투명 흰 면) · 네온(빛나는 선) · 입체(아래로 두께) · 소프트(빛과 그늘)
    const look = o.look || "flat";
    const focusG = /^(target|picked|inner)$/;
    const regionG = /^(all|neighbor|target|picked|inner)$/;
    const opacityOf = {};
    if (look === "glass") {
      for (const q of scene.polys) {
        if (q.group === "shadow") { q.fillOpacity = 0.18; continue; } // 띄우기 그림자 판도 비치게
        if (!/^(context|all|neighbor|target|picked|inner)$/.test(q.group)) continue;
        const white = String(q.fill).toUpperCase() === "#FFFFFF";
        q.fillOpacity = white ? (q.group === "context" ? 0.07 : focusG.test(q.group) ? 0.42 : 0.17) : 0.8;
        if (q.stroke) { q.stroke = "#FFFFFF"; q.strokeOpacity = 0.6; }
        if (q.lv) opacityOf[K(q.lv, q.id)] = q.fillOpacity;
      }
      for (const l of scene.lines) if (/^(context|sido|target)$/.test(l.group)) { l.stroke = "#FFFFFF"; l.strokeOpacity = l.group === "context" ? 0.22 : 0.65; }
    } else if (look === "neon") {
      for (const q of scene.polys) if (regionG.test(q.group)) { q.glow = true; if (focusG.test(q.group) && q.stroke) { q.stroke = C.glow || C.line; q.width *= 1.4; } }
      for (const l of scene.lines) {
        if (l.group === "sido" || l.group === "target") l.glow = true;
        else if (l.group === "context") l.stroke = mix(C.line, C.bg || "#000000", 0.65); // 바깥 지역 선은 어둡게
      }
      scene.glow = { color: C.glow || C.line, blur: base * 3.5 };
    } else if (look === "paper") {
      const regs = scene.polys.filter((q) => regionG.test(q.group));
      const depth = regs.length > 400 ? [1] : [2, 1];
      const layers = [];
      for (const q of regs) for (const k of depth) layers.push({ name: "입체 " + q.name, rings: q.rings.map((poly) => poly.map((r) => r.map(([x, y]) => [x, y + base * 4.5 * k]))), fill: mix(q.fill, C.text, 0.14 + 0.1 * k), stroke: null, width: 0, group: "extrude" });
      scene.polys.push(...layers);
    } else if (look === "soft") {
      for (const q of scene.polys) if (regionG.test(q.group)) q.soft = true;
      scene.soft = { light: "#FFFFFF", dark: C.softDark || mix(C.bg || "#E8ECF0", "#000000", 0.18), d: base * 4, blur: base * 5 };
    }
    const ground = (o.backdrop && o.backdrop.mid) || C.bg || "#FFFFFF";

    // 6-b) 원 크기(버블): 큰 원부터 깔고 작은 원을 위에
    const bubbleAt = {};
    const ringOf = (c, r, n) => { const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return out; };
    if (bub) {
      const drawnKeys = new Set(scene.polys.filter((q) => q.lv && /^(target|neighbor|inner|picked|all)$/.test(q.group)).map((q) => K(q.lv, q.id)));
      const list = [];
      for (const k in bub.values) {
        if (!drawnKeys.has(k)) continue;
        const [lv, id] = k.split(":");
        const d = offOf(lv, id), lp = lpOf(lv, id);
        const c = tf([lp[0] + d[0], lp[1] + d[1]]);
        const r = rOf(bub.values[k]);
        if (r >= 0.8) list.push({ k, lv, id, c, r });
      }
      list.sort((a, b) => b.r - a.r);
      for (const b of list) {
        scene.polys.push({ lv: b.lv, id: b.id, name: "원 " + D[b.lv][b.id].full, rings: [[ringOf(b.c, b.r, 48)]], circle: { cx: b.c[0], cy: b.c[1], r: b.r }, fill: bub.color, fillOpacity: 0.72, stroke: C.bg || "#FFFFFF", width: base * 1.2, group: "bubble" });
        bubbleAt[b.k] = b;
      }
    }

    // 7) 글자
    // 넓은 지도(전국 등)에서는 시도 이름을 줄여 쓴다: 충청남도 → 충남
    const shortSido = o.shortSido === "auto" ? (x1 - x0) * 10 > 250000 : !!o.shortSido;
    const placed = [];
    const overlaps = (b) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    const textW = (t, size) => [...String(t)].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 1 : 0.58), 0) * size;
    const margin = fs * 0.9;
    const lg = o.legend;
    const lgBox = lgOn ? legendGeom() : null;
    if (lgBox) placed.push([lgBox.bx - 4, lgBox.by - 4, lgBox.bx + lgBox.bw + 4, lgBox.by + lgBox.bh + 4]);
    function legendGeom() {
      const g = legendDims();
      const pos = lg.pos || "br";
      g.bx = pos[1] === "l" ? margin : W - margin - g.bw - (insetDefs.length ? insetW + fs * 0.6 : 0);
      g.by = pos[0] === "t" ? margin + headPx : H - margin - g.bh - footPx;
      return g;
    }
    // 지역 모양(px) — 이름이 모양 안에 실제로 들어가는지 볼 때 쓴다
    let shapeOf = null;
    const insideShape = (lv, id, x, y) => {
      if (!shapeOf) {
        shapeOf = {};
        for (const q of scene.polys) if (q.lv && /^(target|neighbor|inner|picked|all)$/.test(q.group)) (shapeOf[K(q.lv, q.id)] = shapeOf[K(q.lv, q.id)] || []).push(q.rings);
      }
      const list = shapeOf[K(lv, id)];
      if (!list) return true;
      let inside = false;
      for (const rings of list) for (const poly of rings) for (const r of poly) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      return inside;
    };
    // 지역 안에 안 들어가는 이름은 모아 두었다가 바깥에 놓고 지시선으로 잇는다
    const callouts = [];
    const calloutOK = (group) => o.leaders !== false && !L && /^(target|neighbor|inner|picked)$/.test(group);
    const homeSido = T ? T.sido : P && picked.length ? D[P.lv][picked[0]].sido : null;
    const sideKeys = sideItems ? new Set(sideItems.map((it) => K(it.lv, it.id))) : null;
    const label = (lv, id, fill, size, weight, force, group) => {
      if (sideKeys && sideKeys.has(K(lv, id))) return; // 양옆 줄에 따로 쓴다
      if (opacityOf[K(lv, id)] != null) fill = mix(ground, fill, opacityOf[K(lv, id)]); // 반투명 면은 바탕과 섞인 색으로 본다
      if (insetKeys.has(K(lv, id))) return; // 확대 상자 안에 따로 쓴다
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
      vals.forEach((v, i) => lines.push({ text: String(v), k: i ? 0.64 : 0.74, weight: i ? 500 : 600 }));
      if (o.subLabel && !tile) {
        const sub = [];
        if (lv === "sgg" && f.city) sub.push(f.city);
        const sShort = sidoShort(D.sido[f.sido].nm);
        if (homeSido && f.sido !== homeSido && lv !== "sido" && !f.nm.startsWith(sShort)) sub.push(sShort);
        if (sub.length) lines.push({ text: sub.join(" · "), k: 0.6, weight: 500, muted: true });
      }
      if (tile) {
        // 칸 안에 들어가게 글자 크기를 맞춘다
        const room = tileHalf * 2 * s * (1 - o.tileGap) * (L.hex ? 0.8 : 0.86);
        size = Math.min(fs * 1.15, room / Math.max(textW(main, 1), 1.6), room / (1.25 + lines.reduce((a, l) => a + l.k * 1.15, 0)));
        force = true;
      }
      const manual = !!st.text;
      if (manual) force = true;
      const tw = Math.max(textW(main, size), ...lines.map((l) => textW(l.text, size * l.k)));
      const th = size + lines.reduce((a, l) => a + size * l.k * 1.15, 0);
      // 원이 이름보다 작으면 이름을 원 바로 아래에 둔다
      const bb0 = bubbleAt[K(lv, id)];
      if (bb0 && bb0.r * 2 < tw * 0.85) p[1] += bb0.r + th / 2 + 2;
      const box = [p[0] - tw / 2 - 2, p[1] - th / 2 - 2, p[0] + tw / 2 + 2, p[1] + th / 2 + 2];
      let fits = true;
      if (!tile) {
        const fb = bbOf(lv, id), fw = (fb[2] - fb[0]) * s, fh = (fb[3] - fb[1]) * s;
        if (tw > fw * 1.05 || size > fh * 0.9) fits = false;
        else {
          // 네 귀퉁이 가운데 셋 이상과 가운데가 지역 모양 안에 있어야 들어간 것으로 본다
          const ix = tw * 0.42, iy = th * 0.38;
          const corners = [[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]].filter(([dx, dy]) => insideShape(lv, id, p[0] + dx, p[1] + dy)).length;
          if (corners < 3 || !insideShape(lv, id, p[0], p[1])) fits = false;
        }
      }
      if (!manual && (!fits || (!force && overlaps(box)))) {
        if (calloutOK(group)) {
          const prio = group === "target" ? 0 : group === "inner" ? 2 : 1;
          callouts.push({ lv, id, p, main, lines, size: Math.max(size * 0.92, fs * 0.5), weight, prio, area: f.a || 0 });
          return;
        }
        if (!force) return;
      }
      placed.push(box);
      // 큰 원 위에 앉는 이름은 원 색을 기준으로 글자색을 고른다
      const bb = bubbleAt[K(lv, id)];
      const under = bb && bb.r * 2 >= tw * 0.85 ? mix(bub.color, fill, 0.28) : fill;
      const color = textOn(under, C.text);
      fill = under;
      let y = p[1] - th / 2;
      scene.texts.push({ lv, id, x: p[0], y: y + size * 0.5, text: main, size, weight, fill: color, halo: o.halo, track: -0.02 });
      y += size;
      for (const l of lines) {
        const ls = size * l.k;
        scene.texts.push({ lv, id, x: p[0], y: y + ls * 0.62, text: l.text, size: ls, weight: l.weight, fill: l.muted ? mix(color, fill, 0.42) : color, halo: o.halo, track: -0.01, sub: true });
        y += ls * 1.15;
      }
    };
    const style = (p) => {
      switch (p.group) {
        case "target": return [fs * 1.25, 700];
        case "neighbor": return [fs * (p.ring === 2 ? 0.8 : 0.95), 600];
        case "picked": return [fs * (p.lv === "sido" ? 0.95 : p.lv === "emd" ? 0.6 : 0.82), 600];
        case "all": return [allLv === "sido" ? fs * 0.85 : allLv === "emd" ? fs * 0.3 : fs * 0.45, allLv === "sido" ? 700 : 500];
        default: return [fs * 0.78, 500];
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
        label(p.lv, p.id, p.fill, size, weight, true, p.group);
      }
    } else if (o.labelMode !== "none") {
      const of = (g) => scene.polys.filter((p) => p.group === g);
      for (const p of of("target")) if (o.labels.target && T) label(p.lv, p.id, p.fill, ...style(p), true, "target");
      if (o.labels.neighbor) for (const p of of("neighbor")) label(p.lv, p.id, p.fill, ...style(p), false, "neighbor");
      if (o.labels.inner) for (const p of of("inner").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), false, "inner");
      for (const p of of("picked").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), p.lv === "sido", "picked");
      if (L) for (const p of of("context")) label(p.lv, p.id, p.fill, ...style(p), true, "context");
      if (o.labels.inner !== false && (allLv !== "emd" || L))
        for (const p of of("all").sort(byArea)) label(p.lv, p.id, p.fill, ...style(p), allLv === "sido" || !!L, "all");
    }

    // 7-a) 지시선: 안에 못 들어간 이름이 몇 개면 가까운 빈자리에, 많으면 양옆 줄에 세워 선으로 잇는다
    if (callouts.length && callouts.length <= 3) {
      const ink = C.text, paper = C.bg || "#FFFFFF";
      const lineColor = mix(ink, paper, 0.35);
      const segs = [];
      const cx = W / 2, cyM = (cy0 + cy1) / 2;
      // 선분이 상자를 지나는지 (Liang–Barsky)
      const segHitsBox = (a, b, bx) => {
        let t0 = 0, t1 = 1;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const edges = [[-dx, a[0] - bx[0]], [dx, bx[2] - a[0]], [-dy, a[1] - bx[1]], [dy, bx[3] - a[1]]];
        for (const [pp, q] of edges) {
          if (pp === 0) { if (q < 0) return false; continue; }
          const r = q / pp;
          if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
        }
        return t0 < t1;
      };
      const cross = (a, b, c, d) => {
        const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
        const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
        return o1 * o2 < 0 && o3 * o4 < 0;
      };
      const dot = (q, r) => { const out = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; out.push([q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)]); } return out; };
      // 이름표는 되도록 주인공 지역(대상·안쪽·고른 곳) 위가 아니라 빈 바탕에 놓는다
      const shapes = scene.polys.filter((q) => /^(target|inner|picked|neighbor)$/.test(q.group)).map((q) => {
        let b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const poly of q.rings) for (const r of poly) for (const [x, y] of r) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
        return { rings: q.rings, b, main: q.group !== "neighbor" };
      });
      const hit = (x, y) => {
        let res = 0;
        for (const sh of shapes) {
          if (x < sh.b[0] || x > sh.b[2] || y < sh.b[1] || y > sh.b[3]) continue;
          let inside = false;
          for (const poly of sh.rings) for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [xi, yi] = r[i], [xj, yj] = r[j];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) { res = Math.max(res, sh.main ? 2 : 1); if (res === 2) break; }
        }
        return res;
      };
      callouts.sort((a, b) => a.prio - b.prio || b.area - a.area);
      for (const c of callouts.slice(0, 40)) {
        const size = c.size;
        const tw = Math.max(textW(c.main, size), ...c.lines.map((l) => textW(l.text, size * l.k)));
        const th = size + c.lines.reduce((a, l) => a + size * l.k * 1.15, 0);
        const a0 = Math.atan2(c.p[1] - cyM, c.p[0] - cx);
        let best = null;
        for (const R of [1.3, 2.1, 3.1, 4.4, 6, 8, 10.5]) {
          for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
            const a = a0 + (k * Math.PI) / 6, ux = Math.cos(a), uy = Math.sin(a);
            const ext = Math.abs(ux) * (tw / 2 + 4) + Math.abs(uy) * (th / 2 + 4);
            const q = [c.p[0] + ux * (R * size + ext), c.p[1] + uy * (R * size + ext)];
            const box = [q[0] - tw / 2 - 3, q[1] - th / 2 - 3, q[0] + tw / 2 + 3, q[1] + th / 2 + 3];
            if (box[0] < margin * 0.5 || box[2] > W - margin * 0.5 || box[1] < cy0 + 2 || box[3] > cy1 - 2) continue;
            if (overlaps(box)) continue;
            // 상자 가장자리까지 선
            const dx = q[0] - c.p[0], dy = q[1] - c.p[1];
            const kk = Math.min((tw / 2 + 4) / Math.max(Math.abs(dx), 1e-6), (th / 2 + 4) / Math.max(Math.abs(dy), 1e-6));
            const e = [q[0] - dx * kk, q[1] - dy * kk];
            if (placed.some((b) => segHitsBox(c.p, e, b))) continue;
            if (segs.some(([s0, s1]) => cross(c.p, e, s0, s1))) continue;
            // 점수: 짧은 선, 바깥쪽 방향, 빈 바탕일수록 좋다
            const pts = [q, [box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
            const over = pts.reduce((a, [x, y]) => { const h = hit(x, y); return a + (h === 2 ? 3 : h); }, 0);
            const cost = R + Math.abs(k) * 0.35 + over * 1.6;
            if (!best || cost < best.cost) best = { q, box, e, cost };
          }
          if (best && best.cost <= R + 1) break; // 빈 바탕에서 좋은 자리를 찾았으면 더 멀리 가지 않는다
        }
        if (!best) continue;
        placed.push(best.box);
        segs.push([c.p, best.e]);
        scene.lines.push({lv:c.lv,id:c.id,lines:[[c.p,best.e]],stroke:lineColor,width:base*1.3,group:"leader"});
        scene.polys.push({ lv:c.lv,id:c.id,name: "지시점 " + c.main, rings: [[dot(c.p, base * 2.4)]], fill: lineColor, stroke: paper, width: base * 0.8, group: "leader" });
        let y = best.q[1] - th / 2;
        scene.texts.push({ lv: c.lv, id: c.id, x: best.q[0], y: y + size * 0.5, text: c.main, size, weight: c.weight, fill: ink, halo: true, haloColor: paper, track: -0.02, callout: true });
        y += size;
        for (const l of c.lines) {
          const ls = size * l.k;
          scene.texts.push({ lv: c.lv, id: c.id, x: best.q[0], y: y + ls * 0.62, text: l.text, size: ls, weight: l.weight, fill: l.muted ? mix(ink, paper, 0.45) : ink, halo: true, haloColor: paper, track: -0.01, sub: true, callout: true });
          y += ls * 1.15;
        }
      }
    }
    // 양옆 줄: 왼쪽 줄은 오른쪽 끝을, 오른쪽 줄은 왼쪽 끝을 맞추고, 위아래로 겹치지 않게 쌓는다
    const placeColumns = (items, reserved) => {
      const ink = C.text, paper = C.bg || "#FFFFFF";
      const lineColor = mix(ink, paper, 0.35), valueInk = mix(ink, paper, 0.3);
      const segs = [];
      for (const left of [true, false]) {
        const col = items.filter((it) => it.left === left).sort((a, b) => a.p[1] - b.p[1]);
        if (!col.length) continue;
        let size = sideSize;
        const lgHere = lgBox && lgBox.bx + lgBox.bw / 2 < W / 2 === left;
        let top = cy0 + size * 0.8, bottom = cy1 - size * 0.8;
        if (!reserved && lgHere) {
          if (lgBox.by > (cy0 + cy1) / 2) bottom = Math.min(bottom, lgBox.by - size * 0.6);
          else top = Math.max(top, lgBox.by + lgBox.bh + size * 0.6);
        }
        let rowH = size * 1.55;
        if (col.length * rowH > bottom - top) { size *= Math.max((bottom - top) / (col.length * rowH), 0.5); rowH = size * 1.55; }
        const k = size / sideSize;
        const maxW = Math.max(...col.map((it) => it.w)) * k;
        const edge = left ? (reserved && lgHere ? lgBox.bx + lgBox.bw + margin * 0.6 : margin * 0.8) : reserved && lgHere ? lgBox.bx - margin * 0.6 : W - margin * 0.8;
        const xText = left ? edge + maxW : edge - maxW;
        const ys = col.map((it) => it.p[1]);
        const down = () => { for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], top + rowH / 2, i ? ys[i - 1] + rowH : -Infinity); };
        down();
        for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], bottom - rowH / 2, i < ys.length - 1 ? ys[i + 1] - rowH : Infinity);
        down();
        col.forEach((it, i) => {
          const y = ys[i], vs = size * 0.9, gap = size * 0.4;
          const common = { lv: it.lv, id: it.id, y, halo: true, haloColor: paper, callout: true };
          const wName = textW(it.name, size), wVal = it.value ? textW(it.value, vs) : 0;
          if (left) {
            if (it.value) scene.texts.push(Object.assign({ x: xText, text: it.value, size: vs, weight: 500, fill: valueInk, anchor: "end", sub: true }, common));
            scene.texts.push(Object.assign({ x: xText - (it.value ? wVal + gap : 0), text: it.name, size, weight: 700, fill: ink, anchor: "end", track: -0.02 }, common));
          } else {
            scene.texts.push(Object.assign({ x: xText, text: it.name, size, weight: 700, fill: ink, anchor: "start", track: -0.02 }, common));
            if (it.value) scene.texts.push(Object.assign({ x: xText + wName + gap, text: it.value, size: vs, weight: 500, fill: valueInk, anchor: "start", sub: true }, common));
          }
          // 글자 끝에서 잠깐 가로로 나간 뒤 지역의 점으로
          const sx = left ? xText + size * 0.35 : xText - size * 0.35;
          const ex = left ? xText + fs * 0.9 : xText - fs * 0.9;
          const pts = [[sx, y]];
          if (left ? it.p[0] > ex : it.p[0] < ex) pts.push([ex, y]);
          pts.push(it.p);
          segs.push(pts);
          scene.lines.push({lv:it.lv,id:it.id,lines:[pts],stroke:lineColor,width:base*1.2,group:"leader"});
          scene.polys.push({lv:it.lv,id:it.id, name: "지시점 " + it.name, rings: [[ringOf(it.p, base * 2.6, 16)]], fill: lineColor, stroke: paper, width: base * 0.8, group: "leader" });
        });
      }
    };
    const valueOfLines = (lines) => lines.filter((l) => !l.muted).map((l) => l.text).join(" · ");
    if (callouts.length > 3) {
      const items = callouts.slice(0, 60).map((c) => {
        const value = valueOfLines(c.lines);
        return { lv: c.lv, id: c.id, p: c.p, name: c.main, value, w: textW(c.main, sideSize) + (value ? textW(value, sideSize * 0.9) + sideSize * 0.4 : 0) };
      });
      splitSides(items, (it) => it.p[0]);
      placeColumns(items, false);
    }
    if (sideItems) {
      placeColumns(sideItems.map((it) => Object.assign({}, it, { p: tf([it.x, it.y]) })).filter((it) => it.p[0] >= 0 && it.p[0] <= W && it.p[1] >= cy0 && it.p[1] <= cy1), true);
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
    const muted = mix(C.text, C.bg || "#FFFFFF", 0.45);
    if (head.title || head.subtitle) {
      let y = margin;
      if (head.title) {
        const ts = fs * 1.55;
        scene.texts.push({ x: margin, y: y + ts * 0.5, text: head.title, size: ts, weight: 700, fill: C.text, anchor: "start", role: "heading", track: -0.03 });
        y += ts * 1.5;
      }
      if (head.subtitle) {
        const ss = fs * 0.85;
        scene.texts.push({ x: margin, y: y + ss * 0.5, text: head.subtitle, size: ss, weight: 500, fill: muted, anchor: "start", role: "heading", track: -0.01 });
      }
    }
    if (head.note) {
      const ns = fs * 0.55;
      scene.texts.push({ x: margin, y: H - margin * 0.6 - ns * 0.5, text: head.note, size: ns, weight: 400, fill: muted, anchor: "start", role: "heading" });
    }

    // 9) 범례
    if (lgBox) {
      const { ls, pad, row, sw, bw, bh, bx, by, titleH, itemsH, rL, gap } = lgBox;
      // 둥근 모서리 사각형 (모서리마다 점 몇 개로)
      const rect = (x, y, rw, rh, rr) => {
        rr = Math.min(rr || 0, rw / 2, rh / 2);
        if (!rr) return [[[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]]];
        const pts = [];
        const corner = (cx, cy, a0) => { for (let i = 0; i <= 4; i++) { const a = a0 + (Math.PI / 2) * (i / 4); pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } };
        corner(x + rw - rr, y + rr, -Math.PI / 2); corner(x + rw - rr, y + rh - rr, 0); corner(x + rr, y + rh - rr, Math.PI / 2); corner(x + rr, y + rr, Math.PI);
        return [pts];
      };
      const dark = C.bg && luminance(C.bg) < 0.2;
      const glassy = look === "glass";
      const panel = glassy ? mix(ground, "#FFFFFF", 0.2) : dark ? mix(C.bg, "#FFFFFF", 0.08) : "#FFFFFF";
      scene.polys.push(Object.assign({ name: "범례", rings: [rect(bx, by, bw, bh, ls * 0.6)], fill: glassy ? "#FFFFFF" : look === "soft" ? C.bg : panel, stroke: glassy ? "#FFFFFF" : mix(panel, C.text, 0.1), width: base * 1.2, group: "legend" },
        glassy ? { fillOpacity: 0.18, strokeOpacity: 0.5 } : look === "soft" ? { soft: true, stroke: null } : {}));
      let y = by + pad;
      if (lg.title) {
        scene.texts.push({ x: bx + pad, y: y + ls * 0.55, text: lg.title, size: ls * 1.05, weight: 700, fill: C.text, anchor: "start", role: "legend", track: -0.02 });
        y += ls * 1.05 * 1.7;
      }
      for (const it of lg.items) {
        scene.polys.push({ name: "범례 " + it.label, rings: [rect(bx + pad, y, sw, sw, sw * 0.22)], fill: it.color, stroke: null, width: 0, group: "legend" });
        scene.texts.push({ x: bx + pad + sw + ls * 0.6, y: y + sw / 2, text: it.label, size: ls, weight: 500, fill: mix(C.text, panel, 0.15), anchor: "start", role: "legend", track: -0.01 });
        y += row;
      }
      // 원 크기: 아래를 맞춘 겹친 원, 원 꼭대기에서 값까지 가는 선
      if (lgSizes.length) {
        const top0 = by + pad + titleH + itemsH + gap;
        const bottom = top0 + lgBox.sizesH;
        const cx = bx + pad + rL, tx = bx + pad + rL * 2 + ls * 0.9;
        const ticks = [];
        let prev = -Infinity;
        for (const it of lgSizes) {
          const r = rOf(it.value);
          scene.polys.push({ name: "범례 원 " + it.label, rings: [[ringOf([cx, bottom - r], r, 40)]], circle: { cx, cy: bottom - r, r }, fill: bub.color, fillOpacity: 0.14, stroke: mix(bub.color, C.text, 0.25), width: base * 1.1, group: "legend" });
          const ty = Math.max(bottom - 2 * r, prev + ls * 1.2, top0 + ls * 0.5);
          prev = ty;
          ticks.push([[cx, bottom - 2 * r], [tx - ls * 0.3, ty]]);
          scene.texts.push({ x: tx, y: ty, text: it.label, size: ls, weight: 500, fill: mix(C.text, panel, 0.15), anchor: "start", role: "legend", track: -0.01 });
        }
        scene.lines.push({ lines: ticks, stroke: mix(C.text, panel, 0.55), width: base * 0.9, group: "legend" });
      }
    }

    // 10) 확대 상자: 오른쪽 줄에 상자를 쌓고, 본 지도에는 그 범위를 가는 테두리로 표시
    if (insetDefs.length) {
      const paper = C.bg || "#FFFFFF";
      const glassy = look === "glass";
      const panel = glassy ? "#FFFFFF" : C.bg && luminance(C.bg) < 0.2 ? mix(C.bg, "#FFFFFF", 0.06) : "#FFFFFF";
      const frameInk = glassy ? "#FFFFFF" : mix(C.text, paper, 0.55);
      const rrect = (x, y, rw, rh, rr) => {
        const pts = [];
        const corner = (cx, cy, a0) => { for (let i = 0; i <= 4; i++) { const a = a0 + (Math.PI / 2) * (i / 4); pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } };
        corner(x + rw - rr, y + rr, -Math.PI / 2); corner(x + rw - rr, y + rh - rr, 0); corner(x + rr, y + rh - rr, Math.PI / 2); corner(x + rr, y + rr, Math.PI);
        return [pts];
      };
      const fillOf = {};
      for (const q of scene.polys) if (q.lv && /^(all|target)$/.test(q.group)) fillOf[K(q.lv, q.id)] = q.fill;
      const cols = insetDefs.length > 3 ? 2 : 1, gapB = fs * 0.45;
      const bwBox = (insetW - gapB * (cols - 1)) / cols;
      const colX0 = W - margin - insetW;
      let yTop = cy0 + fs * 0.3, yBot = cy1 - fs * 0.3;
      const titleH = fs * 0.7, pad = fs * 0.3;
      const boxes = insetDefs.map((d) => {
        let b = null;
        for (const id of d.ids) b = bbUnion(b, D[allLv][id].bb);
        const wd = b[2] - b[0], hd = b[3] - b[1];
        return { d, b, wd, hd, want: titleH + pad * 2 + ((bwBox - pad * 2) * hd) / wd };
      });
      const rows = [];
      for (let i = 0; i < boxes.length; i += cols) rows.push(boxes.slice(i, i + cols));
      const rowH = rows.map((r) => Math.min(Math.max(...r.map((b) => b.want)), bwBox * 1.25));
      const sum = rowH.reduce((a, v) => a + v, 0), gaps = gapB * (rows.length - 1);
      const kH = sum + gaps > yBot - yTop ? Math.max((yBot - yTop - gaps) / sum, 0.2) : 1;
      const frames = [];
      let y = yTop;
      rows.forEach((r, ri) => {
        const h = rowH[ri] * kH;
        r.forEach((bx, ci) => {
          const x = colX0 + ci * (bwBox + gapB);
          scene.polys.push(Object.assign({ name: "확대 " + bx.d.name, rings: [rrect(x, y, bwBox, h, fs * 0.25)], fill: panel, stroke: frameInk, width: base * 1.1, group: "inset" }, glassy ? { fillOpacity: 0.16, strokeOpacity: 0.5 } : {}));
          scene.texts.push({ x: x + pad, y: y + pad + titleH * 0.42, text: bx.d.name, size: fs * 0.5, weight: 700, fill: C.text, anchor: "start", track: -0.02 });
          const ax = x + pad, ay = y + pad + titleH, aw = bwBox - pad * 2, ah = h - pad * 2 - titleH;
          const sb = Math.min(aw / bx.wd, ah / bx.hd);
          const ox = ax + (aw - bx.wd * sb) / 2 - bx.b[0] * sb, oy = ay + (ah - bx.hd * sb) / 2 - bx.b[1] * sb;
          const T2 = (pt) => [pt[0] * sb + ox, pt[1] * sb + oy];
          for (const id of bx.d.ids) {
            const f = D[allLv][id];
            const fo = opacityOf[K(allLv, id)];
            scene.polys.push(Object.assign({ lv: allLv, id, name: f.full, regionAnchor:T2(f.lp), rings: decode(f).map((poly) => poly.map((ring) => ring.map(T2))), fill: fillOf[K(allLv, id)] || neutral, stroke: C.line, width: base * 0.9, group: "inset" }, fo != null ? { fillOpacity: fo, strokeOpacity: 0.6 } : {}));
          }
          // 원 크기 지도면 상자 안에도 같은 크기 기준으로 원을 그린다 (범례와 같은 눈금)
          if (bub) {
            const circles = bx.d.ids.filter((id) => bub.values[K(allLv, id)] > 0).map((id) => ({ id, c: T2(D[allLv][id].lp), r: rOf(bub.values[K(allLv, id)]) })).sort((a, b) => b.r - a.r);
            for (const q of circles) if (q.r >= 0.8) scene.polys.push({ lv: allLv, id: q.id, name: "원 " + D[allLv][q.id].full, rings: [[ringOf(q.c, q.r, 40)]], circle: { cx: q.c[0], cy: q.c[1], r: q.r }, fill: bub.color, fillOpacity: 0.72, stroke: paper, width: base, group: "inset" });
          }
          if (o.labelMode !== "none") {
            const ls = fs * 0.4;
            for (const id of bx.d.ids.slice().sort((a, b) => D[allLv][b].a - D[allLv][a].a)) {
              const key = K(allLv, id), f = D[allLv][id];
              if (o.labelMode === "pick" && !(o.labelPick && o.labelPick.has(key))) continue;
              if ((styles[key] || {}).hideLabel) continue;
              const q = T2(f.lp), fb = f.bb, fw = (fb[2] - fb[0]) * sb;
              const name = (styles[key] || {}).text || f.nm;
              const v = values[key], val = Array.isArray(v) ? v[0] : v;
              const tw = Math.max(textW(name, ls), val ? textW(val, ls * 0.85) : 0);
              if (tw > fw * 1.1) continue;
              const th = ls * (val ? 2.1 : 1.1);
              const box = [q[0] - tw / 2, q[1] - th / 2, q[0] + tw / 2, q[1] + th / 2];
              if (overlaps(box)) continue;
              placed.push(box);
              const seen = opacityOf[key] != null ? mix(ground, fillOf[key] || neutral, opacityOf[key]) : fillOf[key] || neutral;
              const color = textOn(seen, C.text);
              scene.texts.push({ lv: allLv, id, x: q[0], y: q[1] - (val ? ls * 0.45 : 0), text: name, size: ls, weight: 600, fill: color, track: -0.02 });
              if (val) scene.texts.push({ lv: allLv, id, x: q[0], y: q[1] + ls * 0.62, text: String(val), size: ls * 0.85, weight: 500, fill: color, sub: true });
            }
          }
          const p0 = tf([bx.b[0], bx.b[1]]), p1 = tf([bx.b[2], bx.b[3]]), e = base * 3;
          frames.push([[p0[0] - e, p0[1] - e], [p1[0] + e, p0[1] - e], [p1[0] + e, p1[1] + e], [p0[0] - e, p1[1] + e], [p0[0] - e, p0[1] - e]]);
        });
        y += h + gapB;
      });
      scene.lines.push({ lines: frames, stroke: frameInk, width: base * 1.2, group: "inset" });
    }
    // 실제 위치에서의 총 이동량: 벌려 놓기 이동 + 사용자가 옮긴 이동.
    scene.regionOffsets = {};
    for (const p of scene.polys) if (p.lv && !["context", "shadow", "extrude", "inset", "bubble"].includes(p.group)) {
      scene.regionOffsets[K(p.lv,p.id)] = offOf(p.lv,p.id).slice();
    }
    if(o.look==='dots'||o.look==='regionDots') dotScene(scene,C,o.look==='regionDots');
    return scene;
  }

  // 점의 중심과 둘레가 모두 경계 안에 있는 것만 남긴다. 구멍·바다에는 점을 찍지 않는다.
  function dotScene(scene,C,single){
    const step=scene.width/150,r=step*.29;
    const inside=(p,rings)=>{let yes=false;for(const poly of rings)for(const ring of poly)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
    }return yes;};
    const dots=[];
    for(const p of scene.polys){
      if(!/^(context|all|picked|inner|neighbor|target|inset)$/.test(p.group)||!p.lv||p.circle)continue;
      if(single&&p.group==='context')continue;
      if(single){
        const pts=p.rings[0][0],c=p.regionAnchor||[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length],radius=scene.width/350;
        const ring=Array.from({length:24},(_,i)=>[c[0]+radius*Math.cos(i*Math.PI/12),c[1]+radius*Math.sin(i*Math.PI/12)]);
        dots.push({...p,lv:p.group==='inset'?undefined:p.lv,name:p.name+' 대표점',rings:[[ring]],circle:{cx:c[0],cy:c[1],r:radius},stroke:C.bg||'#FFFFFF',width:scene.width/1600*.8,group:'dots',sourceGroup:p.group});
        p.fillOpacity=0;p.stroke=null;continue;
      }
      const rings=[];
      for(const poly of p.rings){
        const before=rings.length;
        const pts=poly[0],xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
        const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
        for(let y=Math.ceil(y0/step)*step;y<=y1;y+=step)for(let x=Math.ceil(x0/step)*step;x<=x1;x+=step){
          const ring=Array.from({length:12},(_,i)=>[x+r*Math.cos(i*Math.PI/6),y+r*Math.sin(i*Math.PI/6)]);
          if(inside([x,y],[poly])&&ring.every(q=>inside(q,[poly])))rings.push([ring]);
        }
        if(rings.length===before)rings.push(poly);
      }
      // 격자보다 작은 지역도 실제 경계 자체를 작은 점 무늬의 일부로 보존한다.
      if(!rings.length)rings.push(...p.rings);
      dots.push({...p,lv:['context','inset'].includes(p.group)?undefined:p.lv,name:p.name+' 도트',rings,stroke:null,width:0,group:'dots',sourceGroup:p.group});
      p.fillOpacity=0;p.stroke=null;
    }
    scene.polys=scene.polys.filter(p=>p.group!=='shadow').concat(dots);
    if(!single)scene.lines=scene.lines.filter(l=>!['sido','context','target'].includes(l.group));
    scene.shadow=null;
    for(const t of scene.texts)if(t.lv){t.fill=C.text;t.halo=true;t.haloColor=C.bg||'#FFFFFF';}
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
    ["context", "배경"], ["extrude", "입체"], ["all", "지역"], ["neighbor", "주변"], ["shadow", "그림자"], ["picked", "선택"], ["inner", "대상_내부"], ["target", "대상"], ["sido", "시도경계"], ["bubble", "원"], ["leader", "지시선"], ["inset", "확대"],
    ["dots", "도트"], ["annotation", "설명요소"],
  ];

  /** 바탕(단색 · 그라데이션 · 번진 빛) 마크업. defs 는 toSVG 가 넣는다 */
  function backdropMarkup(scene) {
    const W = scene.width, H = scene.height, bd = scene.backdrop;
    if (!bd) return scene.bg ? `<rect id="바탕" x="0" y="0" width="${W}" height="${H}" fill="${scene.bg}"/>` : "";
    if (bd.kind === "solid") return `<rect id="바탕" x="0" y="0" width="${W}" height="${H}" fill="${bd.mid}"/>`;
    const m = Math.max(W, H);
    const blobs = (bd.blobs || []).map((b) => `<circle cx="${num(b.x * W)}" cy="${num(b.y * H)}" r="${num(b.r * m)}" fill="${b.color}" fill-opacity="0.75"/>`).join("");
    return `<g id="바탕"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgGrad)"/>${blobs ? `<g filter="url(#bgBlur)">${blobs}</g>` : ""}</g>`;
  }
  /** 그라데이션 바탕이 있으면 바탕만 그린 SVG (PPTX 슬라이드 배경 그림용, 기본 16:9 크기) */
  function backdropSVG(scene, w, h) {
    if (!scene.backdrop || scene.backdrop.kind === "solid") return null;
    const one = Object.assign({}, scene, { polys: [], lines: [], texts: [], shadow: null, glow: null, soft: null, width: w || 1600, height: h || 900 });
    return toSVG(one);
  }
  function toSVG(scene, opt) {
    opt = opt || {};
    const used = new Set();
    const W = scene.width, H = scene.height;
    const out = [];
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">`
    );
    out.push(`<title>${esc(scene.title)}</title>`);
    const defs = [];
    if (scene.shadow) {
      const sh = scene.shadow;
      defs.push(
        `<filter id="liftShadow" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB">` +
          `<feDropShadow dx="0" dy="${num(sh.dy)}" stdDeviation="${num(sh.blur)}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/></filter>`
      );
    }
    if (scene.glow) {
      // 네온: 흐린 복사본 두 겹 위에 원래 선
      defs.push(`<filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${num(scene.glow.blur)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    }
    if (scene.soft) {
      // 소프트: 왼쪽 위 밝은 빛, 오른쪽 아래 그늘
      const so = scene.soft;
      defs.push(`<filter id="softRaise" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${num(so.blur)}" result="bl"/>` +
        `<feOffset in="bl" dx="${num(so.d)}" dy="${num(so.d)}" result="o1"/><feFlood flood-color="${so.dark}" flood-opacity="0.75"/><feComposite in2="o1" operator="in" result="s1"/>` +
        `<feOffset in="bl" dx="${num(-so.d)}" dy="${num(-so.d)}" result="o2"/><feFlood flood-color="${so.light}" flood-opacity="0.95"/><feComposite in2="o2" operator="in" result="s2"/>` +
        `<feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    }
    const bd = scene.backdrop;
    if (bd && bd.kind !== "solid") {
      if (bd.kind === "radial") defs.push(`<radialGradient id="bgGrad" cx="50%" cy="38%" r="75%">${bd.stops.map((c, i) => `<stop offset="${num((i / Math.max(bd.stops.length - 1, 1)) * 100)}%" stop-color="${c}"/>`).join("")}</radialGradient>`);
      else {
        const a = ((bd.angle || 135) * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        defs.push(`<linearGradient id="bgGrad" x1="${num((0.5 - dx) * 100)}%" y1="${num((0.5 - dy) * 100)}%" x2="${num((0.5 + dx) * 100)}%" y2="${num((0.5 + dy) * 100)}%">${bd.stops.map((c, i) => `<stop offset="${num((i / Math.max(bd.stops.length - 1, 1)) * 100)}%" stop-color="${c}"/>`).join("")}</linearGradient>`);
      }
      if (bd.blobs && bd.blobs.length) defs.push(`<filter id="bgBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${num(Math.max(W, H) * 0.07)}"/></filter>`);
    }
    if (defs.length) out.push(`<defs>${defs.join("")}</defs>`);
    const bgm = backdropMarkup(scene);
    if (bgm) out.push(bgm);
    for (const [g, gname] of GROUPS) {
      const ps = scene.polys.filter((p) => p.group === g);
      const ls = scene.lines.filter((l) => l.group === g);
      if (!ps.length && !ls.length) continue;
      const gf = g === "shadow" ? "liftShadow" : ps.some((p) => p.glow) || ls.some((l) => l.glow) ? "neonGlow" : ps.some((p) => p.soft) ? "softRaise" : null;
      out.push(gf ? `<g id="${gname}" filter="url(#${gf})">` : `<g id="${gname}"${g==='dots'?' pointer-events="none"':''}>`);
      for (const p of ps) {
        const dk = opt.interactive && p.lv ? ` data-k="${p.lv}:${p.id}"` : "";
        if (g === "shadow") { out.push(`<path${dk} d="${polyD(p.rings)}" fill="${p.fill}"${p.fillOpacity != null ? ` fill-opacity="${p.fillOpacity}"` : ""}/>`); continue; }
        const attrs = opt.interactive && p.lv ? ` data-lv="${p.lv}" data-id="${p.id}"${dk}` : "";
        const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}" stroke-linejoin="round"${p.strokeOpacity != null ? ` stroke-opacity="${p.strokeOpacity}"` : ""}` : "";
        const id = g === "context" || g === "extrude" ? "" : ` id="${safeId(p.name, used)}"`;
        const op = p.fillOpacity != null ? ` fill-opacity="${p.fillOpacity}"` : "";
        const title = g === "context" && !opt.interactive ? "" : `<title>${esc(p.name)}</title>`;
        if (p.circle) out.push(`<circle${id}${attrs} cx="${num(p.circle.cx)}" cy="${num(p.circle.cy)}" r="${num(p.circle.r)}" fill="${p.fill}"${op}${stroke}>${title}</circle>`);
        else out.push(`<path${id}${attrs} d="${polyD(p.rings)}" fill="${p.fill}" fill-rule="evenodd"${op}${stroke}>${title}</path>`);
      }
      for (const l of ls) {
        const d = l.lines.map((r) => ringD(r, false)).join("");
        const dk=opt.interactive&&l.lv?` data-k="${l.lv}:${l.id}"`:"";
        if (d) out.push(`<path${dk} d="${d}" fill="none" stroke="${l.stroke}" stroke-width="${num(l.width)}"${l.strokeOpacity != null ? ` stroke-opacity="${l.strokeOpacity}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`);
      }
      out.push(`</g>`);
    }
    const textEl = (t) => {
      const dk = opt.interactive && t.lv ? ` data-k="${t.lv}:${t.id}"` : "";
      const anchor = t.anchor === "start" || t.anchor === "end" ? ` text-anchor="${t.anchor}"` : "";
      const track = t.track ? ` letter-spacing="${num(t.size * t.track)}"` : "";
      const common = `${dk}${anchor} x="${num(t.x)}" y="${num(t.y + t.size * 0.36)}" font-size="${num(t.size)}" font-weight="${t.weight}"${track}`;
      const halo = t.halo ? `<text ${common} fill="none" stroke="${t.haloColor || "#FFFFFF"}" stroke-width="${num(t.size * 0.22)}" stroke-linejoin="round">${esc(t.text)}</text>` : "";
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
        const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}"${p.strokeOpacity != null ? ` stroke-opacity="${p.strokeOpacity}"` : ""}` : "";
        const op = p.fillOpacity != null ? ` fill-opacity="${p.fillOpacity}"` : "";
        const fl = p.soft ? ` filter="url(#softRaise)"` : "";
        if (p.circle) out.push(`<circle cx="${num(p.circle.cx)}" cy="${num(p.circle.cy)}" r="${num(p.circle.r)}" fill="${p.fill}"${op}${stroke}/>`);
        else out.push(`<path d="${polyD(p.rings)}" fill="${p.fill}"${op}${stroke}${fl}/>`);
      }
      for (const l of scene.lines.filter((q) => q.group === "legend")) out.push(`<path d="${l.lines.map((r) => ringD(r, false)).join("")}" fill="none" stroke="${l.stroke}" stroke-width="${num(l.width)}" stroke-linecap="round"/>`);
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

  /** 원래 이웃인 두 지역의 총 이동량을 같게 하면 경계의 상대 위치가 복원된다. */
  function snapOffset(D, scene, key, proposed, old, tolerance) {
    const offsets=scene.regionOffsets;
    if(scene.tileGrid&&scene.tileGrid.cells[key]){
      const L=scene.tileGrid,origin=L.cells[key],rh=L.hex?L.c*Math.sqrt(3)/2:L.c;
      const row=Math.round(proposed[1]/rh),shift=L.hex&&Math.abs(row)%2?L.c/2:0;
      const dx=Math.round((proposed[0]-shift)/L.c)*L.c+shift,dy=row*rh;
      const occupied=Object.keys(L.cells).some(k=>k!==key&&Math.hypot(L.cells[k][0]+(offsets[k]||[0,0])[0]-origin[0]-dx,L.cells[k][1]+(offsets[k]||[0,0])[1]-origin[1]-dy)<L.c*.2);
      return occupied?{offset:old.slice(),neighbor:null}:{offset:[dx,dy],neighbor:'grid'};
    }
    if(scene.tiles || !offsets || !offsets[key] || !(tolerance>0)) return {offset:proposed,neighbor:null};
    const [lv,id]=key.split(":"), base=offsets[key].map((v,i)=>v-old[i]);
    let best={offset:proposed,neighbor:null}, distance=tolerance;
    for(const other of Object.keys(offsets).sort()) {
      const [to,oid]=other.split(":");
      if(other===key || contains(D,lv,id,to,oid) || contains(D,to,oid,lv,id))continue;
      if(!((D.nb[lv+">"+to]||{})[id]||[]).includes(oid))continue;
      const target=offsets[other].map((v,i)=>v-base[i]);
      const d=Math.hypot(target[0]-proposed[0],target[1]-proposed[1]);
      if(d<=distance){distance=d;best={offset:target,neighbor:other};}
    }
    return best;
  }
  return { snapOffset, INSETS, insetMembers, buildScene, toSVG, backdropSVG, useSido17, tileLayout, tileName, neighborsOf, featuresInside, contains, decode, sidoShort, DEFAULT_COLORS, DISTINCT, LEVEL_NAME, LEVEL_ORDER, FONT };
});
