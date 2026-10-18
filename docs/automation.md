# 자동화: 명령줄(krmap) · MCP 서버 · 에이전트

웹 도구와 **같은 그리기 코드**(`web/render.js` 등)를 Node 에서 돌려, 사람 손 없이 SVG · PNG · PPTX 지도를 만듭니다.
Claude Code · Codex 같은 코딩 에이전트는 MCP 서버를 쓰거나 명령줄을 직접 부르면 됩니다.

## 준비

```bash
git clone <이 저장소> && cd <저장소>
npm install          # Node 18 이상
npm test             # 7개 확인 (인터넷 필요 없음)
```

PNG 의 한글은 `npm install` 로 함께 받는 프리텐다드(Pretendard, SIL OFL)로 그립니다. 다른 글꼴은 `--font 글꼴.ttf`.
SVG 는 프리텐다드가 있으면 그것을, 없으면 애플 SD 고딕 · 맑은 고딕 순으로 씁니다. PPTX 는 어느 PC 에나 있는 맑은 고딕으로 넣습니다.

## Claude Code 에 붙이기

저장소 루트의 `.mcp.json` 에 서버가 적혀 있어서, 이 폴더에서 `claude` 를 열면 `korea-map` 서버를 쓸지 묻습니다.
다른 폴더에서도 쓰려면:

```bash
claude mcp add korea-map --scope user -- node /절대/경로/tools/mcp-server.mjs
```

`.claude/skills/korea-map/SKILL.md` 는 Claude Code 가 지도 요청을 받을 때 읽는 사용법입니다.

## Codex 에 붙이기

`~/.codex/config.toml`:

```toml
[mcp_servers.korea-map]
command = "node"
args = ["/절대/경로/tools/mcp-server.mjs"]
```

또는 `codex mcp add korea-map -- node /절대/경로/tools/mcp-server.mjs`.
저장소 안에서 Codex 를 쓰면 `AGENTS.md` 의 안내를 따라 명령줄(`node tools/krmap.mjs`)도 바로 씁니다.

## MCP 도구

| 도구 | 하는 일 |
|---|---|
| `find_region` | 이름·코드로 지역 찾기 (애매한 이름은 후보 목록) |
| `list_neighbors` | 맞닿은 주변 지역 (단위, 몇 겹) |
| `list_indicators` | 내장 통계 지표 id · 이름 |
| `get_stats` | 지역들의 통계 값 (`within` 으로 한 지역 안 전부) |
| `locate_pins` | 주소·좌표가 어느 지역인지 |
| `render_map` | spec → SVG · PNG · PPTX 파일 + 요약 + 미리보기 그림 |
| `map_spec_reference` | 이 문서 |

`render_map` 의 파일은 `out_dir`(기본: 서버를 띄운 폴더의 `out/`)에 저장되고, 결과에 절대 경로가 옵니다.

## 명령줄

```bash
node tools/krmap.mjs help
node tools/krmap.mjs find 중구                         # 같은 이름이 어디어디 있는지
node tools/krmap.mjs neighbors 대전광역시 --unit 시군구
node tools/krmap.mjs indicators
node tools/krmap.mjs stats 대전광역시 세종 --indicators pop,old60R
node tools/krmap.mjs stats --in 경기도 --unit 시군구 --json
node tools/krmap.mjs render --region 대전광역시 --stat old60R --stat-labels pop --title "대전 주변 고령 인구" --source
node tools/krmap.mjs render spec.json --format pptx --out out/보고서.pptx
```

`npm link` 를 하면 `krmap` 으로 바로 부를 수 있습니다. 모든 명령에 `--json` 을 붙이면 결과가 JSON 입니다.

## spec (지도 설정) 전체

JSON 하나로 지도 한 장을 정합니다. 칸은 전부 고를 수 있고, 비우면 기본값입니다.
웹 도구에서 **작업 저장**한 파일(`{"state": ..., "fileText": ...}`)을 그대로 spec 으로 넣어도 똑같이 나옵니다.

### 지도 방식 (셋 중 하나)

