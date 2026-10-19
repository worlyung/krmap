# 함께 만들기

버그 제보, 기능 제안, 코드 기여 모두 반깁니다.

## 이슈

- **버그**: 무엇을 했는지(지역 · 설정, 또는 `작업 저장` 파일이나 spec JSON), 무엇이 나왔는지(그림 캡처), 무엇을 기대했는지 적어 주세요.
- **지역 이름 · 경계가 틀림**: 경계는 통계청 SGIS(2026.10.01) 기준입니다. 행정구역이 바뀐 경우 바뀐 날짜와 근거를 알려 주세요.
- **통계 값이 틀림**: 원본 파일(`data/mois/`)과 비교한 값을 함께 적어 주세요.

## 개발 준비

```bash
npm install          # Node 20 이상
npm test             # 엔진 시험 (인터넷 필요 없음)
```

웹 도구는 `web/index.html` 을 브라우저로 열거나, `web/` 에서 `python3 -m http.server` 로 띄워 봅니다.
경계 · 통계 데이터를 다시 만들 때는 README 의 "데이터 다시 만들기"를 보세요 (Python 3, `scripts/requirements.txt`).

의존성을 바꾼 뒤에는 `npm audit`도 확인합니다. 현재 PptxGenJS 4.0.1이 지정한 `image-size` 1.x에는 보안 수정판이 없어, `package.json`의 `overrides`로 2.0.4를 사용합니다. PptxGenJS를 올릴 때 이 설정이 여전히 필요한지 확인하고, PNG·PPTX 생성 검사도 함께 돌려 주세요.

## 코드 규칙

- `web/render.js` · `datafill.js` · `pins.js` · `state.js` · `pptx.js` · `colors.js` 는 브라우저와 Node 가 함께 쓰는 UMD 모듈입니다. ES module 문법이나 Node 전용 API 를 넣지 마세요.
- `web/data/*.js` 와 `svg/` 는 `scripts/` 가 만든 파일입니다. 손으로 고치지 말고 스크립트를 고친 뒤 다시 만드세요.
  그리기를 바꿨다면 `node scripts/export_svgs.js` 로 `svg/` 를 다시 만들어 함께 올려 주세요.
- 주석 · 문서 · 화면 문구는 한국어로, 둘레 코드와 같은 짧은 말투로 씁니다.
- 새 spec 칸을 넣으면 `docs/automation.md` 와 MCP 서버의 설명(`tools/mcp-server.mjs`)도 함께 고쳐 주세요.

## 풀 리퀘스트

1. 바꾼 이유와 무엇이 달라지는지 적어 주세요. 그림이 바뀌면 전후 캡처를 붙여 주세요.
2. `npm test` 가 통과해야 합니다 (GitHub Actions 가 자동으로 돌립니다).
3. 하나의 PR 에는 하나의 주제만.

기여한 코드는 이 저장소의 [MIT 라이선스](LICENSE)로 배포됩니다.
