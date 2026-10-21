/* 표의 수치를 화살표·비교 막대로 표현한다. 실제 선거 자료는 사용자가 넣는다. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./render.js'),require('./datafill.js'));
  else root.KRMapInfographic=factory(root.KRMapRender,root.KRMapData);
})(typeof self!=='undefined'?self:this,function(R,X){
  const valid=v=>typeof v==='number'&&Number.isFinite(v);
  const color=(v,fallback)=>/^#[0-9a-f]{6}$/i.test(v||'')?v:fallback;
  function decorate(sc,D,S,ctx,St){
    const cfg=S.infographic||{}, a=cfg.arrows||{}, b=cfg.bars||{};
    if(!a.enabled&&!b.enabled)return sc;
    const ds=St.dataset(D,S,ctx);
    if(!ds)throw new Error('화살표·막대그래프에 사용할 표를 먼저 넣어 주세요');
    const col=q=>{const c=ds.columns.find(c=>c.id===q||c.name===q);if(!c||c.kind==='text')throw new Error('숫자 열을 선택하세요: '+q);return c;};
    const res=X.resolve(D,ds,St.drawnLevels(D,S),R.sidoShort,S.mappings);
    const excluded=new Set(S.excluded||[]), u=sc.width/1600;
    const regions=sc.polys.filter(p=>p.lv&&/^(all|picked|neighbor|target|inner)$/.test(p.group));
    const keys=[...new Set(regions.map(p=>p.lv+':'+p.id))].filter(k=>!excluded.has(k));
    const value=(k,c)=>res.recs[k]?c.get(res.recs[k]):null;
    const text=(s,x,y,size,fill='#23354D')=>sc.texts.push({text:String(s),x,y,size,fill,weight:500,anchor:'start',role:'heading'});
    const rect=(x,y,w,h,fill,name)=>sc.polys.push({name,rings:[[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]]],fill,group:'annotation'});
    const foot=[];
    if(a.enabled){
      const c1=col(a.first),c2=col(a.second), blue=color(a.firstColor,'#168CCD'),red=color(a.secondColor,'#DB424D');
      if(c1.id===c2.id)throw new Error('화살표 기준은 서로 다른 두 열을 선택하세요');
      const diffs=keys.map(k=>{const x=value(k,c1),y=value(k,c2);return valid(x)&&valid(y)?y-x:null;});
      const max=Math.max(0,...diffs.filter(valid).map(Math.abs));
      const scale=Number(a.scale==null?1:a.scale);
      if(!Number.isFinite(scale)||scale<.1||scale>3)throw new Error('화살표 크기는 0.1~3 사이로 입력하세요');
      for(const p of sc.polys.filter(p=>p.lv&&(/^(all|picked|neighbor|target|inner|inset)$/.test(p.group))&&!p.circle)){
        const key=p.lv+':'+p.id, x=value(key,c1),y=value(key,c2);
        if(excluded.has(key)||!valid(x)||!valid(y)||x===y||!max)continue;
        // 실제 지도에서는 지역 대표점, 확대 창·타일에서는 가장 큰 면의 중심을 쓴다.
        let center;
        if(!sc.tiles&&p.group!=='inset'&&sc.projectPoint){const off=sc.regionOffsets[key]||[0,0],lp=D[p.lv][p.id].lp;center=sc.projectPoint([lp[0]+off[0],lp[1]+off[1]]);}
        else {const area=r=>Math.abs(r.reduce((s,v,i)=>{const w=r[(i+1)%r.length];return s+v[0]*w[1]-w[0]*v[1];},0));const ring=p.rings.map(r=>r[0]).sort((r,s)=>area(s)-area(r))[0];center=[ring.reduce((s,p)=>s+p[0],0)/ring.length,ring.reduce((s,p)=>s+p[1],0)/ring.length];}
        // 지명과 수치 바로 위의 작은 화살표가 글자에 완전히 가려지지 않도록 옆에 둔다.
        if(S.labelMode!=='none')center[0]+=24*u;
        const len=50*u*scale*Math.abs(y-x)/max,dx=(y>x?1:-1)*len*.6,dy=-len*.8;
        const start=[center[0]-dx/2,center[1]-dy/2],end=[center[0]+dx/2,center[1]+dy/2],ang=Math.atan2(dy,dx),n=Math.min(6*u,len*.35);
        sc.lines.push({lv:p.group==='inset'?undefined:p.lv,id:p.id,lines:[[start,end],[[end[0]-n*Math.cos(ang-.5),end[1]-n*Math.sin(ang-.5)],end,[end[0]-n*Math.cos(ang+.5),end[1]-n*Math.sin(ang+.5)]]],stroke:y>x?red:blue,width:Math.max(.7,1.5*u),group:'annotation'});
      }
      foot.push({s:'↖ '+c1.name+' 우세',fill:blue},{s:'↗ '+c2.name+' 우세',fill:red},{s:'길이 = 두 값의 차이 · 최대 '+X.fmt(max)+' '+(a.unit||'')+' · 동률·자료 없음·제외는 표시하지 않음'});
    }
    if(b.enabled){
      const columns=(b.columns||[]).map(col);
      if(columns.length<1||columns.length>6)throw new Error('막대그래프는 숫자 열 1~6개를 선택하세요');
      const palette=['#168CCD','#DB424D','#8B63C7','#EBA438','#39A582','#697985'];
      const colors=columns.map((c,i)=>color((b.colors||[])[i],palette[i]));
      let rows=keys.map(k=>({k,values:columns.map(c=>value(k,c))}));
      if(rows.some(r=>r.values.some(v=>valid(v)&&v<0)))throw new Error('비교 막대그래프에는 0 이상의 값을 넣어 주세요');
      if(b.sort==='value')rows.sort((r,s)=>(valid(s.values[0])?s.values[0]:-Infinity)-(valid(r.values[0])?r.values[0]:-Infinity));
      const max=Math.max(1,...rows.flatMap(r=>r.values.filter(valid)));
      const x=sc.width+24*u,w=560*u,rowH=(30+columns.length*22)*u;
      sc.width+=w+48*u;sc.height=Math.max(sc.height,(80+columns.length*24)*u+rows.length*rowH);
      rect(x-12*u,0,w+24*u,sc.height,'#F7F9FC','비교 막대그래프');
      text(b.title||'지역별 비교',x,28*u,24*u);
      columns.forEach((c,i)=>text(c.name,x,58*u+i*24*u,17*u,colors[i]));
      rows.forEach((r,i)=>{const [lv,id]=r.k.split(':'),y=(84+columns.length*24)*u+i*rowH;
        text(S.styles[r.k]&&S.styles[r.k].text||D[lv][id].full,x,y,17*u);
        r.values.forEach((v,j)=>{const yy=y+(j+1)*22*u;if(valid(v))rect(x,yy-6*u,400*u*v/max,13*u,colors[j],D[lv][id].full+' '+columns[j].name);text(valid(v)?X.fmt(v)+(b.unit||''):'자료 없음',x+410*u,yy,15*u);});
      });
    }
    if(foot.length){const y=sc.height+20*u;sc.height+=(foot.length*24+26)*u;rect(0,y-12*u,sc.width,sc.height-y+12*u,'#FFFFFF','화살표 범례');foot.forEach((f,i)=>text(f.s,20*u,y+i*24*u,16*u,f.fill));}
    return sc;
  }
  return {decorate};
});
