#!/usr/bin/env node
// 대한민국 행정구역 지도 MCP 서버 (stdio). Claude Code·Codex 같은 에이전트가 지도를 만들 때 쓴다.
//   Claude Code: 저장소의 .mcp.json 이 자동으로 등록한다 (또는 claude mcp add korea-map -- node tools/mcp-server.mjs)
//   Codex: ~/.codex/config.toml 에 [mcp_servers.korea-map] command = "node", args = ["<저장소>/tools/mcp-server.mjs"]
// 표준 출력은 MCP 통신에 쓰이므로 여기서는 console.log 를 쓰지 않는다.
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as K from "./core.mjs";

const pkg = JSON.parse(fs.readFileSync(path.join(K.ROOT, "package.json"), "utf8"));
const server = new McpServer({ name: "korea-map", version: pkg.version });

const ok = (data, extra = []) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...extra] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: "오류: " + (e && e.message ? e.message : String(e)) }] });
const run = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };
// 앞선 render 가 sido17(광주·전남 나눔)을 켰더라도 다른 도구는 기본 상태로 답한다
const data = (sido17) => { const d = K.loadData(); K.R.useSido17(d.D, !!sido17); return d; };
const fullOf = (D, key) => { const [l, i] = key.split(":"); return D[l][i].full; };

const UNIT = z.string().optional().describe("단위: 시도 / 시군구 / 일반구 / 읍면동 (sido / si / sgg / emd)");

server.registerTool("find_region", {
  title: "지역 찾기",
  description: "이름(유성구, 대전 중구, 서울특별시)이나 행정기관코드로 시도·시군구·읍면동을 찾는다. 이름이 여러 곳에 있으면(예: 중구) 후보가 모두 나오니 시도를 붙여 다시 부른다.",
  inputSchema: { query: z.string().describe("지역 이름이나 코드"), limit: z.number().int().optional() },
}, run(async ({ query, limit }) => {
  const { D } = data();
  return ok(K.findRegions(D, query, { limit: limit || 20 }).map((h) => ({ name: h.full, unit: K.LEVEL_KO[h.lv], key: h.key, code: h.id })));
}));

server.registerTool("list_neighbors", {
  title: "주변 지역",
  description: "한 지역과 맞닿은 주변 지역 목록 (경계 50 m 이내). depth 2 는 두 겹까지.",
  inputSchema: { region: z.string(), unit: UNIT, depth: z.number().int().min(1).max(3).optional(), sido17: z.boolean().optional().describe("광주·전남을 나눠 본다") },
}, run(async ({ region, unit, depth, sido17 }) => {
  const { D } = data(sido17);
  const n = K.neighbors(D, region, unit || "시군구", depth || 1);
  return ok({ region: n.region.full, unit: K.LEVEL_KO[n.unit], count: n.items.length, neighbors: n.items });
}));

server.registerTool("list_indicators", {
  title: "기본 통계 지표 목록",
  description: "지도에 바로 칠할 수 있는 내장 통계(행정안전부 주민등록 인구통계, 시도·시군구 단위) 지표의 id 와 이름.",
  inputSchema: {},
}, run(async () => {
  const { stats } = data();
  return ok({ month: stats.meta.month, source: stats.meta.source, note: stats.meta.note, indicators: K.indicators(stats) });
}));

server.registerTool("get_stats", {
  title: "기본 통계 값",
  description: "지역들의 내장 통계 값. regions 로 지역을 직접 주거나, within + unit 으로 한 지역 안의 시군구 전부를 받는다.",
  inputSchema: {
    regions: z.array(z.string()).optional(),
    within: z.string().optional().describe("이 지역 안의 지역 전부 (예: 경기도)"),
    unit: UNIT,
    indicators: z.array(z.string()).optional().describe("지표 id 나 이름 (list_indicators). 비우면 주요 지표"),
  },
}, run(async ({ regions, within, unit, indicators }) => {
  const { D, stats } = data();
  let list = regions || [];
  if (within) {
    const r = K.resolveRegion(D, within);
    const lv = K.parseUnit(unit, "si");
    list = K.convert(D, r.lv, r.id, lv).map((id) => ({ lv, id, key: lv + ":" + id, full: D[lv][id].full }));
  }
  if (!list.length) throw new Error("regions 나 within 을 주세요");
  return ok({ month: stats.meta.month, source: stats.meta.source, rows: K.statValues(D, stats, list, indicators) });
}));

server.registerTool("locate_pins", {
  title: "주소·좌표 → 지역",
  description: "지점 목록의 주소나 위도·경도가 어느 지역에 떨어지는지 확인한다. 주소는 인터넷(OpenStreetMap) 검색, 안 되면 주소 속 동·시군구 가운데로.",
  inputSchema: {
    pins: z.union([z.string(), z.array(z.object({ name: z.string().optional(), address: z.string().optional(), lat: z.number().optional(), lng: z.number().optional(), category: z.string().optional() }))])
      .describe("붙여 넣은 표(이름⇥주소⇥분류 또는 이름⇥위도,경도), 파일 경로, 또는 객체 목록"),
    geocode: z.boolean().optional().describe("false 면 인터넷 주소 검색을 쓰지 않는다"),
  },
}, run(async ({ pins, geocode }) => {
  const { D } = data();
  let list = pins;
  if (typeof pins === "string" && !pins.includes("\n") && fs.existsSync(path.resolve(pins))) list = K.decodeText(fs.readFileSync(path.resolve(pins)));
  const items = await K.placePins(D, list, { online: geocode !== false });
  return ok(items.map((i) => ({
    name: i.name, address: i.addr, category: i.cat, quality: i.q,
    region: i.keys ? Object.values(i.keys).map((k) => fullOf(D, k)).sort((a, b) => b.length - a.length)[0] : null,
  })));
}));

