/*
 * scene(render.js) → PowerPoint 슬라이드 한 장. 지역 하나하나가 편집할 수 있는 도형이 된다.
 * 브라우저(window.PptxGenJS)와 Node(npm pptxgenjs) 양쪽에서 쓴다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapPptx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * PptxGenJS 생성자, scene, {footnote} → pptx (write() 로 파일을 만든다)
   * 슬라이드는 16:9 (13.333 x 7.5 인치), 지도는 여백 안에 맞춰 넣는다.
   */
  function buildPptx(PptxGenJS, scene, opt) {
    opt = opt || {};
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = scene.title;
    const slide = pptx.addSlide();
    const SW = 13.333, SH = 7.5, M = 0.35;
    const k = Math.min((SW - 2 * M) / scene.width, (SH - 2 * M - 0.2) / scene.height); // px → inch
    const ox = (SW - scene.width * k) / 2, oy = (SH - 0.2 - scene.height * k) / 2;
    const hex = (c) => c.replace("#", "").toUpperCase();
    const r3 = (v) => Math.round(v * 10000) / 10000;
    if (scene.bg) slide.background = { color: hex(scene.bg) };

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
    const ORDERG = ["context", "all", "neighbor", "shadow", "picked", "inner", "target", "sido", "pin", "legend"];
    const sh = scene.shadow;
    for (const g of ORDERG) {
      for (const p of scene.polys.filter((q) => q.group === g)) {
        shape([].concat(...p.rings), true, {
          fill: { color: hex(p.fill) },
          line: p.stroke ? { color: hex(p.stroke), width: Math.max(p.width * k * 72, 0.25) } : { type: "none" },
          objectName: g === "shadow" ? "그림자 " + p.name : p.name,
          shadow: g === "shadow" && sh
            ? { type: "outer", angle: 90, blur: Math.round(sh.blur * k * 72 * 2), offset: Math.round(sh.dy * k * 72 * 10) / 10, color: hex(sh.color), opacity: sh.opacity }
            : undefined,
        });
      }
      for (const l of scene.lines.filter((q) => q.group === g)) {
        if (!l.lines.length) continue;
        shape(l.lines, false, { line: { color: hex(l.stroke), width: Math.max(l.width * k * 72, 0.25) }, objectName: g === "sido" ? "시도 경계" : "경계선" });
      }
    }
    for (const t of scene.texts) {
      const w = (t.text.length + 1) * t.size * k * 1.1, h = t.size * k * 1.5;
      const left = t.anchor === "start";
      slide.addText(t.text, {
        x: r3(ox + t.x * k - (left ? 0 : w / 2)), y: r3(oy + t.y * k - h / 2), w: r3(w), h: r3(h), align: left ? "left" : "center",
        fontFace: "맑은 고딕", fontSize: Math.max(Math.round(t.size * k * 72 * 10) / 10, 4), bold: t.weight >= 600,
        color: hex(t.fill), valign: "middle", margin: 0,
        outline: t.halo ? { color: "FFFFFF", size: Math.max(t.size * k * 72 * 0.08, 0.5) } : undefined,
        objectName: "지명 " + t.text,
      });
    }
    if (opt.footnote) slide.addText(opt.footnote, {
      x: SW - 6.2, y: SH - 0.32, w: 6, h: 0.22, fontFace: "맑은 고딕", fontSize: 7, color: "8A96A3", align: "right", margin: 0,
    });
    return pptx;
  }
  return { buildPptx };
});
