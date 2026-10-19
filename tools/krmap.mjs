#!/usr/bin/env node
// krmap — 대한민국 행정구역 지도 명령줄 도구. 사람도, Claude Code·Codex 같은 에이전트도 쓴다.
//   node tools/krmap.mjs help
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as K from "./core.mjs";

const HELP = `krmap — 대한민국 행정구역 지도 (시도·시군구·읍면동) → SVG · PNG · PPTX

사용법
  krmap render [설정.json] [옵션]       지도 만들기 (설정 파일, 웹 도구 "작업 저장" 파일, 또는 옵션)
  krmap find <이름|코드>                 지역 찾기
  krmap neighbors <지역> [--unit 시군구] [--depth 1]
  krmap stats <지역...> [--indicators pop,old60R]   기본 통계 값 (행정안전부 주민등록 인구통계)
  krmap stats --in <지역> --unit 시군구   한 지역 안의 시군구(또는 읍면동) 전부
  krmap indicators                       기본 통계 지표 목록
  krmap pins <목록.csv>                  주소·좌표 → 핀 자리 확인
  모든 명령에 --json 을 붙이면 결과를 JSON 으로 냅니다 (에이전트용)

render 옵션
  --region 대전광역시        이 지역과 주변 (주변 지역 보기)
  --neighbors 1              주변: 0 없음 / 1 맞닿은 곳 / 2 두 겹
  --neighbor-unit 시군구      주변을 나눌 단위 (시도 / 시군구 / 일반구 / 읍면동)
  --inner 읍면동             고른 지역 안쪽 나누기
  --regions 충청남도,세종     여러 지역 직접 고르기 (--unit 시군구 로 단위)
  --hide-others              고르지 않은 지역은 빼기
  --national 시군구          전국 지도 (--region·--regions 가 없을 때, 기본 시도)
  --insets 서울,부산         전국 지도에 확대 상자 (all 이면 특별시·광역시 전부)
  --layout 육각              실제 / 벌려 / 네모 / 육각
  --theme 코랄               코발트 / 코랄 / 에메랄드 / 라벤더 / 먹 / 미드나잇
  --base-color "#13A07F"     색 하나로 색 조합 전체를 만들기 (--dark-base: 어두운 바탕)
  --look 유리                디자인: 기본 / 유리(글라스모피즘) / 입체 / 소프트(뉴모피즘) / 네온
  --stat old60R              기본 통계로 칠하기 (지표 id 나 이름, krmap indicators)
  --stat-labels pop,old60R   이름 아래 보일 기본 통계 값
  --data 표.csv              내 표·CSV 로 칠하기 (엑셀 붙여넣기 형식도 됨)
  --by 열이름 | --ratio A,B | --poll    표에서 칠할 기준
  --data-labels 열1,열2      이름 아래 보일 표의 열
  --pins 지점.csv            지점 핀 (이름⇥주소⇥분류 또는 이름⇥위도,경도)
  --no-geocode               인터넷 주소 검색을 쓰지 않음
  --color-by-pins            지역별 지점 수로 칠하기
  --title 제목 --subtitle 부제 --source    제목·부제·출처
  --legend br                범례 자리: tl / tr / bl / br / none
  --labels none              지역 이름: all / none / side(양옆 줄로 모두 빼기) / 넣을 지역1,지역2
  --label-place side         이름 자리: auto(지역 안, 안 들어가면 지시선) / side(양옆 줄)
  --no-leaders               안 들어가는 이름을 지시선으로 빼지 않고 생략
  --bubbles                  색 대신 원 크기로 (인구·매출 같은 개수)
  --distinct                 이웃끼리 색 다르게
  --aspect 16:9              그림 비율: 16:9 / 4:3 / 1:1
  --sido17                   광주·전남 나눠 보기 (17개 시도)
  --each 시도 | --each 충청남도 [--each-unit 시군구]   지역마다 한 장씩 → 슬라이드 여러 장 PPTX (제목의 {지역} 은 지역 이름으로)
  --format svg,png,pptx,html 만들 파일 (기본: svg,png,pptx, 묶음은 pptx)
  --out 폴더 | 폴더/이름.pptx 저장 위치 (기본: ./out)
  --width 1600 --png-scale 2 --font 글꼴.ttf

예
  krmap render --region 대전광역시 --stat "60세 이상 비율" --stat-labels pop,old60R --title "대전 주변 고령 인구" --source
  krmap render --regions 충청남도 --unit 시군구 --layout 육각 --data 여론조사.csv --poll
  krmap render --national 시도 --stat yoyR --theme 에메랄드 --format pptx --out out/전국_인구증감.pptx
  krmap render 작업.json --format png
  krmap render --each 시도 --stat old60R --title "{지역} 고령 인구"                    시도마다 한 장씩 PPTX 하나로
  krmap render --each 충청남도 --each-unit 시군구 --inner 읍면동 --title "{지역} 읍면동"   충남 시군마다 한 장씩
`;

