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
console.log(count+'개 인포그래픽 검사 통과');
