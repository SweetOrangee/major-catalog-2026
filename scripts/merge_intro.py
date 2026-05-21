"""把阳光高考抓回的详情/解读 + 开设院校合并到 majors-2026.json 的 intro 字段。

输入:
  data/majors-2026.json        parse_pdf 生成的原始目录（intro=null）
  scratch/raw/zyk_full.json    阳光高考目录树 + 883 专业详情
  scratch/raw/zyjd_full.json   158 篇专业解读全文
  scratch/raw/ksyx_full.json   每专业的全量开设院校（按 yxdm）
  data/universities.json       由 build_universities.py 生成的院校元数据表

输出:
  data/majors-2026.json        覆盖：每个专业的 intro 字段填充
  assets/data.js               浏览器侧的 compact 版本

intro.schools 字段（引用模式）：
  {"total": 208, "list": ["10001","10002",...]}   # yxdm 升序，UI 再去 UNIVERSITIES 查名/省/标签

注意：旧版的 zytjzsList（带评分的"推荐院校 10 所"）已被 ksyx 全量院校替代，
评分类字段（zymyd / zytjRank）作为主观打分不进入 handbook。
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAJORS_JSON = ROOT / "data" / "majors-2026.json"
UNIV_JSON = ROOT / "data" / "universities.json"
DATA_JS = ROOT / "assets" / "data.js"
ZYK_FULL = ROOT / "scratch" / "raw" / "zyk_full.json"
ZYJD_FULL = ROOT / "scratch" / "raw" / "zyjd_full.json"
KSYX_FULL = ROOT / "scratch" / "raw" / "ksyx_full.json"


def norm_code(code: str) -> str:
    """去掉 PDF 代码尾部的 T/K，与阳光高考的纯数字代码对齐。"""
    m = re.match(r"^(\d+)", code)
    return m.group(1) if m else code


def build_intro(spec: dict, detail: dict | None, view: dict | None, ksyx: dict | None) -> dict:
    intro: dict = {"specId": spec["specId"]}

    if detail:
        desc = ((detail.get("zyjs") or {}).get("desc") or "").strip()
        if desc:
            intro["summary"] = desc

        if detail.get("jyfx"):
            intro["jyfx"] = list(detail["jyfx"])

        if detail.get("kyfx"):
            intro["kyfx"] = [
                {"name": x.get("zymc"), "code": x.get("zydm")}
                for x in detail["kyfx"] if x.get("zymc")
            ]

        if detail.get("xsgm"):
            intro["scale"] = detail["xsgm"]

        boy = detail.get("boyPercent") or 0
        girl = detail.get("girlPercent") or 0
        if boy + girl > 0:
            intro["gender"] = [boy, girl]

        if detail.get("year"):
            intro["year"] = detail["year"]

    # 开设院校：ksyx 全量，按 yxdm 升序的院校代码数组，UI 再用 UNIVERSITIES 查元信息
    if ksyx and ksyx.get("schools"):
        yxdms = sorted({s["yxdm"] for s in ksyx["schools"] if s.get("yxdm")})
        if yxdms:
            intro["schools"] = {"total": ksyx.get("total", len(yxdms)), "list": yxdms}

    if view:
        sections = []
        for sec in view.get("mlList") or []:
            html = (sec.get("content") or "").strip()
            if html:
                sections.append({"title": sec.get("title"), "html": html})

        interp = {
            "zyjdId": view.get("zyjdId"),
            "title": (view.get("title") or "").strip(),
            "origin": (view.get("origin") or "").strip(),
            "author": (view.get("author") or "").strip(),
            "gy": (view.get("gy") or "").strip(),
            "sections": sections,
        }
        intro["interpretation"] = {k: v for k, v in interp.items() if v}

    return intro


def main() -> None:
    majors = json.load(open(MAJORS_JSON, encoding="utf-8"))
    zyk = json.load(open(ZYK_FULL, encoding="utf-8"))
    zyjd = json.load(open(ZYJD_FULL, encoding="utf-8"))
    ksyx = json.load(open(KSYX_FULL, encoding="utf-8")) if KSYX_FULL.exists() else {}
    universities = json.load(open(UNIV_JSON, encoding="utf-8")) if UNIV_JSON.exists() else {"provinces": {}, "list": []}

    specs_by_zydm = {s["zydm"]: s for s in zyk["catalog"]["specs"]}
    details = zyk.get("details", {})
    views_by_specid = {
        v["specId"]: v
        for v in zyjd.get("views", {}).values()
        if v.get("specId")
    }

    n_total = 0
    n_with_summary = 0
    n_with_interp = 0
    n_with_schools = 0
    n_no_chsi = 0

    for cat in majors["categories"]:
        for cls in cat["classes"]:
            for m in cls["majors"]:
                n_total += 1
                spec = specs_by_zydm.get(norm_code(m["code"]))
                if not spec:
                    m["intro"] = None
                    n_no_chsi += 1
                    continue
                detail = details.get(spec["specId"])
                view = views_by_specid.get(spec["specId"])
                ks = ksyx.get(spec["specId"])
                m["intro"] = build_intro(spec, detail, view, ks)
                if "summary" in m["intro"]:
                    n_with_summary += 1
                if "interpretation" in m["intro"]:
                    n_with_interp += 1
                if "schools" in m["intro"]:
                    n_with_schools += 1

    majors["stats"]["withSummary"] = n_with_summary
    majors["stats"]["withInterpretation"] = n_with_interp
    majors["stats"]["withSchools"] = n_with_schools

    pretty = json.dumps(majors, ensure_ascii=False, indent=2)
    compact = json.dumps(majors, ensure_ascii=False, separators=(",", ":"))
    univ_compact = json.dumps(universities, ensure_ascii=False, separators=(",", ":"))

    MAJORS_JSON.write_text(pretty, encoding="utf-8")
    DATA_JS.write_text(
        f"window.MAJORS_DATA = {compact};\n"
        f"window.UNIVERSITIES = {univ_compact};\n",
        encoding="utf-8",
    )

    print(f"总专业: {n_total}")
    print(f"  对接到阳光高考: {n_total - n_no_chsi}")
    print(f"  有官方介绍 summary: {n_with_summary}")
    print(f"  有专业解读 interpretation: {n_with_interp}")
    print(f"  有开设院校 schools:   {n_with_schools}")
    print(f"  在阳光高考查无此码:    {n_no_chsi}")
    print()
    print(f"majors-2026.json:  {MAJORS_JSON.stat().st_size/1024:.1f} KB (pretty)")
    print(f"data.js:           {DATA_JS.stat().st_size/1024:.1f} KB (compact, 含 universities)")


if __name__ == "__main__":
    main()
