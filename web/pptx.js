/*
 * scene(render.js) → PowerPoint 슬라이드 한 장. 지역 하나하나가 편집할 수 있는 도형이 된다.
 * 브라우저(window.PptxGenJS)와 Node(npm pptxgenjs) 양쪽에서 쓴다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapPptx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * PptxGenJS 생성자, scene(또는 scene 목록), {footnote(또는 목록)} → pptx (write() 로 파일을 만든다)
   * 지도 한 장이 슬라이드 한 장. 슬라이드는 16:9 (13.333 x 7.5 인치), 지도는 여백 안에 맞춰 넣는다.
   */
  function buildPptx(PptxGenJS, scenes, opt) {
    opt = opt || {};
    const list = Array.isArray(scenes) ? scenes : [scenes];
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = opt.title || list[0].title;
    // backgrounds[i]: 그라데이션 바탕 그림 ("image/png;base64,…", 슬라이드 비율로 그린 것)
    list.forEach((scene, i) => addSlide(pptx, scene, Array.isArray(opt.footnote) ? opt.footnote[i] : opt.footnote, opt.backgrounds && opt.backgrounds[i]));
    return pptx;
  }
  function addSlide(pptx, scene, footnote, bgImage) {
    const slide = pptx.addSlide();
    const SW = 13.333, SH = 7.5, M = 0.35;
    const k = Math.min((SW - 2 * M) / scene.width, (SH - 2 * M - 0.2) / scene.height); // px → inch
    const ox = (SW - scene.width * k) / 2, oy = (SH - 0.2 - scene.height * k) / 2;
    const hex = (c) => c.replace("#", "").toUpperCase();
    const r3 = (v) => Math.round(v * 10000) / 10000;
    if (bgImage) slide.background = { data: bgImage };
    else if (scene.bg) slide.background = { color: hex(scene.bg) };

    const shape = (rings, closed, o) => {
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
      }, o));
    };
    const ORDERG = ["context", "extrude", "all", "neighbor", "shadow", "picked", "inner", "target", "sido", "bubble", "leader", "inset", "dots", "pin", "legend", "annotation"];
    const sh = scene.shadow;
    const lineOf = (stroke, width, op) => {
      const l = { color: hex(stroke), width: Math.max(width * k * 72, 0.25) };
      if (op != null) l.transparency = Math.round((1 - op) * 100);
      return l;
    };
    // 네온은 같은 색 그림자를 0 거리에 번지게(빛), 소프트는 오른쪽 아래 그늘로
    const effect = (p) => {
      if (p.glow && scene.glow) return { type: "outer", angle: 0, offset: 0, blur: Math.max(Math.round(scene.glow.blur * k * 72 * 2.5), 2), color: hex(scene.glow.color), opacity: 0.85 };
      if (p.soft && scene.soft) return { type: "outer", angle: 45, offset: Math.max(Math.round(scene.soft.d * k * 72 * 10) / 10, 1), blur: Math.max(Math.round(scene.soft.blur * k * 72 * 2), 2), color: hex(scene.soft.dark), opacity: 0.6 };
      return undefined;
    };
    for (const g of ORDERG) {
      for (const p of scene.polys.filter((q) => q.group === g)) {
        const fill = { color: hex(p.fill) };
        if (p.fillOpacity != null) fill.transparency = Math.round((1 - p.fillOpacity) * 100);
        if (p.circle) {
          // 원은 PowerPoint 의 원 도형으로 (크기·색을 바로 바꿀 수 있게)
          const c = p.circle;
          slide.addShape(pptx.ShapeType.ellipse, {
            x: r3(ox + (c.cx - c.r) * k), y: r3(oy + (c.cy - c.r) * k), w: r3(2 * c.r * k), h: r3(2 * c.r * k), fill,
            line: p.stroke ? lineOf(p.stroke, p.width, p.strokeOpacity) : { type: "none" }, objectName: p.name, shadow: effect(p),
          });
          continue;
        }
        shape([].concat(...p.rings), true, {
          fill,
          line: p.stroke ? lineOf(p.stroke, p.width, p.strokeOpacity) : { type: "none" },
          objectName: g === "shadow" ? "그림자 " + p.name : g === "extrude" ? "입체 " + p.name : p.name,
          shadow: g === "shadow" && sh
            ? { type: "outer", angle: 90, blur: Math.round(sh.blur * k * 72 * 2), offset: Math.round(sh.dy * k * 72 * 10) / 10, color: hex(sh.color), opacity: sh.opacity }
            : effect(p),
        });
      }
      for (const l of scene.lines.filter((q) => q.group === g)) {
        if (!l.lines.length) continue;
        shape(l.lines, false, { line: lineOf(l.stroke, l.width, l.strokeOpacity), shadow: effect(l), objectName: g === "sido" ? "시도 경계" : g === "leader" ? "지시선" : g === "inset" ? "확대 범위" : "경계선" });
      }
    }
    for (const t of scene.texts) {
      const w = (t.text.length + 1) * t.size * k * 1.1, h = t.size * k * 1.5;
      const left = t.anchor === "start", right = t.anchor === "end";
      slide.addText(t.text, {
        x: r3(ox + t.x * k - (left ? 0 : right ? w : w / 2)), y: r3(oy + t.y * k - h / 2), w: r3(w), h: r3(h), align: left ? "left" : right ? "right" : "center",
        fontFace: "맑은 고딕", fontSize: Math.max(Math.round(t.size * k * 72 * 10) / 10, 4), bold: t.weight >= 600,
        color: hex(t.fill), valign: "middle", margin: 0,
        // 테두리 대신 은은한 빛(glow)으로 글자 뒤를 밝힌다 — 글자 획이 가늘어지지 않는다
        glow: t.halo ? { size: Math.max(Math.round(t.size * k * 72 * 0.35), 2), opacity: 0.9, color: hex(t.haloColor || "#FFFFFF") } : undefined,
        objectName: (t.callout ? "지시선 이름 " : "지명 ") + t.text,
      });
    }
    if (footnote) slide.addText(footnote, {
      x: SW - 6.2, y: SH - 0.32, w: 6, h: 0.22, fontFace: "맑은 고딕", fontSize: 7, color: "8A96A3", align: "right", margin: 0,
    });
  }
  return { buildPptx };
});
