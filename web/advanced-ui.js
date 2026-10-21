/* 추가 기능 화면. 입력은 로컬에서 처리하고 작업 설정에 함께 저장한다. */
(function(root) {
  function bind(api) {
    const {S,ctx,getD,render,saveFile,toast,waitEmd,getDeck,saveDeck}=api;
    const St=root.KRMapState,A=root.KRMapAdvanced,X=root.KRMapData,R=root.KRMapRender;
    const panel=document.createElement("section");panel.className="panel advanced-panel";panel.style.padding="18px";
    panel.innerHTML=`<h2>비교·보고서 도구</h2>
      <p class="note">표를 넣은 뒤 색 기준·비교·연도·설명 요소를 설정하세요. 작업 저장 파일에 함께 보관됩니다.</p>
      <details><summary>색 기준과 자료 상태</summary>
        <label>색 경계값 (쉼표로 구분, 예: 10,20,30)<input class="field" id="advCuts" placeholder="비우면 자동"></label>
        <div class="row"><button class="btn sm" id="advApplyCuts">색 기준 적용</button><button class="btn sm" id="advDeckCuts">묶음 전체에 같은 기준 적용</button></div>
        <label><input type="checkbox" id="advStatuses"> 자료 없음·0·제외 지역 구분</label>
        <label>분석 제외 지역<select class="field" id="advExclude"></select></label><button class="btn sm" id="advExcludeAdd">제외 추가</button><button class="btn sm" id="advExcludeClear">제외 해제</button><p class="note" id="advExcluded"></p>
      </details>
      <details><summary>지역명 연결·입력 양식</summary><button class="btn sm" id="advTemplateCSV">현재 지도 지역 CSV 양식</button><button class="btn sm" id="advMappingsClear">연결 규칙 초기화</button><div id="advMappings"></div></details>
      <details><summary>엑셀 파일 직접 열기</summary><input id="advXlsx" type="file" accept=".xlsx"><div id="advWorkbook" hidden>
        <label>시트<select class="field" id="advSheet"></select></label><label>지역 열<select class="field" id="advRegionCol"></select></label>
        <label>값 열 (여러 개 선택 가능)<select class="field" id="advValueCols" multiple size="5"></select></label><pre id="advPreview" style="max-height:180px;overflow:auto"></pre><button class="btn sm" id="advImport">이 표 사용</button></div><p class="note">첫 행은 열 이름이어야 합니다. 10MB 이하 .xlsx 지원. 수식은 엑셀에서 저장된 계산 결과를 읽습니다.</p></details>
      <details><summary>전후 비교·연도 슬라이더</summary><label>이전 값<select class="field" id="advBefore"></select></label><label>이후 값<select class="field" id="advAfter"></select></label>
        <label><input type="checkbox" id="advDiff" checked> 증감 지도 함께 표시</label><button class="btn sm" id="advCompare">전후 비교 적용</button>
        <label>연도 열 (여러 개 선택)<select class="field" id="advYears" multiple size="5"></select></label><button class="btn sm" id="advTimeline">연도 슬라이더 적용</button><button class="btn sm" id="advSingle">한 장 보기</button>
        <div id="advTimeBar" hidden><label>시점<input id="advTime" type="range" min="0" value="0"></label><output id="advTimeLabel"></output><button class="btn sm" id="advPlay">재생</button></div>
        <button class="btn sm" id="advHtml">독립형 HTML 저장</button><p class="note">비교·연도 지도는 같은 행정구역 경계로 계산합니다. 독립형 HTML에는 표시할 지도만 포함되며 인터넷 없이 열 수 있습니다.</p></details>
      <details><summary>설명 상자·화살표·직선 반경</summary><label>종류<select class="field" id="advAnnoType"><option value="text">설명 상자</option><option value="arrow">지역 간 화살표</option><option value="radius">직선 반경 원</option></select></label>
        <label>기준 지역<select class="field" id="advAnnoRegion"></select></label><label>화살표 도착 지역<select class="field" id="advAnnoTo"></select></label>
        <label><input type="checkbox" id="advFreePosition"> 설명 상자 위치 직접 지정</label><div class="row"><label>가로 %<input class="field" id="advX" type="number" min="0" max="90" value="10"></label><label>세로 %<input class="field" id="advY" type="number" min="5" max="95" value="15"></label></div>
        <label>반경 km<input class="field" type="number" min="0.1" max="500" value="10" id="advRadius"></label><label>설명 문구<input class="field" id="advAnnoText" maxlength="160"></label><label>색<input type="color" id="advAnnoColor" value="#c23a2e"></label>
        <button class="btn sm" id="advAnnoAdd">요소 추가</button><div id="advAnnoList"></div><p class="note">반경은 선택한 지역의 대표점을 기준으로 합니다. 실제 지도에서만 사용할 수 있으며, 이동시간을 뜻하지 않습니다.</p></details>
      <details><summary>데이터 화살표·비교 막대그래프</summary>
        <p class="note">지도 배경색은 ‘데이터’의 색 기준을 유지합니다. 화살표는 두 열의 차이, 막대는 선택한 열의 실제 값을 보여 줍니다.</p>
        <label><input type="checkbox" id="infoArrows">지역마다 두 값의 차이를 화살표로 표시</label>
        <label>왼쪽 위 화살표 기준<select class="field" id="infoFirst"></select></label><label>색<input type="color" id="infoFirstColor" value="#168ccd"></label>
        <label>오른쪽 위 화살표 기준<select class="field" id="infoSecond"></select></label><label>색<input type="color" id="infoSecondColor" value="#db424d"></label>
        <label>화살표 크기<input class="field" id="infoScale" type="number" min="0.1" max="3" step="0.1" value="1"></label><label>차이 단위<input class="field" id="infoArrowUnit" placeholder="예: %p" maxlength="20"></label>
        <label><input type="checkbox" id="infoBars">지도 옆에 지역별 비교 막대그래프 표시</label><label>비교할 열 (최대 6개)<select class="field" id="infoColumns" multiple size="5"></select></label>
        <label>그래프 제목<input class="field" id="infoTitle" maxlength="80" value="지역별 비교"></label><label>값 단위<input class="field" id="infoUnit" placeholder="예: %" maxlength="20"></label>
        <label>순서<select class="field" id="infoSort"><option value="region">지역 순서</option><option value="value">첫 값이 큰 순서</option></select></label>
        <button class="btn sm" id="infoApply">화살표·그래프 적용</button><button class="btn sm" id="infoClear">모두 끄기</button>
        <p class="note">빈 값은 ‘자료 없음’으로 표시합니다. 막대는 0 이상의 값만 지원하며, 합계 100%로 바꾸지 않습니다. 지역이 많으면 저장 그림의 높이가 늘어납니다. 확대 창에도 화살표가 표시됩니다.</p>
      </details>
      <details><summary>보고서 서식</summary><label><input type="checkbox" id="advReport">지도와 요약표를 한 장에 배치</label><label>요약 제목<input class="field" id="advReportTitle" value="주요 수치"></label><label>설명<textarea class="field" id="advSummary" rows="3" maxlength="1000"></textarea></label><button class="btn sm" id="advReportApply">보고서 적용</button>
        <label>서식<select class="field" id="advPresets"><option value="proposal">제안서</option><option value="results">성과보고</option></select></label><button class="btn sm" id="advPresetApply">서식 불러오기</button><label>내 서식 이름<input class="field" id="advPresetName" maxlength="60"></label><button class="btn sm" id="advPresetSave">내 서식 저장</button><p class="note">내 서식은 이 브라우저에 저장됩니다. 지도 데이터는 바꾸지 않습니다.</p></details>`;
    document.querySelector("main").appendChild(panel);
    const $=id=>document.getElementById(id);
    const option=(s,v,t)=>{const o=document.createElement("option");o.value=v;o.textContent=t;s.appendChild(o);};
    const run=fn=>async()=>{try{await fn();}catch(e){toast(e.message || "입력을 확인해 주세요");}};
    $("infoApply").onclick=run(()=>{
      const next={arrows:{enabled:$("infoArrows").checked,first:$("infoFirst").value,second:$("infoSecond").value,firstColor:$("infoFirstColor").value,secondColor:$("infoSecondColor").value,scale:+$("infoScale").value,unit:$("infoArrowUnit").value},bars:{enabled:$("infoBars").checked,columns:[...$("infoColumns").selectedOptions].map(o=>o.value),title:$("infoTitle").value,unit:$("infoUnit").value,sort:$("infoSort").value}};
      const candidate=St.mergeState(St.defaultState(),A.clone(S));candidate.infographic=next;
      St.buildScene(getD(),candidate,ctx,800);S.infographic=next;render();
    });
    $("infoClear").onclick=()=>{S.infographic=St.defaultState().infographic;render();};
    const readCuts=()=>{const t=$("advCuts").value.trim();const c=t?t.split(",").map(v=>Number(v.trim())):[];if(c.length>8||c.some((v,i)=>!isFinite(v)||(i&&v<=c[i-1])))throw new Error("경계값은 작은 수부터 서로 다르게 최대 8개를 입력하세요");return c;};
    $("advApplyCuts").onclick=run(()=>{S.data.cuts=readCuts();render();});
    $("advDeckCuts").onclick=run(()=>{const c=readCuts();if(!c.length)throw new Error("묶음에 적용할 경계값을 먼저 입력하세요");S.data.cuts=c;for(const it of getDeck())it.state.data.cuts=c.slice();saveDeck();render();toast("묶음 전체에 같은 색 기준을 적용했습니다");});
    $("advStatuses").onchange=()=>{S.data.statuses=$("advStatuses").checked;render();};
    $("advExcludeAdd").onclick=()=>{const k=$("advExclude").value;if(k&&!S.excluded.includes(k))S.excluded.push(k);S.data.statuses=true;render();};
    $("advExcludeClear").onclick=()=>{S.excluded=[];render();};
    $("advMappingsClear").onclick=()=>{S.mappings={};render();};
    $("advTemplateCSV").onclick=run(async()=>{if(St.needsEmd(S))await waitEmd();const D=getD();const rows=[["코드","지역","값"]];for(const k of St.visibleKeys(D,S)){const [lv,id]=k.split(":");rows.push([id,D[lv][id].full,""]);}const cell=v=>'"'+String(v).replace(/"/g,'""')+'"';saveFile("지역_입력양식.csv","\uFEFF"+rows.map(r=>r.map(cell).join(",")).join("\r\n"),"text/csv;charset=utf-8");});
    $("advCompare").onclick=run(()=>{if(!$("advBefore").value||!$("advAfter").value)throw new Error("숫자 열을 먼저 넣어 주세요");S.compare={enabled:true,before:$("advBefore").value,after:$("advAfter").value,difference:$("advDiff").checked};S.timeline.enabled=false;render();});
    $("advTimeline").onclick=run(()=>{const columns=[...$("advYears").selectedOptions].map(o=>o.value);if(!columns.length)throw new Error("연도 열을 선택하세요");S.timeline={enabled:true,columns,index:0};S.compare.enabled=false;render();});
    let timer=null;
    const stop=()=>{clearInterval(timer);timer=null;$("advPlay").textContent="재생";};
    $("advSingle").onclick=()=>{stop();S.compare.enabled=false;S.timeline.enabled=false;render();};
    $("advTime").oninput=()=>{S.timeline.index=+$("advTime").value;render();};
    $("advPlay").onclick=()=>{if(timer){stop();return;}$("advPlay").textContent="정지";timer=setInterval(()=>{if(!S.timeline.enabled){stop();return;}S.timeline.index=(S.timeline.index+1)%S.timeline.columns.length;render();},1200);};
    $("advHtml").onclick=run(async()=>{if(St.needsEmd(S))await waitEmd();saveFile("지도.html",A.html(St.htmlFrames(getD(),S,ctx,1200),S.heading.title || "행정구역 지도"),"text/html;charset=utf-8");});
    $("advAnnoAdd").onclick=run(()=>{const type=$("advAnnoType").value;if(type==="radius"&&S.layout!=="real")throw new Error("반경 원은 실제 지도에서만 사용할 수 있습니다");const km=+$("advRadius").value;if(type==="radius"&&!(km>0&&km<=500))throw new Error("반경은 0 초과 500km 이하입니다");const free=type==="text"&&$("advFreePosition").checked,x=+$("advX").value/100,y=+$("advY").value/100;if(free&&!(x>=0&&x<=.9&&y>=.05&&y<=.95))throw new Error("설명 위치 범위를 확인하세요");S.annotations.push({type,region:free?null:$("advAnnoRegion").value,x,y,to:$("advAnnoTo").value,km,text:$("advAnnoText").value,color:$("advAnnoColor").value});render();});
    $("advReportApply").onclick=()=>{S.report={enabled:$("advReport").checked,title:$("advReportTitle").value,summary:$("advSummary").value};render();};
    const store="krmap.report.templates.v1";
    let presets={};try{presets=JSON.parse(localStorage.getItem(store)||"{}");}catch(e){/* 브라우저 저장소 제한 */}
    const presetOptions=()=>{const s=$("advPresets");s.replaceChildren();option(s,"proposal","제안서");option(s,"results","성과보고");Object.keys(presets).forEach(k=>option(s,"custom:"+k,k));};presetOptions();
    $("advPresetSave").onclick=run(()=>{const name=$("advPresetName").value.trim();if(!name)throw new Error("서식 이름을 입력하세요");Object.defineProperty(presets,name,{value:{report:{...S.report},colors:{...S.colors},fontScale:S.fontScale,aspect:S.aspect},enumerable:true,configurable:true,writable:true});localStorage.setItem(store,JSON.stringify(presets));presetOptions();toast("내 서식을 저장했습니다");});
    $("advPresetApply").onclick=()=>{const key=$("advPresets").value;if(key.startsWith("custom:"))Object.assign(S,presets[key.slice(7)],{report:{...presets[key.slice(7)].report},colors:{...presets[key.slice(7)].colors}});else{S.report={enabled:true,title:key==="results"?"성과 요약":"사업 대상 지역",summary:""};S.colors={...St.PRESETS[key==="results"?2:0]};S.aspect=4/3;}render();};
    let workbook=[],sheetRows=[];
    const sheetChanged=()=>{sheetRows=workbook[+$("advSheet").value].data;for(const id of ["advRegionCol","advValueCols"])$(id).replaceChildren();(sheetRows[0] || []).forEach((h,i)=>{option($("advRegionCol"),i,String(h || "열 "+(i+1)));option($("advValueCols"),i,String(h || "열 "+(i+1)));if(i)$("advValueCols").lastChild.selected=true;});$("advPreview").textContent=sheetRows.slice(0,6).map(r=>r.join(" | ")).join("\n");};
    $("advSheet").onchange=sheetChanged;
    $("advXlsx").onchange=run(async()=>{const file=$("advXlsx").files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error("10MB 이하 파일을 선택하세요");if(!root.readXlsxFile)await new Promise((ok,fail)=>{const s=document.createElement("script");s.src="vendor/read-excel-file.min.js";s.onload=ok;s.onerror=()=>fail(new Error("엑셀 읽기 도구를 불러오지 못했습니다"));document.head.appendChild(s);});workbook=await root.readXlsxFile(file);if(!workbook.length)throw new Error("빈 엑셀 파일입니다");$("advSheet").replaceChildren();workbook.forEach((s,i)=>option($("advSheet"),i,s.sheet));$("advWorkbook").hidden=false;sheetChanged();});
    $("advImport").onclick=run(()=>{const ri=+$("advRegionCol").value,vs=[...$("advValueCols").selectedOptions].map(o=>+o.value).filter(i=>i!==ri);if(!vs.length)throw new Error("값 열을 하나 이상 선택하세요");const head=sheetRows[0],cols=[ri,...vs],cell=v=>String(v==null?"":v).replace(/[\t\r\n]/g," ");S.data.text=[[ /코드|code/i.test(head[ri])?"코드":"지역",...vs.map(i=>head[i])],...sheetRows.slice(1).map(r=>cols.map(i=>r[i]))].map(r=>r.map(cell).join("\t")).join("\n");S.data.file="";ctx.bigText="";S.data.source="table";S.data.by=null;S.compare.enabled=false;S.timeline.enabled=false;$("dataText").value=S.data.text;render();toast("엑셀 표를 적용했습니다");});
    let regionSig="",colSig="",matchSig="";
    function refresh() {
      const D=getD(),ds=St.dataset(D,S,ctx),dr=St.dataResult(D,S,ctx);
      $("advCuts").value=(S.data.cuts||[]).join(",");$("advStatuses").checked=!!S.data.statuses;
      $("advExcluded").textContent="제외: "+S.excluded.map(k=>{const [lv,id]=k.split(":");return D[lv]&&D[lv][id]?D[lv][id].full:k;}).join(", ");
      const keys=[...St.visibleKeys(D,S)].filter(k=>{const [lv,id]=k.split(":");return D[lv]&&D[lv][id];});
      const rs=keys.join();if(rs!==regionSig){regionSig=rs;for(const id of ["advExclude","advAnnoRegion","advAnnoTo"]){const el=$(id);el.replaceChildren();keys.forEach(k=>{const [lv,i]=k.split(":");option(el,k,D[lv][i].full);});}}
      const nums=ds?ds.columns.filter(c=>c.kind!=="text"):[],cs=JSON.stringify(nums.map(c=>[c.id,c.name]));
      if(cs!==colSig){colSig=cs;for(const id of ["advBefore","advAfter","advYears","infoFirst","infoSecond","infoColumns"]){$(id).replaceChildren();nums.forEach(c=>option($(id),c.id,c.name));}if(nums.length>1){$("advAfter").selectedIndex=1;$("infoSecond").selectedIndex=1;}}
      const ia=S.infographic.arrows||{},ib=S.infographic.bars||{};
      $("infoArrows").checked=!!ia.enabled;$("infoBars").checked=!!ib.enabled;
      for(const [id,v] of [["infoFirst",ia.first],["infoSecond",ia.second]])if(v){const c=nums.find(c=>c.id===v||c.name===v);$(id).value=c?c.id:'';}
      for(const [id,v] of [["infoScale",ia.scale||1],["infoArrowUnit",ia.unit||''],["infoFirstColor",ia.firstColor||'#168ccd'],["infoSecondColor",ia.secondColor||'#db424d'],["infoTitle",ib.title||'지역별 비교'],["infoUnit",ib.unit||''],["infoSort",ib.sort||'region']])$(id).value=v;
      for(const o of $("infoColumns").options)o.selected=(ib.columns||[]).includes(o.value)||(ib.columns||[]).includes(o.textContent);
      if(S.compare.enabled){for(const [id,q] of [["advBefore",S.compare.before],["advAfter",S.compare.after]]){const c=nums.find(c=>c.id===q||c.name===q);if(c)$(id).value=c.id;}$("advDiff").checked=S.compare.difference;}
      if(S.timeline.enabled)for(const o of $("advYears").options)o.selected=S.timeline.columns.includes(o.value)||S.timeline.columns.includes(o.textContent);
      $("advTimeBar").hidden=!S.timeline.enabled;$("advTime").max=Math.max(0,S.timeline.columns.length-1);$("advTime").value=S.timeline.index;const current=nums.find(c=>c.id===S.timeline.columns[S.timeline.index]||c.name===S.timeline.columns[S.timeline.index]);$("advTimeLabel").textContent=current?current.name:"";
      $("advReport").checked=S.report.enabled;$("advReportTitle").value=S.report.title;$("advSummary").value=S.report.summary;
      $("advAnnoList").replaceChildren();S.annotations.forEach((a,i)=>{const row=document.createElement("p");row.textContent=(i+1)+". "+a.type+" "+(a.text||a.km+"km")+" ";const b=document.createElement("button");b.className="btn sm";b.textContent="삭제";b.onclick=()=>{S.annotations.splice(i,1);render();};row.appendChild(b);$("advAnnoList").appendChild(row);});
      const pending=dr?[...new Set([...dr.ambiguous,...dr.unmatched])]:[],ms=JSON.stringify([pending,S.mappings,!!D.emd,S.sido17]);
      if(ms!==matchSig){matchSig=ms;const box=$("advMappings");box.replaceChildren();const note=document.createElement("p");note.className="note";note.textContent=pending.length?"후보를 골라 연결하세요. 원본 표는 바꾸지 않습니다.":"연결되지 않은 지역이 없습니다. 저장된 규칙 "+Object.keys(S.mappings).length+"개";box.appendChild(note);
        pending.forEach(name=>{const row=document.createElement("div"),label=document.createElement("label"),select=document.createElement("select"),search=document.createElement("input"),button=document.createElement("button");label.textContent=name;search.placeholder="지역명 검색";search.className="field";select.className="field";button.className="btn sm";button.textContent="연결";
          const populate=q=>{select.replaceChildren();option(select,"","지역을 선택하세요");let count=0;for(const lv of ["sido","si","sgg","emd"])for(const id in D[lv]||{}){const f=D[lv][id];if(f.full.replace(/\s/g,"").includes(q.replace(/\s/g,""))&&count++<100)option(select,lv+":"+id,f.full);}};populate(name);search.oninput=()=>populate(search.value);button.onclick=()=>{if(select.value){Object.defineProperty(S.mappings,name,{value:select.value,enumerable:true,writable:true,configurable:true});render();}};row.append(label,search,select,button);box.appendChild(row);});}
    }
    return {refresh};
  }
  root.KRMapAdvancedUI={bind};
})(window);
