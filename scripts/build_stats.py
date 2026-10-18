"""행정안전부 주민등록 인구통계 CSV → 웹 도구 기본 통계(web/data/stats.js).

원본: 행정안전부 주민등록 인구통계 (https://jumin.mois.go.kr) 월간 CSV
      - 연령별인구현황(10세 단위), 주민등록인구및세대현황
      data/mois/ 에 둔 파일을 읽는다 (CP949). 같은 형식의 새 달 파일을 넣고 다시 돌리면 갱신된다.

    python scripts/build_stats.py

지표: 총인구, 세대수, 세대당 인구, 남녀, 성비, 10세 단위 연령, 20~39세·60세 이상·70세 이상·0~19세 인구와 비율,
      고령화 지수(60세 이상 ÷ 0~19세), 1년 전 같은 달 대비 인구 증감.
원본 연령이 10세 단위라 통계청 공식 정의(청년 19~34세, 노인 65세 이상)와 같은 값은 만들 수 없다.
"""

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "mois"
OUT = ROOT / "web" / "data" / "stats.js"

ROW_RE = re.compile(r"^(.*?)\s*\((\d{10})\)\s*$")
BANDS = ["0~9세", "10~19세", "20~29세", "30~39세", "40~49세", "50~59세", "60~69세", "70~79세", "80~89세", "90~99세", "100세 이상"]


def read(path):
    with open(path, encoding="cp949", newline="") as f:
        rows = list(csv.reader(f))
    head, body = rows[0], rows[1:]
    out = {}
    for r in body:
        m = ROW_RE.match(r[0])
        if not m:
            continue
        name, code = m.group(1).strip(), m.group(2)
        out[code] = (name, {h: v for h, v in zip(head[1:], r[1:])})
    return out


def num(v):
    v = (v or "").replace(",", "").strip()
    return float(v) if v else None


def months(table):
    found = set()
    for _, (_, cols) in table.items():
        for h in cols:
            m = re.match(r"(\d{4})년(\d{2})월_", h)
            if m:
                found.add(m.group(1) + m.group(2))
        break
    return sorted(found)


def main():
    files = sorted(SRC.glob("*.csv"))
    hh = {}  # 월 → {code: (name, cols)}
    age = {}
    for f in files:
        t = read(f)
        target = age if "연령별" in f.name else hh
        for mth in months(t):
            target.setdefault(mth, {})
            for code, (name, cols) in t.items():
                target[mth][code] = (name, {k.split("_", 1)[1]: v for k, v in cols.items() if k.startswith(f"{mth[:4]}년{mth[4:]}월_")})
    latest = max(set(hh) & set(age))
    prev = f"{int(latest[:4]) - 1}{latest[4:]}"
    print("latest", latest, "prev", prev, "prev available", prev in hh)

    cols = [
        ("pop", "총인구", "count"), ("hh", "세대수", "count"), ("hhsize", "세대당 인구", "index"),
        ("male", "남자 인구", "count"), ("female", "여자 인구", "count"), ("sexR", "성비(여자 100명당 남자)", "index"),
        ("kid", "0~19세 인구", "count"), ("kidR", "0~19세 비율", "pct"),
        ("young", "20~39세 인구", "count"), ("youngR", "20~39세 비율", "pct"),
        ("mid", "40~59세 인구", "count"), ("midR", "40~59세 비율", "pct"),
        ("old60", "60세 이상 인구", "count"), ("old60R", "60세 이상 비율", "pct"),
        ("old70", "70세 이상 인구", "count"), ("old70R", "70세 이상 비율", "pct"),
        ("agingI", "고령화 지수(60세 이상 ÷ 0~19세 ×100)", "index"),
        ("yoy", f"1년 전 대비 인구 증감({prev[:4]}.{prev[4:]}→{latest[:4]}.{latest[4:]})", "count"),
        ("yoyR", "1년 전 대비 인구 증감률", "pct"),
    ] + [(f"a{i}", f"{b} 인구", "count") for i, b in enumerate(BANDS)]

    # 1년 전 값: 코드가 같으면 그대로, 행정구역이 바뀐 곳은 이름으로 찾는다 (전남광주통합 = 광주 + 전남)
    prev_by_code = {c: num(v[1].get("거주자 인구수")) for c, v in hh.get(prev, {}).items()}
    prev_by_name = {}
    for c, (name, v) in hh.get(prev, {}).items():
        prev_by_name[re.sub(r"\s+", " ", name)] = num(v.get("거주자 인구수"))
    MERGED = {"전남광주통합특별시": ["광주광역시", "전라남도"]}

    def prev_pop(code, name):
        if code in prev_by_code and prev_by_code[code]:
            return prev_by_code[code]
        parts = name.split(" ", 1)
        if parts[0] in MERGED:
            if len(parts) == 1:
                vals = [prev_by_name.get(o) for o in MERGED[parts[0]]]
                return sum(vals) if all(vals) else None
            for o in MERGED[parts[0]]:
                v = prev_by_name.get(f"{o} {parts[1]}")
                if v:
                    return v
        return None

    rows = {}
    for code, (name, h) in hh[latest].items():
        a = age[latest].get(code, (None, {}))[1]
        pop = num(h.get("거주자 인구수"))
        if not pop:
            continue  # 출장소처럼 인구가 0 인 줄
        bands = [num(a.get(f"거주자_{b}")) or 0 for b in BANDS]
        male, female = num(h.get("남자 인구수")), num(h.get("여자 인구수"))
        kid, young, mid = sum(bands[0:2]), sum(bands[2:4]), sum(bands[4:6])
        old60, old70 = sum(bands[6:]), sum(bands[7:])
        p = prev_pop(code, name)
        r = lambda x: round(100 * x / pop, 2)  # noqa: E731
        vals = {
            "pop": pop, "hh": num(h.get("세대수")), "hhsize": num(h.get("세대당 인구")),
            "male": male, "female": female, "sexR": round(100 * male / female, 1) if male and female else None,
            "kid": kid, "kidR": r(kid), "young": young, "youngR": r(young), "mid": mid, "midR": r(mid),
            "old60": old60, "old60R": r(old60), "old70": old70, "old70R": r(old70),
            "agingI": round(100 * old60 / kid, 1) if kid else None,
            "yoy": pop - p if p else None, "yoyR": round(100 * (pop - p) / p, 2) if p else None,
        }
        vals.update({f"a{i}": v for i, v in enumerate(bands)})
        rows[code] = [name] + [vals[c[0]] for c in cols]

    meta = dict(
        month=f"{latest[:4]}.{latest[4:]}",
        source="행정안전부 주민등록 인구통계 (jumin.mois.go.kr)",
        note="거주자 기준. 연령은 원본이 10세 단위라 청년(19~34세)·노인(65세 이상) 공식 정의 대신 20~39세·60세 이상 등으로 나눴습니다.",
    )
    data = dict(meta=meta, cols=[dict(id=c, name=n, kind=k) for c, n, k in cols], rows=rows)
    js = 'KRMAP_LOAD("stats",' + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ");\n"
    OUT.write_text(js, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} {len(rows)} regions {len(js.encode()) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
