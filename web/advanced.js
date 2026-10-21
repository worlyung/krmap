/* 보고서·비교·연도·설명 요소. 브라우저와 Node에서 같은 장면을 만든다. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./render.js"), require("./datafill.js"), require("./infographic.js"));
  else root.KRMapAdvanced = factory(root.KRMapRender, root.KRMapData, root.KRMapInfographic);
})(typeof self !== "undefined" ? self : this, function(R, X, I) {
  const clone = s => JSON.parse(JSON.stringify(Object.assign({}, s, { labelPick: [...(s.labelPick || [])] })));
  const ink = "#23354D";
  const text = (sc, value, x, y, size, fill) => sc.texts.push({text:String(value),x,y,size,weight:500,fill:fill || ink,anchor:"start",role:"heading"});
  const rect = (sc, x,y,w,h,fill,name) => sc.polys.push({name:name || "설명", rings:[[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]]],fill,group:"annotation"});
  function column(ds, q) {
    const c = ds && ds.columns.find(c => c.id === q || c.name === q);
    if (!c || c.kind === "text") throw new Error("숫자 열을 선택하세요: " + q);
    return c;
  }
  function cuts(values, steps) {
    const nums = values.filter(v => typeof v === "number" && isFinite(v));
    if (!nums.length) throw new Error("공통 색 기준에 사용할 숫자가 없습니다");
    const n = Math.max(2,Math.min(9,steps || 5)), lo=Math.min(...nums), hi=Math.max(...nums);
    return lo === hi ? [lo] : Array.from({length:n-1},(_,i)=>lo+(hi-lo)*(i+1)/n);
  }
  function move(sc, scale, dx, dy) {
    const pt = p => [p[0]*scale+dx,p[1]*scale+dy];
    return {
      polys:sc.polys.map(p=>Object.assign({},p,{rings:p.rings.map(poly=>poly.map(r=>r.map(pt))),width:(p.width || 0)*scale,circle:p.circle ? {cx:p.circle.cx*scale+dx,cy:p.circle.cy*scale+dy,r:p.circle.r*scale}:undefined})),
      lines:sc.lines.map(l=>Object.assign({},l,{lines:l.lines.map(r=>r.map(pt)),width:l.width*scale})),
      texts:sc.texts.map(t=>Object.assign({},t,{x:t.x*scale+dx,y:t.y*scale+dy,size:t.size*scale})),
    };
  }
  function hatch(sc, p, color) {
    // 대각선과 모든 경계의 교점을 짝지어 구멍과 바다에는 그리지 않는다.
    const rings=p.rings.flat(), pts=rings.flat(), sums=pts.map(p=>p[0]+p[1]);
    const lines=[];
    for(let c=Math.min(...sums);c<=Math.max(...sums);c+=Math.max(6,sc.width/140)) {
      const hits=[];
      for(const ring of rings) for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const a=ring[j],b=ring[i],u=a[0]+a[1],v=b[0]+b[1];
        if((u<=c&&v>c)||(v<=c&&u>c)){const t=(c-u)/(v-u);hits.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
      }
      hits.sort((a,b)=>a[0]-b[0]);
      for(let i=0;i+1<hits.length;i+=2) lines.push([hits[i],hits[i+1]]);
    }
    sc.lines.push({lines,stroke:color,width:Math.max(.6,sc.width/1800),group:"annotation"});
  }
  function decorate(sc,D,S,ctx,St) {
    const dr=St.dataResult(D,S,ctx), statuses=dr && dr.statuses || {};
    for(const p of sc.polys) {
      if(p.group === "shadow" || p.group === "context")continue;
      if(statuses[p.lv+":"+p.id]==="missing") hatch(sc,p,"#9AA5B1");
    }
    const u=sc.width/1600;
    const center = key => {
      const p=sc.polys.find(p=>p.lv+":"+p.id===key && !["context","shadow"].includes(p.group));
      if(!p)throw new Error("지도에 표시된 지역을 선택하세요: "+key);
      const pts=p.rings.flat(2), xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
    };
    for(const a of S.annotations || []) {
      const color=/^#[0-9a-f]{6}$/i.test(a.color || "")?a.color:"#C23A2E";
      const pos=a.region ? center(a.region) : [Number(a.x)*sc.width,Number(a.y)*sc.height];
      if(pos.some(v=>!isFinite(v)))throw new Error("설명 위치를 확인하세요");
      if(a.type==="radius") {
        if(S.layout!=="real")throw new Error("반경 원은 실제 지도에서만 사용할 수 있습니다");
        if(!(a.km>0&&a.km<=500))throw new Error("반경은 0 초과 500km 이하로 입력하세요");
        let c=pos;
        if(a.region){const [lv,id]=a.region.split(":");c=sc.projectPoint(D[lv][id].lp);}
        const r=a.km*100*sc.scale;
        const ring=Array.from({length:65},(_,i)=>[c[0]+r*Math.cos(i*Math.PI/32),c[1]+r*Math.sin(i*Math.PI/32)]);
        sc.polys.push({name:"직선 반경 "+a.km+"km",rings:[[ring]],circle:{cx:c[0],cy:c[1],r},fill:color,fillOpacity:.08,stroke:color,width:2*u,group:"annotation"});
        text(sc,a.text || "직선 반경 "+a.km+"km",c[0]+8*u,c[1],18*u,color);
      } else if(a.type==="arrow") {
        const end=a.to ? center(a.to) : [Number(a.x2)*sc.width,Number(a.y2)*sc.height];
        if(end.some(v=>!isFinite(v)))throw new Error("화살표 끝 위치를 확인하세요");
        const ang=Math.atan2(end[1]-pos[1],end[0]-pos[0]),n=14*u;
        sc.lines.push({lines:[[pos,end],[ [end[0]-n*Math.cos(ang-.5),end[1]-n*Math.sin(ang-.5)],end,[end[0]-n*Math.cos(ang+.5),end[1]-n*Math.sin(ang+.5)] ]],stroke:color,width:3*u,group:"annotation"});
        if(a.text)text(sc,a.text,(pos[0]+end[0])/2,(pos[1]+end[1])/2-14*u,18*u,color);
      } else {
        const lines=String(a.text || "").split("\n");
        const w=Math.min(sc.width*.5,Math.max(100,Math.max(...lines.map(s=>s.length))*20))*u;
        rect(sc,pos[0]-8*u,pos[1]-16*u,w,lines.length*26*u+8*u,"#FFFFFF","설명 상자");
        lines.forEach((line,i)=>text(sc,line,pos[0],pos[1]+i*26*u,20*u,color));
      }
    }
    if(S.report && S.report.enabled) {
      const mapW=sc.width, panelW=mapW*.42, originalTitle=sc.title;
      sc.width+=panelW;
      rect(sc,mapW,0,panelW,sc.height,"#F3F6FA","보고서 요약");
      let y=40*u;
      const add=(s,size)=>{const max=Math.max(10,Math.floor((panelW-48*u)/(size*u)));for(const line of String(s).split("\n")){const chars=Array.from(line);for(let i=0;i<Math.max(1,chars.length);i+=max){text(sc,chars.slice(i,i+max).join(""),mapW+24*u,y,size*u);y+=(size+10)*u;}}};
      add(S.report.title || "주요 수치",26);
      if(dr){const nums=Object.entries(dr.nums || {}).filter(([k])=>!statuses[k]||statuses[k]==="zero").sort((a,b)=>b[1]-a[1]);add("수치가 있는 지역 "+nums.length+"곳",18);for(const [k,v] of nums.slice(0,5)){const [lv,id]=k.split(":");add(D[lv][id].full+"  "+X.fmt(v),18);}}
      if(S.report.summary)add(S.report.summary,18);
      const note=St.sourceNote(D,S,ctx);add(note,12);
      if(y>sc.height)sc.height=y+24*u;
      sc.title=originalTitle;
    }
    return I.decorate(sc,D,S,ctx,St);
  }
  function build(D,S,ctx,width,St) {
    const ds=St.dataset(D,S,ctx);
    const commonCuts = columns => {
      const res=X.resolve(D,ds,St.drawnLevels(D,S),R.sidoShort,S.mappings);
      return cuts([...St.visibleKeys(D,S)].filter(k=>!(S.excluded||[]).includes(k)&&res.recs[k]).flatMap(k=>columns.map(c=>c.get(res.recs[k]))),S.data.steps);
    };
    if(S.compare && S.compare.enabled) {
      if(!ds)throw new Error("비교할 표를 먼저 넣어 주세요");
      const a=column(ds,S.compare.before),b=column(ds,S.compare.after);
      const variants=[{t:"col",c:a.id},{t:"col",c:b.id}];
      const names=[a.name,b.name];
      if(S.compare.difference!==false){variants.push({t:"diff",a:a.id,b:b.id});names.push("증감 (후 − 전)");}
      const common=S.data.cuts && S.data.cuts.length?S.data.cuts:commonCuts([a,b]);
      const frames=variants.map((by,i)=>{const st=St.mergeState(St.defaultState(),clone(S));st.compare.enabled=false;st.timeline.enabled=false;st.report.enabled=false;st.data.by=by;st.data.labels=[];st.data.cuts=i===2?[]:common;if(i===2)st.data.palette="diverge";st.heading.title=names[i];st.aspect=1;return build(D,st,St.createContext({stats:ctx.stats,bigText:ctx.bigText,emdReady:ctx.emdReady}),800,St);});
      const out={width:width || 1600,height:0,polys:[],lines:[],texts:[],bg:S.fillBg?S.colors.bg:null,title:S.heading.title || "전후 비교",tiles:S.layout!=="real"};
      const w=out.width/frames.length,gap=12,top=60*out.width/1600;
      frames.forEach((f,i)=>{const k=(w-gap)/f.width,part=move(f,k,i*w+gap/2,top);for(const key of ["polys","lines","texts"])out[key].push(...part[key]);out.height=Math.max(out.height,f.height*k+top);});
      text(out,out.title,20,25*out.width/1600,28*out.width/1600);
      if(S.report.enabled){const st=St.mergeState(St.defaultState(),clone(S));st.annotations=[];st.infographic={};st.data.statuses=false;st.data.by={t:"col",c:b.id};return decorate(out,D,st,ctx,St);}
      return out;
    }
    let st=S;
    if(S.timeline && S.timeline.enabled && S.timeline.columns.length) {
      st=St.mergeState(St.defaultState(),clone(S));
      const cs=S.timeline.columns.map(q=>column(ds,q));
      const i=Math.max(0,Math.min(cs.length-1,S.timeline.index || 0));
      st.data.by={t:"col",c:cs[i].id};st.data.labels=[cs[i].id];
      if(!st.data.cuts.length)st.data.cuts=commonCuts(cs);
      st.heading.title=(S.heading.title?S.heading.title+" · ":"")+cs[i].name;
    }
    return decorate(R.buildScene(D,St.sceneOptions(D,st,ctx,width)),D,st,ctx,St);
  }
  function html(frames,title) {
    const payload=JSON.stringify(frames.map(f=>({label:f.label,svg:R.toSVG(f.scene)}))).replace(/</g,"\\u003c");
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>body{font-family:system-ui,sans-serif;margin:24px;background:#f5f7fa;color:#23354d}main{max-width:1200px;margin:auto}img{width:100%;background:white}input{width:70%}button{padding:10px}output{margin:12px}</style><main><h1>'+esc(title)+'</h1><label>시점 <input id="time" type="range" min="0" max="'+(frames.length-1)+'" value="0"></label><output id="label"></output><button id="play">재생</button><img id="map" alt="행정구역 지도"><p>경계는 각 그림의 출처 기준입니다. 인터넷 연결 없이 열 수 있습니다.</p></main><script>const frames='+payload+';const slider=document.getElementById("time"),label=document.getElementById("label"),map=document.getElementById("map");function show(){const f=frames[+slider.value];label.textContent=f.label;map.alt=f.label;map.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(f.svg)}slider.oninput=show;let timer;document.getElementById("play").onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent="재생"}else{this.textContent="정지";timer=setInterval(()=>{slider.value=(+slider.value+1)%frames.length;show()},1200)}};show();<\/script></html>';
  }
  return {build,clone,cuts,column,html};
});