const opts = {
  json: { type: "boolean" }, help: { type: "boolean", short: "h" },
  region: { type: "string" }, neighbors: { type: "string" }, "neighbor-unit": { type: "string" }, inner: { type: "string" },
  regions: { type: "string" }, unit: { type: "string" }, "hide-others": { type: "boolean" }, "no-fit": { type: "boolean" }, national: { type: "string" }, insets: { type: "string" },
  layout: { type: "string" }, theme: { type: "string" }, look: { type: "string" }, "base-color": { type: "string" }, "dark-base": { type: "boolean" }, distinct: { type: "boolean" }, "no-shadow": { type: "boolean" }, background: { type: "boolean" },
  stat: { type: "string" }, "stat-labels": { type: "string" },
  data: { type: "string" }, by: { type: "string" }, ratio: { type: "string" }, poll: { type: "boolean" }, "data-labels": { type: "string" },
  palette: { type: "string" }, steps: { type: "string" }, method: { type: "string" },
  pins: { type: "string" }, "no-geocode": { type: "boolean" }, "color-by-pins": { type: "boolean" }, "pin-shape": { type: "string" }, "pin-color": { type: "string" },
  title: { type: "string" }, subtitle: { type: "string" }, source: { type: "boolean" }, legend: { type: "string" }, "legend-title": { type: "string" },
  labels: { type: "string" }, "label-place": { type: "string" }, bubbles: { type: "boolean" }, "no-leaders": { type: "boolean" }, aspect: { type: "string" }, sido17: { type: "boolean" }, "split-gu": { type: "boolean" },
  format: { type: "string" }, out: { type: "string" }, width: { type: "string" }, "png-scale": { type: "string" }, font: { type: "string" },
  depth: { type: "string" }, each: { type: "string" }, "each-unit": { type: "string" }, indicators: { type: "string" }, in: { type: "string" }, limit: { type: "string" },
};
const list = (v) => (v == null ? undefined : String(v).split(/\s*,\s*/).filter(Boolean));

