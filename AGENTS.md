# AGENTS.md

대한민국 행정구역(시도 · 시군구 · 읍면동) 지도를 SVG · PNG · PPTX 로 만드는 저장소입니다.

## 지도를 만들어 달라는 요청을 받으면

`.claude/skills/korea-map/SKILL.md` 의 순서를 따릅니다 (Claude Code 가 아니어도 같은 내용).
짧게:

```bash
npm install                                              # 처음 한 번
node tools/krmap.mjs find 대전 중구 --json                # 지역 이름 확인
node tools/krmap.mjs indicators --json                   # 내장 통계 지표
node tools/krmap.mjs render spec.json --json             # 지도 만들기 → out/
```

spec 칸 전부와 예시: `docs/automation.md`. MCP 서버(`tools/mcp-server.mjs`)를 붙였으면 `render_map` 등을 써도 됩니다.
결과 JSON 의 `unmatched` · `ambiguous` 가 비었는지, 만든 PNG 가 제대로 보이는지 확인하고 파일 경로를 알려 주세요.

## 코드를 고칠 때

- `web/render.js` · `datafill.js` · `pins.js` · `state.js` · `pptx.js` 는 브라우저와 Node 가 함께 쓰는 UMD 모듈입니다. ES module 문법이나 Node 전용 API 를 넣지 마세요.
- `web/data/*.js` 는 `scripts/build_data.py` · `scripts/build_stats.py` 가 만든 파일입니다. 손으로 고치지 마세요.
- 고친 뒤 `npm test` 를 돌립니다. 미리 만든 SVG 를 다시 만들려면 `node scripts/export_svgs.js`.
- 주석과 문서는 한국어로, 둘레 코드와 같은 짧은 말투로 씁니다.
