/* 화면 보기 범위. 저장되는 지도 구성과는 별도로 관리한다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapViewport = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function full(scene) { return [0, 0, scene.width, scene.height]; }
  function focus(scene, bounds) {
    if (!bounds) return full(scene);
    const [x0,y0,x1,y1] = bounds;
    const zoom = Math.max(1, Math.min(16, scene.width / Math.max(1,(x1-x0)*1.8), scene.height / Math.max(1,(y1-y0)*1.8)));
    const w=scene.width/zoom,h=scene.height/zoom;
    return [(x0+x1-w)/2,(y0+y1-h)/2,w,h];
  }
  function zoom(scene, box, factor, anchor=[.5,.5]) {
    const level=Math.max(.5,Math.min(16,scene.width/box[2]*factor));
    const w=scene.width/level,h=scene.height/level;
    return [box[0]+(box[2]-w)*anchor[0],box[1]+(box[3]-h)*anchor[1],w,h];
  }
  return {full,focus,zoom};
});