| 칸 | 값 | 뜻 |
|---|---|---|
| `region` | `"대전광역시"`, `"대전 유성구"`, `"30"` | 이 지역과 주변 지역 |
| `neighbors` | `0` · `1`(기본) · `2` | 주변 몇 겹 |
| `neighborUnit` | `"시도"` · `"시군구"`(기본) · `"일반구"` · `"읍면동"` | 주변을 나눌 단위 |
| `inner` | `"시군구"` · `"읍면동"` … | 고른 지역 안쪽을 나눠 그리기 |
| `context` | `false` | 오른쪽 위 전국 위치도 빼기 |
| `regions` | `["충청남도", "세종"]` | 여러 지역 직접 고르기 |
| `unit` | `"시군구"` … | `regions` 를 이 단위로 나눠 고르기 (충청남도 → 충남의 시군 15곳) |
| `fit` | `false` | 고른 곳에 맞춰 확대하지 않기 |
| `hideOthers` | `true` | 고르지 않은 지역은 그리지 않기 |
| `nationalUnit` | `"시도"`(기본) · `"시군구"` | 위 둘이 없을 때: 전국 지도 |

지역 이름은 `"유성구"`, `"대전 유성구"`, `"대전광역시 유성구"`, 행정기관코드(`"30200"`) 모두 됩니다.
`"중구"` 처럼 여러 곳에 있는 이름은 오류와 함께 후보가 나오니 시도를 붙이세요.

### 모양

| 칸 | 값 |
|---|---|
| `layout` | `"실제"`(기본) · `"벌려"`(지역끼리 띄움) · `"네모"` · `"육각"`(타일 지도) |
| `explode` | 벌려 놓는 정도 0~1 |
| `tileGap` | 타일 사이 틈 0~0.4 |
| `theme` | `"코발트"` · `"코랄"` · `"에메랄드"` · `"라벤더"` · `"먹"` · `"미드나잇"` |
| `colors` | `{"target": "#...", "neighbor": "#...", ...}` 색 하나하나 바꾸기 |
| `distinct` | `true` 면 이웃끼리 다른 색 |
| `shadow` · `sidoLines` · `halo` · `subLabel` · `background` | 켜고 끄기 |
| `fontScale` · `lineScale` | 글자 · 선 크기 배율 |
| `aspect` | `"16:9"` · `"4:3"` · `"1:1"` · `"auto"` |
| `labels` | `"all"`(기본) · `"none"` · `["대전광역시", "세종"]`(이 지역만) |

### 제목 · 범례

| 칸 | 값 |
|---|---|
| `title` · `subtitle` | 지도 위 제목 · 부제 |
| `source` | `true` 면 아래에 출처 문구 |
| `legend` | `"tl"` · `"tr"` · `"bl"` · `"br"` · `"none"` (색칠하면 기본 `br`) |
| `legendTitle` | 범례 제목 |

### 그룹 · 지역별 꾸미기

```json
"groups": [
  {"name": "1권역", "color": "#E8833A", "regions": ["대전광역시", "세종"]},
  {"name": "2권역", "regions": ["충청남도"], "unit": "시군구"}
],
"styles": {"대전 유성구": {"fill": "#FFD54F", "text": "#333333", "hideLabel": false}}
```

### 데이터로 색칠

**내장 통계** (행정안전부 주민등록 인구통계, 시도 · 시군구):

```json
{"region": "대전광역시", "stat": "old60R", "statLabels": ["pop", "old60R"]}
```

`stat` 은 지표 id 나 이름(`"60세 이상 비율"`). 목록은 `krmap indicators` / `list_indicators`.
주요 id: `pop` 총인구, `hh` 세대수, `young`/`youngR` 20~39세, `old60`/`old60R` 60세 이상, `old70R`, `kidR` 0~19세,
`agingI` 고령화지수, `yoy`/`yoyR` 1년 증감, `sexR` 성비, `a0`~`a10` 10세 단위.

**내 표** (CSV, 탭, 엑셀 붙여넣기 · 첫 열은 지역 이름이나 코드):

