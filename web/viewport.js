/* 화면 보기 범위. 저장되는 지도 구성과는 별도로 관리한다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KRMapViewport = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function full(scene) { return [0, 0, scene.width, scene.height]; }
  // 멀리 흩어진 섬 때문에 주된 육지가 작아질 때만 가장 큰 육지에 맞춘다.
  function regionBounds(polygons, fallback) {
    let largest=null,area=0;
    for (const polygon of polygons) {
      const ring=polygon[0];
      if (!ring?.length) continue;
      let sum=0;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++) sum+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];
      if(Math.abs(sum)>area){area=Math.abs(sum);largest=ring;}
    }
    if(!largest)return fallback;
    const b=[Infinity,Infinity,-Infinity,-Infinity];
    for(const [x,y] of largest){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}
    return Math.max(b[2]-b[0],b[3]-b[1]) < Math.max(fallback[2]-fallback[0],fallback[3]-fallback[1])*.45 ? b : fallback;
  }
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
  return {full,focus,zoom,regionBounds};
});
