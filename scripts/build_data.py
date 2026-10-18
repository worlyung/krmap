"""대한민국 행정구역(시도/시군구/읍면동) 경계 → 웹 도구용 데이터 생성.

경계 원본: vuski/admdongkor (통계청 SGIS 행정동 경계 기반, 공공누리 1유형 / CC BY 4.0)

    pip install -r scripts/requirements.txt
    python scripts/build_data.py              # 최신 시점
    python scripts/build_data.py 20261001     # 특정 시점

출력: web/data/base.js (시도·시군구·통합시 + 인접표), web/data/emd.js (읍면동 + 인접표)
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import admdongkor as adk
import shapely
from shapely import STRtree
from shapely.ops import polylabel

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"

# EPSG:5179 좌표를 UNIT(m) 단위 정수 격자로 옮긴 뒤 y축을 뒤집어 SVG 좌표로 쓴다.
UNIT = 10
X0, Y1 = 740000, 2075000
# 이 거리(m) 이내로 맞닿으면 인접한 것으로 본다 (단순화 경계의 미세한 틈 보정).
TOUCH_TOL = 50

LEVELS = ["sido", "sgg", "si", "emd"]


def to_frame(geom):
    """(Multi)Polygon → [[ring, ...], ...]; ring = 델타 인코딩 정수 배열 [x0,y0,dx1,dy1,...]."""
    polys = []
    for poly in getattr(geom, "geoms", [geom]):
        rings = []
        for ring in [poly.exterior, *poly.interiors]:
            pts = []
            for x, y in ring.coords:
                p = (round((x - X0) / UNIT), round((Y1 - y) / UNIT))
                if not pts or pts[-1] != p:
                    pts.append(p)
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts.pop()
            if len(pts) < 3:
                continue
            flat = [pts[0][0], pts[0][1]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                flat += [bx - ax, by - ay]
            rings.append(flat)
        if rings:
            polys.append(rings)
    return polys


def label_point(geom):
    biggest = max(getattr(geom, "geoms", [geom]), key=lambda p: p.area)
    p = polylabel(biggest, tolerance=UNIT * 5)
    return [round((p.x - X0) / UNIT), round((Y1 - p.y) / UNIT)]


def bbox(geom):
    x0, y0, x1, y1 = geom.bounds
    return [
        round((x0 - X0) / UNIT),
        round((Y1 - y1) / UNIT),
        round((x1 - X0) / UNIT),
        round((Y1 - y0) / UNIT),
    ]


def split_gu(name):
    """'수원시장안구' → ('수원시', '장안구'); 일반구가 아니면 (None, name)."""
    m = re.fullmatch(r"(.+?시)(.+구)", name)
    return (m.group(1), m.group(2)) if m else (None, name)


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else adk.versions()[-1]
    print("version", version)
    sido = adk.get(version, "sido")
    sgg = adk.get(version, "sgg")
    emd = adk.get(version, "emd")

    sido_nm = dict(zip(sido.sidocd, sido.sidonm))

    # 레벨별 피처: id → dict(meta), geom
    feats = {lv: {} for lv in LEVELS}
    geoms = {lv: {} for lv in LEVELS}

    for r in sido.itertuples():
        feats["sido"][r.sidocd] = dict(nm=r.sidonm, full=r.sidonm, sido=r.sidocd)
        geoms["sido"][r.sidocd] = r.geometry

    si_members = defaultdict(list)
    for r in sgg.itertuples():
        city, gu = split_gu(r.sggnm)
        f = dict(nm=gu, full=" ".join(filter(None, [sido_nm[r.sidocd], city, gu])), sido=r.sidocd)
        if city:
            f["city"] = city
            si_members[(r.sggcd[:4] + "0", city)].append(r.sggcd)
        feats["sgg"][r.sggcd] = f
        geoms["sgg"][r.sggcd] = r.geometry

    # si: 일반구를 가진 시는 하나로 합친 시군구 레이어
    gu_to_si = {}
    for (code, city), members in si_members.items():
        for m in members:
            gu_to_si[m] = code
        sd = feats["sgg"][members[0]]["sido"]
        feats["si"][code] = dict(nm=city, full=f"{sido_nm[sd]} {city}", sido=sd, gu=sorted(members))
        geoms["si"][code] = shapely.union_all([geoms["sgg"][m] for m in members])
    for code, f in feats["sgg"].items():
        if code not in gu_to_si:
            feats["si"][code] = dict(f)
            geoms["si"][code] = geoms["sgg"][code]

    for r in emd.itertuples():
        city, gu = split_gu(r.sggnm)
        feats["emd"][r.emdcd] = dict(
            nm=r.emdnm,
            full=" ".join(filter(None, [sido_nm[r.sidocd], city, gu, r.emdnm])),
            sido=r.sidocd,
            sgg=r.sggcd,
            si=gu_to_si.get(r.sggcd, r.sggcd),
        )
        geoms["emd"][r.emdcd] = r.geometry

    # 소속 관계: 상위 레벨 id 를 기록해 "대상 안쪽" 판별에 쓴다
    for code, f in feats["sgg"].items():
        f["si"] = gu_to_si.get(code, code)
    for code, f in feats["si"].items():
        f["si"] = code

    def parents(lv, code):
        f = feats[lv][code]
        return {("sido", f["sido"]), ("sgg", f.get("sgg", code if lv == "sgg" else None)), ("si", f.get("si"))}

    def contains(a_lv, a_code, b_lv, b_code):
        """a 가 b 를 포함(또는 같음)하면 True."""
        order = {"sido": 0, "si": 1, "sgg": 2, "emd": 3}
        if a_lv == b_lv:
            return a_code == b_code
        if order[a_lv] > order[b_lv]:
            return False
        if a_lv == "si" and b_lv == "sgg":
            return feats["sgg"][b_code]["si"] == a_code
        return (a_lv, a_code) in parents(b_lv, b_code)

    # 인접표: nb["A>B"][A의 id] = A 바깥에서 A와 맞닿은 B 레벨 id 목록
    trees = {}
    for lv in LEVELS:
        ids = list(geoms[lv])
        trees[lv] = (ids, STRtree([geoms[lv][i] for i in ids]))

    nb = {}
    for a in LEVELS:
        for b in LEVELS:
            ids_b, tree = trees[b]
            table = {}
            for code, g in geoms[a].items():
                hits = tree.query(g, predicate="dwithin", distance=TOUCH_TOL)
                out = [ids_b[i] for i in hits if not contains(a, code, b, ids_b[i]) and not contains(b, ids_b[i], a, code)]
                table[code] = sorted(out)
            nb[f"{a}>{b}"] = table
            print(f"neighbors {a}>{b}: avg {sum(map(len, table.values())) / len(table):.1f}")

    def layer(lv):
        out = {}
        for code, f in feats[lv].items():
            g = geoms[lv][code]
            out[code] = dict(f, g=to_frame(g), lp=label_point(g), bb=bbox(g), a=round(g.area / 1e6, 2))
        return out

    meta = dict(
        version=version,
        unit=UNIT,
        origin=[X0, Y1],
        crs="EPSG:5179",
        source="통계청 SGIS 행정구역 경계 (공공누리 제1유형) · github.com/vuski/admdongkor (CC BY 4.0)",
    )
    base_nb = {k: v for k, v in nb.items() if "emd" not in k}
    emd_nb = {k: v for k, v in nb.items() if "emd" in k}
    base = dict(meta=meta, sido=layer("sido"), sgg=layer("sgg"), si=layer("si"), nb=base_nb)
    emd_data = dict(emd=layer("emd"), nb=emd_nb)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in [("base", base), ("emd", emd_data)]:
        js = f'KRMAP_LOAD("{name}",' + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ");\n"
        (OUT / f"{name}.js").write_text(js, encoding="utf-8")
        print(f"wrote web/data/{name}.js {len(js.encode()) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