function specFromFlags(v) {
  const spec = {};
  if (v.region) spec.region = v.region;
  if (v.neighbors != null) spec.neighbors = +v.neighbors;
  if (v["neighbor-unit"]) spec.neighborUnit = v["neighbor-unit"];
  if (v.inner) spec.inner = v.inner;
  if (v.regions) spec.regions = list(v.regions);
  if (v.unit) spec.unit = v.unit;
  if (v["hide-others"]) spec.hideOthers = true;
  if (v["no-fit"]) spec.fit = false;
  if (v.national) spec.nationalUnit = v.national;
  if (v.insets) spec.insets = ["all", "true", "전부"].includes(v.insets) ? true : list(v.insets);
  if (v.layout) spec.layout = v.layout;
  if (v.theme) spec.theme = v.theme;
  if (v.look) spec.look = v.look;
  if (v["base-color"]) spec.baseColor = v["base-color"];
  if (v["dark-base"]) spec.darkBase = true;
  if (v.distinct) spec.distinct = true;
  if (v["no-shadow"]) spec.shadow = false;
  if (v.background) spec.background = true;
  if (v.stat) spec.stat = v.stat;
  if (v["stat-labels"]) spec.statLabels = list(v["stat-labels"]);
  if (v.data) {
    spec.data = { file: v.data };
    if (v.by) spec.data.by = v.by;
    if (v.ratio) spec.data.ratio = list(v.ratio);
    if (v.poll) spec.data.poll = true;
    if (v["data-labels"]) spec.data.labels = list(v["data-labels"]);
  }
  if (v.palette) spec.palette = v.palette;
  if (v.steps) spec.steps = +v.steps;
  if (v.method) spec.method = v.method;
  if (v.pins) spec.pins = v.pins;
  if (v["no-geocode"]) spec.geocode = false;
  if (v["color-by-pins"]) spec.colorByPins = true;
  if (v["pin-shape"] || v["pin-color"]) spec.pinStyle = { shape: v["pin-shape"], color: v["pin-color"] };
  if (v.title) spec.title = v.title;
  if (v.subtitle) spec.subtitle = v.subtitle;
  if (v.source) spec.source = true;
  if (v.legend) spec.legend = v.legend;
  if (v["legend-title"]) spec.legendTitle = v["legend-title"];
  if (v.labels) spec.labels = ["all", "none", "side"].includes(v.labels) ? v.labels : list(v.labels);
  if (v["label-place"]) spec.labelPlace = v["label-place"];
  if (v.bubbles) spec.bubbles = true;
  if (v["no-leaders"]) spec.leaders = false;
  if (v.aspect) spec.aspect = v.aspect;
  if (v.sido17) spec.sido17 = true;
  if (v["split-gu"]) spec.splitGu = true;
  // 여러 장: --each 시도 | --each 충청남도 [--each-unit 시군구]
  if (v.each) spec.each = ["시도", "sido"].includes(v.each) ? { unit: "시도" } : { in: v.each, unit: v["each-unit"] };
  return spec;
}

function print(v, json, human) {
  if (json) process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  else process.stdout.write(human(v) + "\n");
}

