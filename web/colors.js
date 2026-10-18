/*
 * 색 하나로 지도 색 조합 만들기. OKLCH(사람 눈에 고른 밝기·채도·색상)로 계산한다.
 * 브라우저(window.KRMapColors)와 Node(require) 양쪽에서 쓴다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapColors = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // ---- sRGB ↔ OKLab ↔ OKLCH ----
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function hexToRgb(h) {
    let s = String(h).replace("#", "").trim();
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    const n = parseInt(s, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  function rgbToOklch(rgb) {
    const [r, g, b] = rgb.map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
  }
  function oklchToRgb([L, C, H]) {
    const h = (H * Math.PI) / 180, A = C * Math.cos(h), B = C * Math.sin(h);
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(toGam);
  }
  const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
  /** OKLCH → hex. 화면에 못 나오는 색이면 채도만 줄여서 맞춘다 (밝기·색상은 그대로) */
  function oklch(L, C, H) {
    let c = C;
    let rgb = oklchToRgb([L, c, H]);
    for (let i = 0; i < 24 && !inGamut(rgb); i++) { c *= 0.9; rgb = oklchToRgb([L, c, H]); }
    return rgbToHex(rgb);
  }
  const lch = (hex) => rgbToOklch(hexToRgb(hex));

  /**
   * 기준 색 하나 → 지도 색 조합 (state.colors 와 같은 모양)
   * dark: true 면 어두운 바탕용
   */
  function themeFrom(base, opt) {
    opt = opt || {};
    const [L0, C0, H] = lch(base);
    const C = Math.max(C0, 0.04);
    if (opt.dark) {
      return {
        name: null, base: rgbToHex(hexToRgb(base)),
        target: oklch(Math.min(Math.max(L0, 0.72), 0.82), Math.max(C, 0.12), H),
        neighbor: oklch(0.38, Math.min(C * 0.45, 0.08), H),
        context: oklch(0.27, 0.025, H),
        line: oklch(0.2, 0.03, H),
        sidoLine: oklch(0.52, 0.04, H),
        text: oklch(0.95, 0.012, H),
        bg: oklch(0.2, 0.03, H),
        fillBg: true,
      };
    }
    return {
      name: null, base: rgbToHex(hexToRgb(base)),
      target: oklch(Math.min(Math.max(L0, 0.5), 0.66), Math.max(C, 0.1), H),
      neighbor: oklch(0.88, Math.min(C * 0.38, 0.065), H),
      context: oklch(0.955, 0.012, H),
      line: "#FFFFFF",
      sidoLine: oklch(0.72, 0.03, H),
      text: oklch(0.26, 0.03, H),
      bg: "#FFFFFF",
    };
  }
  /**
   * 한 가지 색의 단계 (데이터 색칠용 stops 4개). 작은 값 → 큰 값.
   * 밝은 바탕: 옅음 → 진함, 어두운 바탕: 바탕에 묻히는 어두움 → 밝음 (큰 값이 눈에 띄게)
   */
  function rampStops(base, opt) {
    const [, C0, H] = lch(base);
    const C = Math.max(C0, 0.08);
    if (opt && opt.dark) return [oklch(0.34, C * 0.35, H), oklch(0.5, C * 0.7, H), oklch(0.68, C, H), oklch(0.86, C * 0.6, H)];
    return [oklch(0.95, C * 0.18, H), oklch(0.8, C * 0.6, H), oklch(0.6, C, H), oklch(0.36, C * 0.75, H)];
  }
  /** 짝이 되는 색상: 차가운 색에는 따뜻한 주홍, 따뜻한 색에는 파랑 (정반대보다 보기 좋은 짝) */
  const partnerHue = (H) => (H >= 150 && H < 330 ? 32 : 258);
  /** 기준 색 ↔ 짝 색, 가운데 무채색 (증감 · 찬반) */
  function divergingStops(base, opt) {
    const [, C0, H] = lch(base);
    const C = Math.max(C0, 0.1), H2 = partnerHue(H);
    if (opt && opt.dark) return [oklch(0.8, C * 0.7, H), oklch(0.58, C * 0.6, H), oklch(0.36, 0.01, H), oklch(0.58, C * 0.6, H2), oklch(0.8, C * 0.7, H2)];
    return [oklch(0.42, C * 0.9, H), oklch(0.75, C * 0.5, H), oklch(0.93, 0.008, H), oklch(0.75, C * 0.5, H2), oklch(0.42, C * 0.9, H2)];
  }
  /** 바탕이 어두운가 (상대 휘도) */
  function isDark(hex) {
    if (!hex) return false;
    const [r, g, b] = hexToRgb(hex).map(toLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
  }
  // 추천: 색상환을 고르게 돌며 지도에 잘 맞는 밝기·채도로 고른 기준 색들
  const SUGGEST = [
    "#2F6FEB", "#E4572E", "#13A07F", "#7A5AF0", "#C2410C", "#0E7490",
    "#BE185D", "#4D7C0F", "#1D4ED8", "#B45309", "#6D28D9", "#047857",
  ];
  /** i 번째 추천 색 (또는 seed 가 없으면 무작위) */
  function suggest(i) {
    const n = i == null ? Math.floor(Math.random() * SUGGEST.length) : ((i % SUGGEST.length) + SUGGEST.length) % SUGGEST.length;
    return SUGGEST[n];
  }
  return { oklch, lch, hexToRgb, rgbToHex, themeFrom, rampStops, divergingStops, partnerHue, isDark, suggest, SUGGEST };
});