```json
"data": {"table": "지역\t찬성\t반대\n천안시\t52\t40", "poll": true}
"data": {"file": "여론조사.csv", "by": "찬성률"}
"data": {"file": "인구.csv", "ratio": ["청년", "총인구"], "labels": ["청년"]}
```

- `by`: 이 열의 값으로 단계 색 (숫자) 또는 분류 색 (글자)
- `ratio`: `[A, B]` → A ÷ B × 100
- `poll`: `true`(숫자 열 전부) 또는 `["후보1", "후보2"]` → 가장 높은 열의 색, 차이가 적을수록 옅게
- 표가 그리는 단위보다 잘게 나뉘어 있으면(예: 읍면동 표로 시군구 지도) 더해서 씁니다.
- 행정안전부 연령별 인구 파일(1세 단위)도 그대로 넣으면 연령 열을 알아봅니다.
- `palette`: `blue` · `green` · `orange` · `red` · `purple` · `viridis` · `diverge` (테마를 정하면 그에 맞춰)
- `steps`: 단계 수 (기본 5), `method`: `"quantile"` · `"equal"`
- `showValues: false`: 이름 아래 값 숨기기

### 지점 핀

```json
"pins": [
  {"name": "대전시청", "lat": 36.3504, "lng": 127.3845, "category": "관공서"},
  {"name": "세종청사", "address": "세종특별자치시 도움6로 11"}
],
"geocode": true,
"pinStyle": {"shape": "물방울", "color": "#E53935", "size": 1, "labels": true, "byCategory": true},
"colorByPins": false
```

- `pins` 는 목록, 붙여넣은 표(`이름⇥주소⇥분류` 또는 `이름⇥위도,경도`), 파일 경로 모두 됩니다.
- 주소는 인터넷(OpenStreetMap Nominatim, 1초에 한 건)으로 찾고, 안 되면 주소 속 동 · 시군구의 가운데에 꽂습니다. 결과 `pins[].quality` 로 어떻게 찾았는지 알 수 있습니다.
- `colorByPins: true` 면 지역별 지점 수로 색칠합니다.

### 기타

| 칸 | 뜻 |
|---|---|
| `sido17` | 광주 · 전남을 나눠 17개 시도로 (기본은 2026.7. 통합된 전남광주통합특별시) |
| `splitGu` | 일반구가 있는 시(수원 · 성남 …)를 구로 나눠 고르기 |
| `formats` · `out` · `name` · `width` | 만들 파일, 저장 위치, 파일 이름, 그림 폭(px) |

## 예

```json
{
  "region": "대전광역시",
  "neighbors": 1,
  "stat": "60세 이상 비율",
  "statLabels": ["pop"],
  "theme": "코랄",
  "title": "대전과 주변 시군의 고령 인구",
  "subtitle": "60세 이상 인구 비율",
  "source": true,
  "formats": ["pptx", "png"],
  "out": "out/대전_고령.pptx"
}
```

```json
{
  "regions": ["충청남도"], "unit": "시군구", "layout": "육각",
  "data": {"file": "충남_여론조사.csv", "poll": ["A후보", "B후보"]},
  "title": "충남 시군별 우세 후보", "legend": "tr"
}
```

```json
{
  "nationalUnit": "시군구", "labels": "none",
  "pins": "지점목록.csv", "colorByPins": true, "title": "전국 지점 분포"
}
```

## 결과 (`--json` / `render_map`)

```json
{
  "files": ["/.../out/대전_고령.pptx", "/.../out/대전_고령.png"],
  "title": "대전과 주변 시군의 고령 인구",
  "size": [1600, 1366],
  "colored": 9,
  "unmatched": [],
  "ambiguous": [],
  "legend": {"title": "60세 이상 비율", "items": ["…"]},
  "pins": [],
  "warnings": [],
  "source": "출처: 경계: 통계청 SGIS(2026.10.01), 인구: 행정안전부 주민등록 인구통계(2026.07)"
}
```

`unmatched`(표에서 지도에 못 맞춘 이름)와 `ambiguous`(여러 곳인 이름)가 비어 있는지 꼭 확인하세요.
