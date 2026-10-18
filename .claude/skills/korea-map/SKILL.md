---
name: korea-map
description: 대한민국 행정구역(시도·시군구·읍면동) 지도를 SVG·PNG·PPTX 로 만든다. 특정 지역과 주변 시군 지도, 전국·권역 지도, 타일 지도, 인구·고령·청년 같은 통계나 여론조사 표로 색칠한 지도, 주소·좌표 핀 지도를 보고서·PPT 용으로 만들 때 쓴다.
---

# 대한민국 행정구역 지도 만들기

이 저장소의 엔진(`tools/core.mjs`, 그리기는 웹 도구와 같은 `web/render.js`)으로 지도를 만든다.
처음이면 `npm install` 을 먼저 한다.

## 어떤 길로

1. **MCP 도구가 보이면** (`korea-map` 서버: `render_map`, `find_region` …) 그것을 쓴다.
2. 아니면 **명령줄**: `node tools/krmap.mjs <명령> --json`. 결과 JSON 을 읽고 판단한다.

## 순서

1. 지역 이름이 애매하면 먼저 확인한다: `find_region` / `krmap find 중구 --json`.
   "중구", "동구", "고성군" 처럼 여러 곳인 이름은 시도를 붙인다 ("대전 중구").
2. 통계로 칠하려면 지표를 고른다: `list_indicators` / `krmap indicators`.
   청년은 `young`/`youngR`(20~39세), 노인은 `old60R`(60세 이상)·`old70R`. 내장 통계는 10세 단위라
   법정 청년(19~34세)·노인(65세 이상)과 다르다는 점을 사용자에게 알린다.
3. spec(JSON)을 만들어 `render_map` / `krmap render spec.json --json` 을 부른다.
   spec 칸 전부: `docs/automation.md` (MCP 는 `map_spec_reference`).
4. 결과를 확인한다.
   - `unmatched`·`ambiguous` 가 비어 있지 않으면 표의 지역 이름을 고쳐 다시 만든다.
   - `pins[].quality` 가 "못 찾음"인 지점은 주소를 고치거나 위도·경도를 준다.
   - 미리보기 그림(MCP) 또는 PNG 를 보고 제목·범례가 겹치지 않는지 본다.
5. 만든 파일 경로를 사용자에게 알려 준다. PPTX 는 지역마다 이름 붙은 도형이라 PowerPoint 에서 색을 바로 바꿀 수 있다.

## spec 예

```json
{"region": "대전광역시", "stat": "old60R", "statLabels": ["pop"], "title": "대전 주변 고령 인구", "source": true}
{"regions": ["충청남도"], "unit": "시군구", "layout": "육각", "data": {"file": "poll.csv", "poll": true}}
{"nationalUnit": "시도", "stat": "yoyR", "theme": "에메랄드", "formats": ["pptx"], "out": "out/전국_증감.pptx"}
{"region": "세종", "inner": "읍면동", "pins": [{"name": "정부청사", "lat": 36.504, "lng": 127.262}]}
```

## 이럴 때는

- 동·구처럼 작은 지역이 몰려 이름이 겹치면: 기본(`labelPlace: "auto"`)이 안 들어가는 이름을 지시선으로 빼 줍니다. 그래도 빽빽하면 `"labels": "side"` 로 이름을 모두 양옆 줄에 세웁니다.
- 인구·매출·지점 수 같은 "개수"는 `"bubbles": true` (원 크기). 비율은 면 색 그대로.
- 전국 시군구 지도에서 서울·광역시 구가 안 보이면 `"insets": true` (확대 상자).
- 여러 지역을 같은 형식으로 여러 장: `"each": "시도"` 또는 `"each": {"in": "충청남도", "unit": "시군구"}`, 제목에 `{지역}`. 결과는 PPTX 한 파일.

## 명령줄 예

```bash
node tools/krmap.mjs neighbors 대전광역시 --unit 시군구 --json
node tools/krmap.mjs stats --in 경기도 --unit 시군구 --indicators pop,old60R --json
node tools/krmap.mjs render --region 대전광역시 --stat "60세 이상 비율" --title "대전 주변" --format png,pptx --out out/대전 --json
```

## 알아 둘 것

- 경계는 2026.10.1. 기준. 2026.7.1. 광주·전남이 전남광주통합특별시(코드 12)로 합쳐졌다. 나눠 보려면 `"sido17": true`.
- 내장 통계는 시도·시군구 단위다. 읍면동 지도에 통계를 칠하려면 사용자가 표를 줘야 한다.
- 주소 → 좌표는 인터넷(OpenStreetMap)이 될 때만 정확하다. 막힌 곳에서는 주소 속 동·시군구 가운데로 꽂힌다.
- 파일은 기본으로 `out/` 에 저장된다 (git 에 올라가지 않음).
