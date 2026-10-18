/*
 * 지점 핀: 이름·주소(또는 위도·경도) 목록을 지도 좌표로 바꾸고, 어느 지역에 속하는지 찾는다.
 * - 위도·경도가 있으면 정확한 자리 (WGS84 → EPSG:5179 변환)
 * - 인터넷 주소 검색(OpenStreetMap Nominatim)을 쓸 수 있으면 그 결과
 * - 둘 다 안 되면 주소 속 시도·시군구·동 이름을 찾아 그 지역 한가운데에 대략 찍는다
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapPins = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // 데이터 좌표: EPSG:5179 를 10m 격자로 옮기고 y 를 뒤집은 값 (build_data.py 의 UNIT·X0·Y1 과 같다)
  const UNIT = 10, X0 = 740000, Y1 = 2075000;

  /** WGS84 위경도 → EPSG:5179 (UTM-K: GRS80, 중앙경선 127.5°, 원점위도 38°, 축척 0.9996, 가산 1,000,000 / 2,000,000) */
  function toUTMK(lat, lon) {
    const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lat0 = (38 * Math.PI) / 180, lon0 = (127.5 * Math.PI) / 180;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const M = (p) => a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
    const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = (l - lon0) * Math.cos(p);
    const x = 1e6 + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
    const y = 2e6 + k0 * (M(p) - M(lat0) + N * Math.tan(p) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    return [x, y];
  }
  const toData = (lat, lon) => { const [x, y] = toUTMK(lat, lon); return [(x - X0) / UNIT, (Y1 - y) / UNIT]; };

  /** "36.35, 127.38" / "36.35 127.38" / 두 칸 → [위도, 경도] (한국 범위만) */
  function latLng(cells) {
    const nums = cells.join(" ").match(/-?\d{2,3}\.\d+/g);
    if (!nums || nums.length < 2) return null;
    for (let i = 0; i + 1 < nums.length; i++) {
      let la = +nums[i], lo = +nums[i + 1];
      if (la > 100) [la, lo] = [lo, la];
      if (la > 32 && la < 39.5 && lo > 124 && lo < 132.5) return [la, lo];
    }
    return null;
  }

  /** 붙여넣은 목록 → [{name, addr, cat, ll}] (첫 줄이 머리글이면 건너뛴다) */
  function parse(text) {
    const out = [];
    const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(/\s*,\s*(?=[^,]*$)|\s*,\s*/)).map((c) => c.trim().replace(/^"|"$/g, "")).filter((c) => c !== "");
      if (!cells.length) continue;
      if (out.length === 0 && /^(이름|지점|매장|명칭|name)$/i.test(cells[0]) && /주소|위치|address|위도|lat/i.test(cells.slice(1).join(" "))) continue;
      const ll = latLng(cells);
      const text = cells.filter((c) => !/^-?\d{2,3}\.\d+$/.test(c) && !latLng([c]));
      let name, addr, cat = "";
      if (ll) { name = text[0] || `${ll[0]}, ${ll[1]}`; cat = text[1] || ""; addr = ""; }
      else if (text.length === 1) { name = text[0]; addr = text[0]; }
      else { name = text[0]; addr = text[1]; cat = text[2] || ""; }
      out.push({ name, addr, cat, ll });
    }
    return out;
  }

  // ---------- 주소 속 지역 이름으로 대략 찾기 ----------
  function aliasIndex(D, sidoShort) {
    const sido = new Map();
    const put = (k, id) => { if (k && !sido.has(k)) sido.set(k, id); };
    for (const id in D.sido) {
      const nm = D.sido[id].nm, sh = sidoShort(nm);
      put(nm, id); put(sh, id); put(sh + "시", id); put(sh + "도", id);
    }
    // 전남광주통합특별시: 예전 주소(광주광역시·전라남도)도 받아들인다
    const merged = Object.keys(D.sido).find((id) => /전남광주/.test(D.sido[id].nm));
    if (merged) ["광주", "광주광역시", "광주시", "전남", "전라남도"].forEach((k) => put(k, merged));
    if (!merged) { put("전라남도", Object.keys(D.sido).find((id) => D.sido[id].nm === "전라남도")); put("광주광역시", Object.keys(D.sido).find((id) => D.sido[id].nm === "광주광역시")); }
    put("강원도", Object.keys(D.sido).find((id) => /강원/.test(D.sido[id].nm)));
    put("전라북도", Object.keys(D.sido).find((id) => /전북/.test(D.sido[id].nm)));
    return sido;
  }
  const baseDong = (nm) => nm.replace(/(제?\d+(\.\d+)?)(가)?동$/, "동").replace(/\d+가$/, "");

  /**
   * 주소 → {key, lv, quality} : 가장 잘게 찾은 지역. 못 찾으면 null.
   * 예) "대전광역시 서구 둔산동 1420", "경기 수원시 장안구 정자동", "세종시 한누리대로 2130"
   */
  function findRegion(D, addr, sidoShort, idx) {
    const toks = String(addr).replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
    let sido = null;
    for (const t of toks.slice(0, 2)) if (idx.has(t)) { sido = idx.get(t); break; }
    // 시군구: 이름이 주소 토막과 같은 곳 (시도를 찾았으면 그 안에서)
    const inSido = (f) => !sido || f.sido === sido;
    let si = null, sgg = null;
    for (const t of toks) {
      for (const id in D.si) if (inSido(D.si[id]) && D.si[id].nm === t && !si) si = id;
      for (const id in D.sgg) {
        const f = D.sgg[id];
        if (!inSido(f) || f.nm !== t) continue;
        if (f.city && si && f.si !== si) continue;
        if (!sgg) sgg = id;
      }
    }
    if (sgg && !si) si = D.sgg[sgg].si;
    // 시군구가 하나뿐인 시도(세종)는 바로 그 시군구로
    if (sido && !si && !sgg) { const only = Object.keys(D.si).filter((id) => D.si[id].sido === sido); if (only.length === 1) si = only[0]; }
    if (si && !sgg && D.sgg[si]) sgg = si; // 구가 없는 시·군
    if (!sido && (si || sgg)) sido = (D.sgg[sgg] || D.si[si]).sido;
    // 동·읍·면
    if (D.emd && (sgg || si)) {
      const pool = Object.keys(D.emd).filter((id) => (sgg ? D.emd[id].sgg === sgg : D.emd[id].si === si));
      for (const t of toks) {
        if (!/(동|읍|면|가)$/.test(t)) continue;
        let hit = pool.find((id) => D.emd[id].nm === t) || pool.find((id) => baseDong(D.emd[id].nm) === baseDong(t));
        if (hit) return { key: "emd:" + hit, lv: "emd", quality: "동 중심" };
      }
    }
    if (sgg) return { key: "sgg:" + sgg, lv: "sgg", quality: "시군구 중심" };
    if (si) return { key: "si:" + si, lv: "si", quality: "시군구 중심" };
    if (sido) return { key: "sido:" + sido, lv: "sido", quality: "시도 중심" };
    return null;
  }

  // ---------- 좌표가 속한 지역 ----------
  function pip(rings, x, y) {
    let inside = false;
    for (const poly of rings)
      for (const r of poly)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
    return inside;
  }
  function locate(D, x, y, decode) {
    const hit = (L) => { for (const id in L) { const f = L[id]; if (x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3] && pip(decode(f), x, y)) return id; } return null; };
    const sgg = hit(D.sgg);
    if (!sgg) return null;
    const keys = { sgg: "sgg:" + sgg, si: "si:" + D.sgg[sgg].si, sido: "sido:" + D.sgg[sgg].sido };
    if (D.emd) {
      const pool = {};
      for (const id in D.emd) if (D.emd[id].sgg === sgg) pool[id] = D.emd[id];
      const e = hit(pool);
      if (e) keys.emd = "emd:" + e;
    }
    return keys;
  }
  /** 지역 key 하나에서 위 단위 key 들 */
  function keysOf(D, key) {
    const [lv, id] = key.split(":");
    const f = D[lv] && D[lv][id];
    if (!f) return {};
    const out = { [lv]: key, sido: "sido:" + f.sido };
    if (lv === "emd") { out.sgg = "sgg:" + f.sgg; out.si = "si:" + f.si; }
    if (lv === "sgg") out.si = "si:" + f.si;
    if (lv === "si" && D.sgg[id]) out.sgg = "sgg:" + id;
    return out;
  }

  /** 인터넷 주소 검색 (OpenStreetMap Nominatim, 1초에 한 번) → [위도, 경도] | null. 막혀 있으면 throw */
  async function geocodeOnline(addr) {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&accept-language=ko&q=" + encodeURIComponent(addr);
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    return j && j[0] ? [+j[0].lat, +j[0].lon] : null;
  }

  return { toUTMK, toData, parse, latLng, aliasIndex, findRegion, locate, keysOf, geocodeOnline };
});
