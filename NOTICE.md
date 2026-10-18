# 데이터 · 외부 자료 출처와 라이선스

이 저장소의 **코드**는 [MIT 라이선스](LICENSE)입니다.
함께 들어 있는 아래 자료는 각자의 라이선스를 따르며, 쓰거나 다시 배포할 때 출처 표시를 지켜 주세요.

## 데이터

| 자료 | 들어 있는 곳 | 원본 · 라이선스 | 출처 표시 |
|---|---|---|---|
| 행정구역 경계 (시도 · 시군구 · 읍면동, 2026.10.01) | `web/data/base.js`, `web/data/emd.js`, `svg/`, 이 도구로 만든 지도 | 통계청 SGIS 행정구역 경계 — [공공누리 제1유형](https://www.kogl.or.kr/info/licenseType1.do)(출처표시). 가공본 [vuski/admdongkor](https://github.com/vuski/admdongkor) — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 이 저장소는 그것을 단순화하고 인접 관계를 계산해 넣었습니다(변경 있음) | "통계청 SGIS 행정구역 경계(2026.10.01), github.com/vuski/admdongkor" |
| 주민등록 인구통계 (2025.07~2026.07) | `data/mois/*.csv`, `web/data/stats.js` | 행정안전부 [주민등록 인구통계](https://jumin.mois.go.kr/) — 공공누리 제1유형. 원본 CSV 사본은 [SimpleisNice/korea-population-dashboard](https://github.com/SimpleisNice/korea-population-dashboard)(MIT)에서 받았습니다 | "행정안전부 주민등록 인구통계(2026.07)" |
| 지점 주소 검색 결과 | 실행할 때만 (저장소에 없음) | © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, ODbL — Nominatim | "© OpenStreetMap 기여자" |

이 도구가 만드는 PNG · PPTX 는 출처를 켜면 위 문구를 그림 아래(PPTX 는 슬라이드 오른쪽 아래)에 자동으로 넣습니다.
경계는 단순화한 것이라 실제와 수십 m 차이가 날 수 있습니다. 측량 · 법적 용도로 쓰지 마세요.

## 함께 들어 있는 외부 파일

| 파일 | 원본 | 라이선스 |
|---|---|---|
| `web/vendor/pptxgen.bundle.js` | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) 4.0.1 | MIT — `web/vendor/pptxgenjs.LICENSE` |
| `web/vendor/fonts/Pretendard-*.subset.woff2` | [Pretendard](https://github.com/orioncactus/pretendard) 1.3.9 | SIL Open Font License 1.1 — `web/vendor/fonts/Pretendard-LICENSE.txt` |

## npm 으로 받는 라이브러리 (저장소에는 없음)

| 패키지 | 라이선스 |
|---|---|
| `@modelcontextprotocol/sdk` | MIT |
| `@resvg/resvg-js` | MPL-2.0 |
| `pptxgenjs` | MIT |
| `pretendard` | OFL-1.1 |
| `zod` | MIT |
