"""把阳光高考抓回的详情/解读合并到 majors-2026.json 的 intro 字段。

输入:
  data/majors-2026.json       parse_pdf 生成的原始目录（intro=null）
  scratch/raw/zyk_full.json   阳光高考目录树 + 420 专业详情
  scratch/raw/zyjd_full.json  158 篇专业解读全文

输出:
  data/majors-2026.json       覆盖：每个专业的 intro 字段填充
  assets/data.js              浏览器侧的 compact 版本（被 index.html 引用）

intro 结构（按数据可用性渐进）：
  {
    "specId": "...",                              # 必有；用于外链
    "summary": "...",                             # 仅 hasZyjs=true 才有
    "jyfx": [...], "kyfx": [...],                 # 同上
    "scale": "5000-6000", "gender": [boy, girl],
    "schools": [{"name","rank","count"}],
    "year": "2024",
    "interpretation": {                            # 仅 158 个专业有
      "zyjdId","title","origin","author","gy",
      "sections": [{"title","html"}, ...]
    }
  }

注意：满意度评分（zymyd）作为主观打分不进入 handbook。
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAJORS_JSON = ROOT / "data" / "majors-2026.json"
DATA_JS = ROOT / "assets" / "data.js"
ZYK_FULL = ROOT / "scratch" / "raw" / "zyk_full.json"
ZYJD_FULL = ROOT / "scratch" / "raw" / "zyjd_full.json"


def norm_code(code: str) -> str:
    """去掉 PDF 代码尾部的 T/K，与阳光高考的纯数字代码对齐。"""
    m = re.match(r"^(\d+)", code)
    return m.group(1) if m else code


def build_intro(spec: dict, detail: dict | None, view: dict | None) -> dict:
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

        if detail.get("zytjzsList"):
            intro["schools"] = [
                {
                    "name": x.get("yxmc"),
                    "rank": x.get("rank"),
                    "count": x.get("count"),
                }
                for x in detail["zytjzsList"]
            ]

        if detail.get("year"):
            intro["year"] = detail["year"]

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

    specs_by_zydm = {s["zydm"]: s for s in zyk["catalog"]["specs"]}
    details = zyk.get("details", {})
    # 解读按 specId 索引（每个专业最多 1 篇解读）
    views_by_specid = {
        v["specId"]: v
        for v in zyjd.get("views", {}).values()
        if v.get("specId")
    }

    n_total = 0
    n_with_summary = 0
    n_with_interp = 0
    n_no_chsi = 0  # 在 PDF 但阳光高考查无此码

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
                m["intro"] = build_intro(spec, detail, view)
                if "summary" in m["intro"]:
                    n_with_summary += 1
                if "interpretation" in m["intro"]:
                    n_with_interp += 1

    majors["stats"]["withSummary"] = n_with_summary
    majors["stats"]["withInterpretation"] = n_with_interp

    pretty = json.dumps(majors, ensure_ascii=False, indent=2)
    compact = json.dumps(majors, ensure_ascii=False, separators=(",", ":"))
    MAJORS_JSON.write_text(pretty, encoding="utf-8")
    DATA_JS.write_text(f"window.MAJORS_DATA = {compact};\n", encoding="utf-8")

    print(f"总专业: {n_total}")
    print(f"  对接到阳光高考: {n_total - n_no_chsi}")
    print(f"  有官方介绍 summary: {n_with_summary}")
    print(f"  有专业解读 interpretation: {n_with_interp}")
    print(f"  在阳光高考查无此码: {n_no_chsi}")
    print()
    print(f"majors-2026.json: {MAJORS_JSON.stat().st_size/1024:.1f} KB (pretty)")
    print(f"data.js:           {DATA_JS.stat().st_size/1024:.1f} KB (compact)")


if __name__ == "__main__":
    main()