const SPEC_HELP = `지도 설정(spec). 자주 쓰는 칸:
- 지도 방식 (하나만): region="대전광역시" (+neighbors 0|1|2, neighborUnit, inner="읍면동") 주변 지역 보기 / regions=["충청남도","세종"] (+unit, hideOthers) 여러 곳 직접 / 둘 다 없으면 전국 (nationalUnit="시도"|"시군구")
- 모양: layout 실제|벌려|네모|육각, theme 코발트|코랄|에메랄드|라벤더|먹|미드나잇, distinct, aspect "16:9"|"4:3"|"1:1", labels "all"|"none"|[이름...]
- 제목: title, subtitle, source(true 면 출처 문구), legend tl|tr|bl|br|none, legendTitle
- 색칠: stat="old60R"(내장 통계 지표, list_indicators) + statLabels=["pop"] / data={table:"붙여넣은 표 또는 파일 경로", by:"열" | ratio:["A","B"] | poll:true, labels:[...]} / palette, steps, method "quantile"|"equal"
- 그룹: groups=[{name, color, regions:[...], unit}], 지역별: styles={"대전 유성구":{fill:"#..", text:"#..", hideLabel:true}}
- 핀: pins=[{name, address | lat,lng, category}] 또는 붙여넣은 표, geocode=false, pinStyle={shape:"물방울"|"점"|"네모", color, size, labels}, colorByPins
- 이름 자리: labelPlace "auto"(지역 안, 안 들어가면 지시선) | "side"(양옆 줄로 모두 빼기), leaders=false 면 안 들어가는 이름 생략
- 원 크기: bubbles=true (인구·매출·지점 수 같은 개수는 면 색보다 원 크기), bubbleScale
- 확대 상자: 전국 시군구 지도에서 insets=true 또는 ["서울","부산","대구","인천","광주","대전","울산"]
- 여러 장(PPTX 하나에 슬라이드 여러 장): each="시도" | {in:"충청남도", unit:"시군구"} | {regions:[...]} 또는 slides=[{...},{...}]. 제목의 {지역} 은 지역 이름으로
- 기타: sido17(광주·전남 나눔), splitGu(일반구 나눔), fontScale, lineScale, shadow, background
웹 도구에서 "작업 저장"한 파일 내용({state, fileText})을 그대로 넣어도 된다. 모든 칸은 map_spec_reference 로 볼 수 있다.`;

server.registerTool("render_map", {
  title: "지도 만들기",
  description: "행정구역 지도를 SVG(벡터)·PNG·PPTX(지역마다 편집할 수 있는 도형)로 만들어 파일로 저장한다. 결과에 파일 경로와 요약(칠한 지역 수, 범례, 못 맞춘 이름)이 오고, preview=true 면 미리보기 그림도 온다. 지역 이름이 애매하면 find_region 으로 먼저 확인한다.\n\n" + SPEC_HELP,
  inputSchema: {
    spec: z.object({}).passthrough().describe("지도 설정 (위 설명). 예: {\"region\":\"대전광역시\",\"stat\":\"60세 이상 비율\",\"title\":\"대전 주변 고령 인구\"}"),
    formats: z.array(z.enum(["svg", "png", "pptx"])).optional().describe("만들 파일 (기본: svg, png, pptx)"),
    out_dir: z.string().optional().describe("저장 폴더 (기본: 현재 폴더의 out/). 상대 경로는 서버를 띄운 폴더 기준"),
    name: z.string().optional().describe("파일 이름 (확장자 없이, 기본: 지도 제목)"),
    width: z.number().int().min(400).max(6000).optional().describe("그림 폭 px (기본 1600)"),
    preview: z.boolean().optional().describe("미리보기 PNG 를 결과에 넣는다 (기본 true)"),
  },
}, run(async ({ spec, formats, out_dir, name, width, preview }) => {
  const { D, stats } = K.loadData();
  const base = process.cwd();
  if (K.isDeck(spec)) {
    // 여러 장: PPTX 하나에 슬라이드 여러 장, 미리보기는 첫 장
    const res = await K.renderDeck(spec, { baseDir: base, formats: formats || spec.formats, width: width || spec.width, name: name || spec.name, out: path.resolve(base, out_dir || spec.out || "out"), preview: preview !== false, previewWidth: 900 });
    const img = res.preview ? [{ type: "image", data: Buffer.from(res.preview).toString("base64"), mimeType: "image/png" }] : [];
    delete res.preview;
    return ok(res, img);
  }
  const { S, bigText } = await K.specToState(D, spec, { stats, baseDir: base });
  const res = await K.renderState(D, stats, S, bigText, {
    formats: formats || spec.formats, width: width || spec.width, name: name || spec.name,
    out: path.resolve(base, out_dir || spec.out || "out"), preview: preview !== false, previewWidth: 900,
  });
  const img = res.preview ? [{ type: "image", data: Buffer.from(res.preview).toString("base64"), mimeType: "image/png" }] : [];
  delete res.preview;
  K.R.useSido17(D, false);
  return ok(res, img);
}));

server.registerTool("map_spec_reference", {
  title: "지도 설정 설명서",
  description: "render_map 의 spec 에 쓸 수 있는 칸 전부와 예시 (docs/automation.md).",
  inputSchema: {},
}, run(async () => ({ content: [{ type: "text", text: fs.readFileSync(path.join(K.ROOT, "docs", "automation.md"), "utf8") }] })));

await server.connect(new StdioServerTransport());