async function main() {
  const { values: v, positionals } = parseArgs({ options: opts, allowPositionals: true, strict: true });
  const [cmd, ...args] = positionals;
  if (!cmd || v.help || cmd === "help") { process.stdout.write(HELP); return; }
  const { D, stats } = K.loadData();
  if (v.sido17) K.R.useSido17(D, true);

  if (cmd === "render") {
    let spec = {};
    if (args[0]) {
      const file = path.resolve(args[0]);
      spec = JSON.parse(K.decodeText(fs.readFileSync(file)));
      // 작업 파일 안의 상대 경로(--data 등)는 그 파일 기준으로
      spec.__base = path.dirname(file);
    }
    Object.assign(spec, specFromFlags(v));
    const res = await K.renderSpec(spec, {
      baseDir: spec.__base,
      out: v.out || spec.out,
      formats: list(v.format) || spec.formats,
      width: v.width ? +v.width : spec.width,
      pngScale: v["png-scale"] ? +v["png-scale"] : undefined,
      fontFile: v.font,
    });
    if (res.slides) {
      print(res, v.json, (r) => [`만든 파일 (${r.slides}장):`, ...r.files.map((f) => "  " + f), ...r.items.filter((it) => it.unmatched.length || it.ambiguous.length || it.warnings.length).map((it) => `  ${it.slide}. ${it.title}: ${[...it.warnings, it.unmatched.length ? "못 찾은 이름 " + it.unmatched.join(", ") : "", it.ambiguous.length ? "여러 곳인 이름 " + it.ambiguous.join(", ") + " — 시도를 붙여 주세요" : ""].filter(Boolean).join(" · ")}`)].join("\n"));
      return;
    }
    print(res, v.json, (r) => [
      `만든 파일:`, ...r.files.map((f) => "  " + f),
      `제목: ${r.title}`,
      r.colored ? `칠한 지역: ${r.colored}곳` : null,
      r.legend ? `범례: ${r.legend.title ? r.legend.title + " — " : ""}${r.legend.items.join(", ")}` : null,
      r.unmatched.length ? `표에서 못 찾은 이름: ${r.unmatched.join(", ")}` : null,
      r.ambiguous.length ? `여러 곳인 이름: ${r.ambiguous.join(", ")} — 시도를 붙여 주세요` : null,
      r.pins.length ? `핀: ${r.pins.map((p) => `${p.name}(${p.quality})`).join(", ")}` : null,
      ...r.warnings,
      r.source,
    ].filter(Boolean).join("\n"));
    return;
  }
  if (cmd === "find") {
    const hits = K.findRegions(D, args.join(" "), { limit: v.limit ? +v.limit : 20 }).map((h) => ({ name: h.full, unit: K.LEVEL_KO[h.lv], key: h.key, code: h.id }));
    print(hits, v.json, (r) => (r.length ? r.map((h) => `${h.name}  [${h.unit} · ${h.code}]`).join("\n") : "찾은 지역이 없습니다"));
    return;
  }
  if (cmd === "neighbors") {
    const n = K.neighbors(D, args.join(" "), v.unit || "시군구", v.depth ? +v.depth : 1);
    print({ region: n.region.full, unit: K.LEVEL_KO[n.unit], neighbors: n.items }, v.json, (r) => `${r.region} 주변 ${r.unit} ${r.neighbors.length}곳: ${r.neighbors.map((i) => i.full + (i.ring === 2 ? "(두 겹)" : "")).join(", ")}`);
    return;
  }
  if (cmd === "indicators") {
    print({ month: stats.meta.month, source: stats.meta.source, note: stats.meta.note, indicators: K.indicators(stats) }, v.json, (r) => [`기본 통계 (${r.source}, ${r.month})`, r.note, ...r.indicators.map((i) => `  ${i.id.padEnd(8)} ${i.name}`)].join("\n"));
    return;
  }
  if (cmd === "stats") {
    let regions = args;
    if (v.in) {
      const r = K.resolveRegion(D, v.in);
      const lv = K.parseUnit(v.unit, "si");
      regions = K.convert(D, r.lv, r.id, lv).map((id) => ({ lv, id, key: lv + ":" + id, full: D[lv][id].full }));
    }
    if (!regions.length) throw new Error("지역을 하나 이상 주거나 --in 으로 범위를 정해 주세요");
    const rows = K.statValues(D, stats, regions, list(v.indicators));
    print({ month: stats.meta.month, source: stats.meta.source, rows }, v.json, (r) => {
      const cols = Object.keys(r.rows[0]).filter((c) => c !== "key");
      return [`${r.source} ${r.month}`, cols.join("\t"), ...r.rows.map((row) => cols.map((c) => row[c] ?? "-").join("\t"))].join("\n");
    });
    return;
  }
  if (cmd === "pins") {
    const items = await K.placePins(D, K.decodeText(fs.readFileSync(path.resolve(args[0]))), { online: !v["no-geocode"] });
    print(items.map((i) => ({ name: i.name, address: i.addr, category: i.cat, quality: i.q, region: i.keys ? Object.values(i.keys).map((k) => { const [l, d] = k.split(":"); return D[l][d].full; }).sort((a, b) => b.length - a.length)[0] : null })), v.json, (r) => r.map((i) => `${i.name}\t${i.quality}\t${i.region || "-"}`).join("\n"));
    return;
  }
  throw new Error(`알 수 없는 명령: ${cmd} (krmap help)`);
}

main().catch((e) => {
  process.stderr.write("오류: " + e.message + "\n");
  process.exit(1);
});
