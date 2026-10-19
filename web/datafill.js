/*
 * 표(엑셀 붙여넣기·CSV 파일)로 지역을 칠하는 도구.
 * - 열이 여러 개인 표: 칠할 기준(한 열 / 두 열의 비율 / 여론조사 1위)과 이름 아래 보일 값을 고른다.
 * - 행정안전부 연령별 주민등록 인구 파일: 나이 열을 알아보고 총인구·청년·노인·비율을 계산한다.
 * - 행정기관코드(10자리)나 지역 이름으로 지역을 찾고, 지도 단위보다 잘게 들어온 숫자는 위 단위로 더한다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // 순차 색 단계 (밝은 → 진한). "색각 친화" 는 색약인 사람도 구분하기 쉬운 viridis 계열.
  const PALETTES = {
    blue: { name: "파랑", stops: ["#DCE7FB", "#9DB8F2", "#3361E0", "#1A2F86"] },
    green: { name: "초록", stops: ["#D9F0E5", "#97D3B6", "#1E9468", "#0B4D36"] },
    orange: { name: "주황", stops: ["#FDE4CC", "#F8C08A", "#E8742B", "#8E3A0C"] },
    red: { name: "빨강", stops: ["#FADAD7", "#F4A3A0", "#D9413B", "#7C1A17"] },
    purple: { name: "보라", stops: ["#E4DEF8", "#C2B4EE", "#6A4CD6", "#33207A"] },
    viridis: { name: "색각 친화", stops: ["#FDE725", "#5EC962", "#21918C", "#3B528B", "#440154"] },
    diverge: { name: "파랑↔빨강", stops: ["#1F56B3", "#8FB3EC", "#EEEDEA", "#F0A196", "#C23A2E"] },
  };
  // 분류·후보용 뚜렷한 색
  const CATEGORY = ["#3361E0", "#E5484D", "#14A37F", "#F2B33D", "#8B5CF6", "#E0559A", "#4BB3D9", "#8C6D46", "#7A8899", "#B9C93A", "#D9653B", "#2E8A99"];
  const LEVEL_ORDER = { sido: 0, si: 1, sgg: 2, emd: 3 };

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
    // key: 팔레트 이름, 또는 색 목록(stops) · {stops} (테마 색에서 만든 단계)
    const st = Array.isArray(key) ? key : key && key.stops ? key.stops : (PALETTES[key] || PALETTES.blue).stops;
    const out = [];
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 1 : i / (steps - 1);
      const x = t * (st.length - 1), k = Math.min(Math.floor(x), st.length - 2);
      out.push(lerp(st[k], st[k + 1], x - k));
    }
    return out;
  }

  const num = (v) => {
    const t = String(v == null ? "" : v).replace(/[,\s%원명개건㎢]/g, "").replace(/^−/, "-");
    return t !== "" && isFinite(+t) ? +t : null;
  };
  function fmt(x) {
    const a = Math.abs(x);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return (+x.toFixed(d)).toLocaleString("ko-KR");
  }
  /** 지도에 올릴 짧은 값: 큰 수는 만·억 단위로 */
  function compact(x) {
    const a = Math.abs(x);
    if (a >= 1e8) return (+(x / 1e8).toFixed(a >= 1e10 ? 0 : 1)).toLocaleString("ko-KR") + "억";
    if (a >= 1e5) return Math.round(x / 1e4).toLocaleString("ko-KR") + "만";
    return fmt(x);
  }
  const pct = (x) => (x == null || !isFinite(x) ? null : (Math.round(x * 10) / 10).toFixed(1) + "%");

  // ---------- 표 읽기 ----------
  function splitCSV(line, delim) {
    if (delim === "\t") return line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  /** 엑셀·구글 시트에서 복사한 표(탭), CSV, 또는 "이름 값" 줄을 {head, rows} 로 */
  function readTable(text) {
    const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { head: null, rows: [] };
    const delim = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(",")) ? "," : null;
    let rows = delim ? lines.map((l) => splitCSV(l, delim)) : lines.map((l) => { const m = l.trim().match(/^(.*\S)\s+(\S+)$/); return m ? [m[1], m[2]] : [l.trim()]; });
    const width = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => { while (r.length < width) r.push(""); return r; });
    // 첫 줄이 머리글인지: 나머지 줄에서 숫자인 칸이 첫 줄에서는 글자면 머리글
    let head = null;
    if (rows.length > 1) {
      const numericCols = [];
      for (let c = 0; c < width; c++) {
        const share = rows.slice(1).filter((r) => num(r[c]) != null).length / (rows.length - 1);
        if (share >= 0.7) numericCols.push(c);
      }
      const firstText = rows[0].every((v) => num(v) == null || /^\d{4}$/.test(v));
      if (/^(지역|지역명|코드|행정기관코드|region|code)$/i.test(rows[0][0]) || (numericCols.length && numericCols.every((c) => num(rows[0][c]) == null)) || (!numericCols.length && firstText && /지역|시도|시군구|읍면동|이름|구분|행정/.test(rows[0].join(" ")))) head = rows.shift();
    }
    return { head, rows };
  }

  const REGION_HEAD = /시도|시군구|읍면동|행정동|행정구역|지역|구역|이름|자치구|시·군|name|region/i;
  const AGE_HEAD = /(\d+)\s*세/;

  /**
   * 표를 분석해 지역 열·코드 열·값 열을 정한다.
   * 반환 ds = {rows:[{name, code, base:{}, ages:[]|null, text:{}}], columns:[{id, name, kind, get(rec)}], pop, note}
   */
  function analyze(tbl) {
    const { head, rows } = tbl;
    const width = rows.length ? rows[0].length : 0;
    const H = (c) => (head ? head[c] : "");
    const share = (c, test) => rows.filter((r) => test(r[c])).length / Math.max(rows.length, 1);
    const isNum = [], isCode = [];
    for (let c = 0; c < width; c++) {
      const present=rows.map(r=>r[c]).filter(v=>String(v).trim()!==""&&!/^(?:-|—|N\/A|null)$/i.test(String(v).trim()));
      isNum[c] = present.length ? present.filter(v=>num(v)!=null).length/present.length>=0.8 : /^(?:\d{4}(?:년)?|값|value)$/i.test(H(c));
      isCode[c] = /코드|code/i.test(H(c)) || (isNum[c] && share(c, (v) => /^\d{10}$/.test(String(v).trim())) >= 0.8);
    }
    const ageCols = [];
    for (let c = 0; c < width; c++) {
      const m = H(c).match(AGE_HEAD);
      if (m && isNum[c] && !/~|-|구간/.test(H(c))) ageCols.push({ c, age: Math.min(+m[1], 100), total: /계|총/.test(H(c)) });
    }
    const pop = ageCols.length >= 20;
    // 남·여·계가 다 있으면 계만 쓴다
    const useAges = pop && ageCols.some((a) => a.total) ? ageCols.filter((a) => a.total) : ageCols;
    const ageSet = new Set(ageCols.map((a) => a.c));
    // 지역 이름 열: 앞쪽 글자 열 중 머리글이 지역처럼 보이거나 첫 열
    const nameCols = [];
    for (let c = 0; c < width; c++) {
      if (isNum[c] || isCode[c]) continue;
      if (!nameCols.length || (head && REGION_HEAD.test(H(c)) && nameCols[nameCols.length - 1] === c - 1)) nameCols.push(c);
    }
    if (!nameCols.length && !isCode.some(Boolean)) nameCols.push(0);
    const codeCol = isCode.findIndex((x, c) => x && !nameCols.includes(c));
    const textCols = [];
    for (let c = 0; c < width; c++) if (!isNum[c] && !isCode[c] && !nameCols.includes(c)) textCols.push(c);
    const valCols = [];
    for (let c = 0; c < width; c++) if (isNum[c] && !isCode[c] && !ageSet.has(c) && !nameCols.includes(c)) valCols.push(c);

    const isPct = (c) => /%|율|비율|비중|지지|득표|점유|평균|지수|률/.test(H(c)) || share(c, (v) => /%/.test(v)) > 0.5;
    const out = { rows: [], columns: [], pop, note: "" };
    for (const r of rows) {
      let name = nameCols.map((c) => r[c]).filter(Boolean).join(" ");
      let code = codeCol >= 0 ? String(r[codeCol]).replace(/\D/g, "") : "";
      const m = name.match(/\((\d{10})\)\s*$/); // 주민등록 인구통계 내려받기 형식: "서울특별시 종로구(1111000000)"
      if (m) { code = code || m[1]; name = name.replace(/\(\d{10}\)\s*$/, "").trim(); }
      if (!name && !code) continue;
      const base = {};
      for (const c of valCols) base[c] = num(r[c]);
      let ages = null;
      if (pop) {
        ages = new Array(101).fill(0);
        for (const a of useAges) ages[a.age] += num(r[a.c]) || 0;
      }
      const text = {};
      for (const c of textCols) text[c] = r[c];
      out.rows.push({ name, code, base, ages, text });
    }
    const sumAges = (rec, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += rec.ages[i]; return s; };
    if (pop) {
      const totalCol = valCols.find((c) => /총인구|인구수|^계$|합계/.test(H(c)) && !/세대|구간/.test(H(c)));
      const total = (rec) => (totalCol != null && rec.base[totalCol] != null ? rec.base[totalCol] : sumAges(rec, 0, 100));
      const add = (id, name, kind, get) => out.columns.push({ id, name, kind, get });
      add("pop", "총인구", "count", total);
      add("young", "청년(19~34세)", "count", (r) => sumAges(r, 19, 34));
      add("old", "노인(65세 이상)", "count", (r) => sumAges(r, 65, 100));
      add("kid", "유소년(0~14세)", "count", (r) => sumAges(r, 0, 14));
      add("work", "생산연령(15~64세)", "count", (r) => sumAges(r, 15, 64));
      add("oldR", "노인 비율", "pct", (r) => (100 * sumAges(r, 65, 100)) / total(r));
      add("youngR", "청년 비율", "pct", (r) => (100 * sumAges(r, 19, 34)) / total(r));
      add("kidR", "유소년 비율", "pct", (r) => (100 * sumAges(r, 0, 14)) / total(r));
      add("agingI", "노령화지수", "index", (r) => (100 * sumAges(r, 65, 100)) / sumAges(r, 0, 14));
      out.note = "연령별 인구 표로 알아보고 총인구·청년·노인·비율을 계산했습니다.";
      for (const c of valCols) if (c !== totalCol && !/구간/.test(H(c))) out.columns.push({ id: "c" + c, name: H(c) || `값 ${c}`, kind: isPct(c) ? "pct" : "count", get: (r) => r.base[c] });
    } else {
      valCols.forEach((c, i) => out.columns.push({ id: "c" + c, name: H(c) || (valCols.length > 1 ? `값 ${i + 1}` : "값"), kind: isPct(c) ? "pct" : "count", get: (r) => r.base[c] }));
    }
    textCols.forEach((c, i) => out.columns.push({ id: "t" + c, name: H(c) || (textCols.length > 1 ? `분류 ${i + 1}` : "분류"), kind: "text", get: (r) => r.text[c] }));
    out.additive = (c) => !isPct(+c);
    out.valCols = valCols;
    return out;
  }

  const norm = (t) => String(t).replace(/\s+/g, "").replace(/[()·.]/g, "");
  /**
   * 이름 → "lv:id". levels 를 먼저 찾고, 없으면 more 단위에서 찾는다(더 잘게 들어온 표를 위로 더하려고).
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
        put(exact, norm(sd + nm), key);
        put(tail, norm(nm), key);
        if (f.city && lv === "sgg") put(tail, norm(f.nm), key);
      }
    }
    const pick = (arr) => {
      if (!arr) return null;
      if (arr.length === 1) return arr[0];
      // 같은 지역이 여러 단위(예: 구가 없는 시는 si 와 sgg 가 같다)면 앞 단위를 고른다
      const ids = new Set(arr.map((k) => k.split(":")[1]));
      return ids.size === 1 ? arr[0] : "ambiguous";
    };
    return (name) => {
      const n = norm(name);
      return pick(exact.get(n)) || pick(tail.get(n));
    };
  }

  /** 행정기관코드(10자리·5자리·2자리) → "lv:id" */
  function codeKey(D, code) {
    if (!code) return null;
    if (code.length === 10 && /0{8}$/.test(code)) code = code.slice(0, 2);
    else if (code.length === 10 && /0{5}$/.test(code)) code = code.slice(0, 5);
    if (code.length === 2) return D.sido[code] ? "sido:" + code : null;
    if (code.length === 5) return D.sgg[code] ? "sgg:" + code : D.si[code] ? "si:" + code : null;
    if (code.length === 10) return D.sgg[code.slice(0, 5)] ? "emd:" + code : null;
    return null;
  }
  /** key 가 속한 L 단위 지역 key (같은 단위면 자기 자신, 알 수 없으면 null) */
  function parentAt(D, key, L) {
    const [lv, id] = key.split(":");
    if (lv === L) return key;
    if (lv === "emd") {
      const f = D.emd && D.emd[id];
      const sg = f ? f.sgg : id.slice(0, 5);
      return D.sgg[sg] ? parentAt(D, "sgg:" + sg, L) : null;
    }
    if (lv === "sgg") {
      const f = D.sgg[id];
      if (L === "si") return "si:" + f.si;
      if (L === "sido") return "sido:" + f.sido;
      return null;
    }
    if (lv === "si") {
      const f = D.si[id];
      if (L === "sido") return "sido:" + f.sido;
      if (L === "sgg" && D.sgg[id]) return "sgg:" + id;
      return null;
    }
    return null;
  }

  /** 지도 단위(levels)별로 지역마다 합친 기록을 만든다 */
  function resolve(D, ds, levels, sidoShort, mappings) {
    const more = ["sido", "si", "sgg", "emd"].filter((lv) => D[lv] && !levels.includes(lv));
    const findDrawn = matcher(D, levels, sidoShort);
    const findMore = matcher(D, more, sidoShort);
    const res = { recs: {}, matched: 0, unmatched: [], ambiguous: [] };
    const exact = new Map();
    for (const r of ds.rows) {
      const mapped = mappings && Object.prototype.hasOwnProperty.call(mappings, r.name || r.code) ? mappings[r.name || r.code] : null;
      let key = mapped || codeKey(D, r.code);
      if (mapped) {
        const [lv, id] = String(mapped).split(":");
        if (!D[lv] || !D[lv][id]) throw new Error("연결한 지역이 현재 경계에 없습니다: " + mapped);
      }
      if (!key) {
        key = findDrawn(r.name);
        if (!key || key === "ambiguous") {
          const k2 = findMore(r.name);
          if (k2 && k2 !== "ambiguous") key = k2;
        }
      }
      if (key === "ambiguous") { res.ambiguous.push(r.name); continue; }
      if (!key) { res.unmatched.push(r.name || r.code); continue; }
      if (!exact.has(key)) exact.set(key, r);
    }
    const agg = new Map();
    for (const L of levels) {
      for (const [key, r] of exact) {
        const p = parentAt(D, key, L);
        if (!p) continue;
        if (p === key) { res.recs[p] = r; continue; }
        if (exact.has(p)) continue; // 위 단위 숫자가 따로 있으면 그것을 쓴다
        // 중간 단위의 합계도 우선한다 (시도 합산 때 구 합계와 그 안의 동을 중복으로 더하지 않음).
        const lv = key.split(":")[0];
        const covered = Object.keys(LEVEL_ORDER).some((a) =>
          LEVEL_ORDER[a] >= LEVEL_ORDER[L] && LEVEL_ORDER[a] < LEVEL_ORDER[lv] && exact.has(parentAt(D, key, a)));
        if (covered) continue;
        let a = agg.get(p);
        if (!a) { a = { base: {}, ages: r.ages ? new Array(101).fill(0) : null, text: Object.assign({}, r.text), n: 0, first: r }; agg.set(p, a); }
        a.n++;
        for (const c in r.base) {
          if (r.base[c] == null) continue;
          a.base[c] = ds.additive(c) ? (a.base[c] || 0) + r.base[c] : a.n === 1 ? r.base[c] : NaN;
        }
        if (r.ages) for (let i = 0; i <= 100; i++) a.ages[i] += r.ages[i];
        for (const c in r.text) if (a.text[c] !== r.text[c]) a.text[c] = a.n === 1 ? r.text[c] : null;
      }
    }
    for (const [k, a] of agg) if (!res.recs[k]) res.recs[k] = a.n === 1 ? a.first : a;
    res.matched = Object.keys(res.recs).length;
    return res;
  }

  /**
   * 기본 통계(build_stats.py 가 만든 stats.js) → 표 데이터.
   * 비율·지수는 저장된 값 대신 인구 수에서 다시 계산해 위 단위로 더할 때도 맞게 한다.
   */
  function fromStats(st) {
    const ids = st.cols.map((c) => c.id);
    const rows = Object.entries(st.rows).map(([code, arr]) => ({ name: arr[0], code, base: Object.fromEntries(ids.map((id, i) => [id, arr[i + 1]])), ages: null, text: {} }));
    const ratio = (a, b, k) => (r) => (r.base[a] != null && r.base[b] ? ((k || 100) * r.base[a]) / r.base[b] : null);
    const derived = {
      kidR: ratio("kid", "pop"), youngR: ratio("young", "pop"), midR: ratio("mid", "pop"), old60R: ratio("old60", "pop"), old70R: ratio("old70", "pop"),
      sexR: ratio("male", "female"), hhsize: ratio("pop", "hh", 1), agingI: ratio("old60", "kid"),
      yoyR: (r) => (r.base.yoy != null && r.base.pop ? (100 * r.base.yoy) / (r.base.pop - r.base.yoy) : null),
    };
    const columns = st.cols.map((c) => ({ id: c.id, name: c.name, kind: c.kind, get: derived[c.id] || ((r) => r.base[c.id]) }));
    return { rows, columns, pop: false, builtin: true, note: `행정안전부 주민등록 인구통계 ${st.meta.month}월말 기준 (시도·시군구)`, additive: (c) => !derived[c] && st.cols.some((x) => x.id === c && x.kind === "count") };
  }
  /** 지점 핀 → 지역마다 핀 수 (가장 잘게 찾은 지역 기준, 위 단위로는 더한다) */
  function fromPins(items) {
    const count = new Map();
    for (const it of items) {
      const keys = it.keys || {};
      const k = keys.emd || keys.sgg || keys.si || keys.sido;
      if (k) count.set(k, (count.get(k) || 0) + 1);
    }
    const rows = [...count].map(([k, n]) => ({ name: k, code: k.split(":")[1], base: { n }, ages: null, text: {} }));
    return { rows, columns: [{ id: "n", name: "지점 수", kind: "count", get: (r) => r.base.n }], pop: false, note: "", additive: () => true };
  }

  /** 기록 → 숫자/글자 값 */
  function valueOf(ds, rec, by) {
    if (!by) return null;
    if (by.t === "diff") {
      const a = ds.columns.find(c => c.id === by.a), b = ds.columns.find(c => c.id === by.b);
      const av = a && a.get(rec), bv = b && b.get(rec);
      return av == null || bv == null || !isFinite(av) || !isFinite(bv) ? null : bv - av;
    }
    if (by.t === "ratio") {
      const A = ds.columns.find((c) => c.id === by.a), B = ds.columns.find((c) => c.id === by.b);
      if (!A || !B) return null;
      const a = A.get(rec), b = B.get(rec);
      return a == null || !b ? null : (100 * a) / b;
    }
    const col = ds.columns.find((c) => c.id === by.c);
    if (!col) return null;
    const v = col.get(rec);
    return v == null || (typeof v === "number" && !isFinite(v)) ? null : v;
  }
  function label(ds, rec, id) {
    const col = ds.columns.find((c) => c.id === id);
    if (!col) return null;
    const v = col.get(rec);
    if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return null;
    if (col.kind === "text") return String(v);
    if (col.kind === "pct") return pct(v);
    if (col.kind === "index") return fmt(v);
    return compact(v);
  }

  /** 기본 색칠 기준: 인구 표면 노인 비율, 아니면 첫 숫자 열, 숫자 열이 없으면 첫 분류 열 */
  function defaultBy(ds) {
    if (ds.pop) return { t: "col", c: "oldR" };
    if (ds.builtin) return { t: "col", c: "pop" };
    const n = ds.columns.filter((c) => c.kind !== "text");
    // 여론조사처럼 보이면(열 이름이 후보·정당·찬반이거나, 줄마다 합이 100 안팎) 1위 색칠
    const sums = ds.rows.slice(0, 50).map((r) => n.reduce((a, c) => a + (+c.get(r) || 0), 0));
    const avg = sums.reduce((a, b) => a + b, 0) / Math.max(sums.length, 1);
    const pollish = n.length >= 2 && (n.every((c) => c.kind === "pct") || n.some((c) => /후보|당$|정당|찬성|반대|지지|응답/.test(c.name)) || (avg > 80 && avg < 105));
    if (pollish) return { t: "win", cols: n.map((c) => c.id) };
    if (n.length) return { t: "col", c: n[0].id };
    const t = ds.columns.find((c) => c.kind === "text");
    return t ? { t: "col", c: t.id } : null;
  }

  /**
   * 색·값·범례를 만든다.
   * opt = {by, labels:[열 id], palette, steps, method}
   * 반환: {fills, values, legend:{title, items}, kind}
   */
  function colorize(ds, res, opt) {
    const by = opt.by || defaultBy(ds);
    const out = { fills: {}, values: {}, legend: { title: "", items: [] }, kind: null, by };
    if (!by) return out;
    // 단계·범례는 지금 지도에 보이는 지역만으로 정한다
    const keys = Object.keys(res.recs).filter((k) => (!opt.only || opt.only.has(k)) && !(opt.excluded || []).includes(k));
    const labelIds = opt.labels || (by.t === "col" ? [by.c] : by.t === "win" ? [] : []);
    for (const k of keys) {
      const rec = res.recs[k];
      const lines = labelIds.map((id) => label(ds, rec, id)).filter(Boolean);
      if (by.t === "ratio") { const v = valueOf(ds, rec, by); if (v != null && !labelIds.length) lines.push(pct(v)); }
      if (lines.length) out.values[k] = lines.slice(0, 3);
    }
    if (by.t === "win") {
      // 여론조사: 1위 항목 색, 2위와의 차이가 작을수록 옅게
      out.kind = "win";
      const cols = ds.columns.filter((c) => by.cols.includes(c.id));
      cols.forEach((c, i) => out.legend.items.push({ color: CATEGORY[i % CATEGORY.length], label: c.name }));
      for (const k of keys) {
        const vals = cols.map((c) => c.get(res.recs[k])).map((v) => (v == null || !isFinite(v) ? -Infinity : v));
        const order = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
        if (order[0][0] === -Infinity) continue;
        const margin = order.length > 1 && isFinite(order[1][0]) ? order[0][0] - order[1][0] : Infinity;
        const base = CATEGORY[order[0][1] % CATEGORY.length];
        out.fills[k] = margin < 3 ? lerp(base, "#FFFFFF", 0.62) : margin < 8 ? lerp(base, "#FFFFFF", 0.32) : base;
        if (!opt.labels) out.values[k] = [`${cols[order[0][1]].name} ${fmt(order[0][0])}`];
      }
      out.legend.items.push({ color: lerp("#7A8899", "#FFFFFF", 0.62), label: "옅은 색: 1·2위 차이 3 미만" });
      out.legend.title = "1위";
      return out;
    }
    const vals = keys.map((k) => [k, valueOf(ds, res.recs[k], by)]).filter(([, v]) => v != null && v !== "");
    if (!vals.length) return out;
    const col = by.t === "col" ? ds.columns.find((c) => c.id === by.c) : by.t === "diff" ? { name: "증감 (후 − 전)", kind: "count" } : null;
    if (col && col.kind === "text") {
      out.kind = "cat";
      const cats = [...new Set(vals.map(([, v]) => String(v)))];
      cats.forEach((c, i) => out.legend.items.push({ color: CATEGORY[i % CATEGORY.length], label: c }));
      const colorOf = Object.fromEntries(out.legend.items.map((it) => [it.label, it.color]));
      for (const [k, v] of vals) out.fills[k] = colorOf[String(v)];
      out.legend.title = col.name;
      return out;
    }
    out.kind = "num";
    const nums = vals.map(([, v]) => +v).filter((v) => isFinite(v));
    const steps = Math.max(2, Math.min(9, opt.steps || 5));
    const isP = by.t === "ratio" || (col && col.kind === "pct");
    const f = (x) => (isP ? pct(x) : col && col.kind === "index" ? fmt(x) : compact(x));
    const bare = (x) => String(f(x)).replace(/%$/, ""); // "18.1 ~ 24.0%" 처럼 단위는 뒤에 한 번만
    const range = (a, b) => `${bare(a)} ~ ${f(b)}`;
    const lo0 = Math.min(...nums), hi0 = Math.max(...nums);
    // 원 크기(버블) 지도에 쓸 값 그대로와 표기법
    out.nums = {};
    for (const [k, v] of vals) if (isFinite(+v)) out.nums[k] = +v;
    out.fmt = f;
    if (by.t === "diff") {
      const max=Math.max(...nums.map(Math.abs),0), neutral="#EEEDEA";
      for(const [k,v] of vals) {
        out.fills[k]=v===0?neutral:lerp(neutral,v<0?"#1F56B3":"#C23A2E",Math.abs(v)/(max||1));
        out.values[k]=[(v>0?"+":"")+fmt(v)];
      }
      out.legend.items=max?[{color:"#1F56B3",label:"감소 (−"+fmt(max)+")"},{color:neutral,label:"0 (변화 없음)"},{color:"#C23A2E",label:"증가 (+"+fmt(max)+")"}]:[{color:neutral,label:"0 (변화 없음)"}];
    } else if (opt.cuts && opt.cuts.length) {
      const cuts = opt.cuts;
      if (cuts.length > 8 || cuts.some((v, i) => typeof v !== "number" || !isFinite(v) || (i && v <= cuts[i - 1]))) throw new Error("색 경계값은 작은 수부터 서로 다르게 최대 8개를 입력하세요");
      const colors = ramp(opt.palette, cuts.length + 1);
      for (const [k, v] of vals) if (isFinite(+v)) out.fills[k] = colors[classOf(+v, cuts)];
      out.legend.items = colors.map((color, i) => ({ color, label: i === 0 ? `${f(cuts[0])} 미만` : i === cuts.length ? `${f(cuts[i - 1])} 이상` : `${f(cuts[i - 1])} 이상 · ${f(cuts[i])} 미만` }));
    } else if ((opt.palette === "diverge" || (opt.palette && opt.palette.diverge)) && lo0 < 0 && hi0 > 0) {
      // 증감처럼 부호가 갈리는 값: 0 을 가운데(회색)로 두고 음수는 파랑, 양수는 빨강 쪽 단계로 따로 나눈다
      const k = Math.max(1, Math.floor(steps / 2));
      const neg = breaks(nums.filter((v) => v < 0), k, opt.method), pos = breaks(nums.filter((v) => v > 0), k, opt.method);
      const colors = ramp(opt.palette, 2 * k + 1);
      const nc = neg.cuts.length + 1, pc = pos.cuts.length + 1;
      const negColor = (i) => colors[k - nc + i], posColor = (i) => colors[k + 1 + i];
      for (const [kk, v] of vals) {
        const x = +v;
        if (!isFinite(x)) continue;
        out.fills[kk] = x < 0 ? negColor(classOf(x, neg.cuts)) : x > 0 ? posColor(classOf(x, pos.cuts)) : colors[k];
      }
      const ne = [neg.lo, ...neg.cuts, 0], pe = [0, ...pos.cuts, pos.hi];
      for (let i = 0; i < nc; i++) out.legend.items.push({ color: negColor(i), label: i === 0 && nc > 1 ? `${f(ne[1])} 미만` : range(ne[i], ne[i + 1]) });
      if (nums.includes(0)) out.legend.items.push({ color: colors[k], label: "0 (변화 없음)" });
      for (let i = 0; i < pc; i++) out.legend.items.push({ color: posColor(i), label: i === pc - 1 && pc > 1 ? `${f(pe[i])} 이상` : range(pe[i], pe[i + 1]) });
    } else {
      const { lo, hi, cuts } = breaks(nums, steps, opt.method);
      const colors = ramp(opt.palette, cuts.length + 1);
      for (const [k, v] of vals) if (isFinite(+v)) out.fills[k] = colors[classOf(+v, cuts)];
      const edges = [lo, ...cuts, hi];
      const n = colors.length;
      out.legend.items = colors.map((c, i) => ({
        color: c,
        label: lo === hi ? f(lo) : n === 1 ? range(lo, hi) : i === 0 ? `${f(edges[1])} 미만` : i === n - 1 ? `${f(edges[i])} 이상` : range(edges[i], edges[i + 1]),
      }));
    }
    out.legend.title = by.t === "ratio" ? `${(ds.columns.find((c) => c.id === by.a) || {}).name} ÷ ${(ds.columns.find((c) => c.id === by.b) || {}).name}` : col.name;
    return out;
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

  /** 한 번에: 표 글 → 칠할 결과 (ds 는 analyze 결과를 다시 쓸 때 넘긴다) */
  function build(D, levels, text, opt, sidoShort, ds) {
    ds = ds || analyze(readTable(text));
    const res = resolve(D, ds, levels, sidoShort, opt.mappings);
    const col = colorize(ds, res, opt);
    return Object.assign(col, { ds, matched: res.matched, unmatched: res.unmatched, ambiguous: res.ambiguous, recs: res.recs });
  }

  return { PALETTES, CATEGORY, ramp, readTable, analyze, matcher, resolve, colorize, build, breaks, fmt, compact, defaultBy, fromStats, fromPins, valueOf, LEVEL_ORDER };
});
