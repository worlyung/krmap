/*
 * 붙여넣은 표(지역명 · 값)로 지역을 칠하는 도구 — 이름 맞추기, 단계 나누기, 색 단계.
 * 숫자 값은 단계 구분도(같은 개수 / 같은 간격), 글자 값은 분류별 색으로 칠한다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // 순차 색 단계 (밝은 → 진한). "색각" 은 색약인 사람도 구분하기 쉬운 viridis 계열.
  const PALETTES = {
    blue: { name: "파랑", stops: ["#EEF3FD", "#9DB8F2", "#3361E0", "#1A2F86"] },
    green: { name: "초록", stops: ["#ECF7F2", "#97D3B6", "#1E9468", "#0B4D36"] },
    orange: { name: "주황", stops: ["#FEF3E7", "#F8C08A", "#E8742B", "#8E3A0C"] },
    red: { name: "빨강", stops: ["#FDEDEC", "#F4A3A0", "#D9413B", "#7C1A17"] },
    purple: { name: "보라", stops: ["#F2EFFB", "#C2B4EE", "#6A4CD6", "#33207A"] },
    viridis: { name: "색각 친화", stops: ["#FDE725", "#5EC962", "#21918C", "#3B528B", "#440154"] },
    diverge: { name: "파랑↔빨강", stops: ["#2B59C3", "#9DB4E8", "#F2F2F2", "#F0A39B", "#C9352B"] },
  };
  // 분류(글자 값)용 뚜렷한 색
  const CATEGORY = ["#3361E0", "#EF6B4C", "#14A37F", "#F2B33D", "#8B5CF6", "#E0559A", "#4BB3D9", "#8C6D46", "#7A8899", "#B9C93A", "#D9653B", "#2E8A99"];

  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerp(a, b, t) {
    const A = hex(a), B = hex(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  /** 팔레트 stops 를 steps 개의 색으로 고르게 나눈다 */
  function ramp(key, steps) {
    const st = (PALETTES[key] || PALETTES.blue).stops;
    const out = [];
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 1 : i / (steps - 1);
      const x = t * (st.length - 1), k = Math.min(Math.floor(x), st.length - 2);
      out.push(lerp(st[k], st[k + 1], x - k));
    }
    return out;
  }

  const num = (v) => {
    const t = String(v).replace(/[,\s%원명개건㎢]/g, "").replace(/^−/, "-");
    return t !== "" && isFinite(+t) ? +t : null;
  };

  /** 엑셀·구글 시트에서 복사한 표(탭) 또는 쉼표 구분 글을 [[이름, 값], ...] 로 */
  function parseTable(text) {
    const rows = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cols = (line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length < 2) continue;
      // 이름이 여러 칸(시도 · 시군구 …)에 나뉘어 있으면 마지막 칸만 값, 나머지는 이름으로 잇는다
      rows.push([cols.slice(0, -1).filter(Boolean).join(" "), cols[cols.length - 1]]);
    }
    // 첫 줄이 머리글(값 칸이 숫자가 아님)이고 나머지는 숫자면 버린다
    if (rows.length > 1 && num(rows[0][1]) == null && rows.slice(1).filter((r) => num(r[1]) != null).length >= (rows.length - 1) * 0.8) rows.shift();
    return rows;
  }

  const norm = (t) => String(t).replace(/\s+/g, "").replace(/[()·.]/g, "");

  /**
   * 이름 → "lv:id" 찾기. levels 의 지역들만 대상으로 한다.
   * "대전광역시 중구", "대전 중구", "중구(대전)", "유성구", "수원시 장안구" 등을 받아들인다.
   */
  function matcher(D, levels, sidoShort) {
    const exact = new Map(), tail = new Map();
    const put = (map, k, v) => { const a = map.get(k); if (!a) map.set(k, [v]); else if (!a.includes(v)) a.push(v); };
    for (const lv of levels) {
      const L = D[lv];
      if (!L) continue;
      for (const id in L) {
        const f = L[id], key = lv + ":" + id;
        const sd = D.sido[f.sido] ? D.sido[f.sido].nm : "";
        const short = sd ? sidoShort(sd) : "";
        put(exact, norm(f.full), key);
        if (lv === "sido") { put(exact, norm(short), key); continue; }
        const nm = f.city && lv === "sgg" ? f.city + f.nm : f.nm;
        put(exact, norm(short + nm), key);
        put(exact, norm(nm + short), key);
        put(tail, norm(nm), key);
        if (f.city && lv === "sgg") put(tail, norm(f.nm), key);
      }
    }
    return (name) => {
      const n = norm(name);
      const e = exact.get(n);
      if (e && e.length === 1) return e[0];
      const t = tail.get(n);
      if (t && t.length === 1) return t[0];
      if ((e && e.length > 1) || (t && t.length > 1)) return "ambiguous";
      return null;
    };
  }

  /** 숫자들을 steps 단계로 나누는 경계값 (quantile: 같은 개수, equal: 같은 간격) */
  function breaks(values, steps, method) {
    const v = values.slice().sort((a, b) => a - b);
    const lo = v[0], hi = v[v.length - 1];
    const out = [];
    for (let i = 1; i < steps; i++) {
      if (method === "equal") out.push(lo + ((hi - lo) * i) / steps);
      else out.push(v[Math.min(v.length - 1, Math.floor((v.length * i) / steps))]);
    }
    return { lo, hi, cuts: [...new Set(out)].filter((x) => x > lo && x <= hi) };
  }
  function classOf(x, cuts) {
    let k = 0;
    while (k < cuts.length && x >= cuts[k]) k++;
    return k;
  }
  /** 지도에 올릴 짧은 값: 큰 수는 만·억 단위로 */
  function compact(x) {
    const a = Math.abs(x);
    if (a >= 1e8) return (+(x / 1e8).toFixed(a >= 1e10 ? 0 : 1)).toLocaleString("ko-KR") + "억";
    if (a >= 1e5) return Math.round(x / 1e4).toLocaleString("ko-KR") + "만";
    return fmt(x);
  }
  function fmt(x) {
    const a = Math.abs(x);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return (+x.toFixed(d)).toLocaleString("ko-KR");
  }

  /**
   * 붙여넣은 표를 칠할 색·범례로 바꾼다.
   * 반환: {fills, values, legend:{items}, matched, unmatched:[이름], ambiguous:[이름], kind}
   */
  function build(D, levels, text, opt, sidoShort) {
    const rows = parseTable(text);
    const find = matcher(D, levels, sidoShort);
    const res = { fills: {}, values: {}, legend: { items: [] }, matched: 0, unmatched: [], ambiguous: [], kind: null };
    const hits = [];
    for (const [name, raw] of rows) {
      const key = find(name);
      if (key === "ambiguous") res.ambiguous.push(name);
      else if (!key) res.unmatched.push(name);
      else hits.push({ key, raw, v: num(raw) });
    }
    res.matched = hits.length;
    if (!hits.length) return res;
    const numeric = hits.filter((h) => h.v != null).length >= hits.length * 0.8;
    res.kind = numeric ? "num" : "cat";
    if (numeric) {
      const vals = hits.filter((h) => h.v != null).map((h) => h.v);
      const { lo, hi, cuts } = breaks(vals, Math.max(2, Math.min(9, opt.steps || 5)), opt.method);
      const colors = ramp(opt.palette, cuts.length + 1);
      for (const h of hits) {
        if (h.v == null) continue;
        res.fills[h.key] = colors[classOf(h.v, cuts)];
        res.values[h.key] = /^[\d,.\s-]+$/.test(h.raw) ? compact(h.v) : h.raw;
      }
      const edges = [lo, ...cuts, hi];
      res.legend.items = colors.map((c, i) => ({ color: c, label: lo === hi ? fmt(lo) : `${fmt(edges[i])} ~ ${i === colors.length - 1 ? fmt(edges[i + 1]) : "" + fmt(edges[i + 1])} ${i === colors.length - 1 ? "" : "미만"}`.trim() }));
    } else {
      const cats = [...new Set(hits.map((h) => h.raw))];
      cats.forEach((c, i) => res.legend.items.push({ color: CATEGORY[i % CATEGORY.length], label: c }));
      const colorOf = Object.fromEntries(res.legend.items.map((it) => [it.label, it.color]));
      for (const h of hits) { res.fills[h.key] = colorOf[h.raw]; res.values[h.key] = ""; }
    }
    return res;
  }

  return { PALETTES, CATEGORY, ramp, parseTable, matcher, breaks, build, fmt, compact };
});
