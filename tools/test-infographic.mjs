import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as K from './core.mjs';
const {D,stats}=K.loadData();
const spec={regions:['서울','부산','대전','세종'],hideOthers:true,title:'데이터 지도 예시 · 가상 수치',data:{table:'지역\t가격\t후보 A\t후보 B\n서울\t80\t40\t50\n부산\t30\t60\t30\n대전\t50\t45\t45\n세종\t0\t\t20',by:'가격'},infographic:{arrows:{enabled:true,first:'후보 A',second:'후보 B',unit:'%p'},bars:{enabled:true,columns:['후보 A','후보 B'],unit:'%',title:'후보별 비교 · 가상 수치'}}};
const {S,bigText}=await K.specToState(D,spec,{stats});
const ctx=K.St.createContext({stats,bigText,emdReady:true});
let count=0;const test=async(name,fn)=>{await fn();console.log('ok infographic '+(++count)+' '+name);};
await test('독립 색상·양방향 화살표·빈 값·동률',()=>{
 const sc=K.St.buildScene(D,S,ctx,800),ar=sc.lines.filter(l=>l.group==='annotation'&&l.lv);
 assert.equal(ar.length,2);assert.equal(ar.find(l=>l.id==='11').stroke,'#DB424D');assert.equal(ar.find(l=>l.id==='26').stroke,'#168CCD');
 assert.ok(sc.texts.some(t=>t.text==='자료 없음'));assert.ok(sc.texts.some(t=>t.text==='0%')===false);
 const svg=K.R.toSVG(sc,{interactive:true});assert.ok(svg.includes('data-k="sido:11"'));assert.ok(!/NaN|Infinity/.test(svg));
});
await test('제외·수치 검증·저장 복원',()=>{
 const st=K.St.mergeState(K.St.defaultState(),JSON.parse(K.St.serialize(S)));st.excluded=['sido:11'];
 let sc=K.St.buildScene(D,st,ctx,800);assert.equal(sc.lines.filter(l=>l.group==='annotation'&&l.lv).length,1);
 st.infographic={bars:{enabled:true,columns:[]}};assert.throws(()=>K.St.buildScene(D,st,ctx,800),/1~6/);
 st.infographic={arrows:{enabled:true,first:'없음',second:'후보 B'}};assert.throws(()=>K.St.buildScene(D,st,ctx,800),/숫자 열/);
});
await test('이동 후 화살표 동반 이동',()=>{
 const st=K.St.mergeState(K.St.defaultState(),JSON.parse(K.St.serialize(S)));st.offsets['sido:11']=[100,200];
 const sc=K.St.buildScene(D,st,ctx,800),l=sc.lines.find(l=>l.lv==='sido'&&l.id==='11'&&l.group==='annotation');
 const p=sc.projectPoint(D.sido['11'].lp.map((v,i)=>v+[100,200][i]));
 assert.ok(Math.abs((l.lines[0][0][0]+l.lines[0][1][0])/2-p[0]-12)<1e-6);
});
await test('육각 격자 맞춤·충돌 방지',()=>{
 const st=K.St.defaultState();st.mode='all';st.allLv='sido';st.layout='hex';const sc=K.St.buildScene(D,st,ctx,800),L=sc.tileGrid,key=Object.keys(L.cells)[0];
 let r=K.R.snapOffset(D,sc,key,[L.c*12.1,L.c*8],[0,0],1);assert.equal(r.neighbor,'grid');
 const other=Object.keys(L.cells)[1],delta=L.cells[other].map((v,i)=>v-L.cells[key][i]);r=K.R.snapOffset(D,sc,key,delta,[0,0],1);assert.deepEqual(r.offset,[0,0]);
});
await test('확대 창 화살표·SVG·PNG·PPTX 저장',async()=>{
 const st=K.St.defaultState();st.mode='all';st.allLv='si';st.insets=['서울'];st.data={...st.data,source:'table',text:'지역\tA\tB\n서울 종로구\t20\t50'};st.infographic={arrows:{enabled:true,first:'A',second:'B'}};
 const sc=K.St.buildScene(D,st,ctx,800);assert.ok(sc.lines.some(l=>l.group==='annotation'&&!l.lv));
 const result=await K.renderSpec(spec,{formats:['svg','png','pptx'],out:'out/infographic-test'});assert.equal(result.files.length,3);result.files.forEach(f=>assert.ok(fs.statSync(f).size>100));
});
await test('도트 스타일·색 보존·작업 복원·배경 숨김',()=>{
 const st=K.St.mergeState(K.St.defaultState(),JSON.parse(K.St.serialize(S)));st.look='dots';
 assert.equal(K.St.lookId('도트'),'dots');
 const sc=K.St.buildScene(D,st,ctx,800),dots=sc.polys.filter(p=>p.group==='dots');
 assert.ok(dots.length>=4);assert.ok(dots.some(p=>p.rings.length>10));
 assert.ok(!dots.some(p=>p.sourceGroup==='context'));assert.ok(!sc.polys.some(p=>p.group==='shadow'));
 for(const p of dots){const original=sc.polys.find(q=>q.lv===p.lv&&q.id===p.id&&q.group===p.sourceGroup);assert.equal(p.fill,original.fill);assert.equal(original.fillOpacity,0);}
 assert.ok(K.R.toSVG(sc,{interactive:true}).includes('id="도트" pointer-events="none"'));
 assert.ok(sc.texts.filter(t=>t.lv).every(t=>t.halo));
 assert.equal(K.St.mergeState(K.St.defaultState(),JSON.parse(K.St.serialize(st))).look,'dots');
});
await test('도트 출력·작은 섬 보존',async()=>{
 const st=K.St.defaultState();st.target={lv:'si',id:'47940'};st.depth=0;st.context=false;st.look='dots';
 const sc=K.St.buildScene(D,st,ctx,800),dot=sc.polys.find(p=>p.group==='dots'&&p.id==='47940');
 assert.ok(dot&&dot.rings.length>0);assert.ok(!/NaN|Infinity/.test(K.R.toSVG(sc)));
 const files=(await K.renderSpec({...spec,look:'도트'},{formats:['svg','png','pptx'],out:'out/dots-test'})).files;
 assert.equal(files.length,3);assert.ok(fs.readFileSync(files.find(f=>f.endsWith('.svg')),'utf8').includes('id="도트"'));
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(fs.readFileSync(files.find(f=>f.endsWith('.pptx'))));
 const xml=await zip.file('ppt/slides/slide1.xml').async('string');assert.ok(xml.includes('도트'));assert.ok(!xml.includes('<p:pic>'));
});
await test('읍면동당 점 하나·대표 위치·수치 색 보존',()=>{
 const st=K.St.defaultState();st.target={lv:'sido',id:'30'};st.inner='emd';st.depth=0;st.context=false;st.look='regionDots';
 const ids=K.R.featuresInside(D,'sido','30','emd');st.data={...st.data,source:'table',text:'코드\t값\n'+ids.map((id,i)=>id+'\t'+i).join('\n')};
 const sc=K.St.buildScene(D,st,ctx,800),points=sc.polys.filter(p=>p.group==='dots'&&p.lv==='emd');assert.equal(points.length,ids.length);
 assert.equal(new Set(points.map(p=>p.id)).size,ids.length);assert.ok(new Set(points.map(p=>p.fill)).size>1);
 for(const p of points){assert.ok(p.circle);assert.deepEqual([p.circle.cx,p.circle.cy],sc.projectPoint(D.emd[p.id].lp));}
 assert.equal(K.St.lookId('지역별 점'),'regionDots');
});
await test('제주 기본 선택은 43개 읍면동·시군구 선택 존중',()=>{
 const st=K.St.defaultState();st.target={lv:'sido',id:'50'};st.look='regionDots';st.context=false;
 assert.equal(K.St.needsEmd(st),true);assert.equal(K.St.innerFor(D,st,st.target),'emd');
 let sc=K.St.buildScene(D,st,ctx,800);const points=sc.polys.filter(p=>p.group==='dots'&&p.lv==='emd');
 assert.equal(points.length,43);assert.ok(points.some(p=>p.name.includes('추자면')));assert.ok(points.some(p=>p.name.includes('우도면')));
 assert.ok(sc.polys.some(p=>p.group==='inner'&&p.fillOpacity>0&&p.fillOpacity<.1));
 st.inner='si';sc=K.St.buildScene(D,st,ctx,800);assert.equal(sc.polys.filter(p=>p.group==='dots'&&p.lv==='si').length,2);
});
await test('전국 도트 표시·기본 색 대비',()=>{
 const st=K.St.defaultState();st.mode='all';st.allLv='sido';st.look='dots';
 const sc=K.St.buildScene(D,st,ctx,800),dots=sc.polys.filter(p=>p.group==='dots'&&p.lv==='sido');
 assert.ok(dots.length>=16);assert.ok(dots.every(p=>p.fill===st.colors.target));
 assert.ok(dots.some(p=>p.rings.length>100));assert.ok(!/NaN|Infinity/.test(K.R.toSVG(sc)));
});
console.log(count+'개 인포그래픽 검사 통과');
