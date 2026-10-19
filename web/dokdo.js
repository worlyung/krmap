/* 울릉군에 포함된 독도 도형으로 만드는 화면용 작은 확대 상자. */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.KRMapDokdo=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function geometry(polygons) {
    // base 데이터의 10m 격자 좌표. 울릉도와 떨어진 동쪽 두 도형을 보존한다.
    const islands=polygons.filter(p=>p[0]?.length && p[0].every(([x])=>x>64000));
    if(!islands.length)return null;
    const b=[Infinity,Infinity,-Infinity,-Infinity];
    for(const p of islands)for(const r of p)for(const [x,y] of r){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}
    return {islands,bounds:b,center:[(b[0]+b[2])/2,(b[1]+b[3])/2]};
  }
  function svg(g) {
    const [x0,y0,x1,y1]=g.bounds,pad=Math.max(x1-x0,y1-y0)*.2;
    const paths=g.islands.map(p=>`<path d="${p.map(r=>'M'+r.map(v=>v.join(',')).join('L')+'Z').join('')}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0-pad} ${y0-pad} ${x1-x0+pad*2} ${y1-y0+pad*2}" role="img" aria-label="독도 두 섬 확대 지도"><g fill="#3361e0" stroke="white" stroke-width="1" fill-rule="evenodd">${paths}</g></svg>`;
  }
  return {geometry,svg};
});
