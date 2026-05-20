"""把 PDF 目录解析成结构化 JSON。

输入: ../W020260427440749576927.pdf
输出: ../data/majors-2026.json

数据结构:
{
  "meta": {...},
  "stats": {"categories": int, "classes": int, "majors": int},
  "categories": [
    {
      "code": "01",
      "name": "哲学",
      "classes": [
        {
          "code": "0101",
          "name": "哲学类",
          "majors": [
            {
              "code": "010101",          # 含 T/K 后缀
              "name": "哲学",
              "isSpecial": false,         # 代码后缀含 T
              "isControlled": false,      # 代码后缀含 K
              "note": null,               # 括注内容
              "intro": null               # 预留：后续补充专业介绍
            }
          ]
        }
      ]
    }
  ]
}
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "W020260427440749576927.pdf"
OUT_JSON = ROOT / "data" / "majors-2026.json"
OUT_JS = ROOT / "assets" / "data.js"

# 门类行：例 `01 学科门类：哲学`
CATEGORY_RE = re.compile(r"^(\d{2})\s+学科门类：(.+)$")
# 专业类行：例 `0101 哲学类`（4 位代码 + 空格 + 以"类"结尾）
CLASS_RE = re.compile(r"^(\d{4})\s+(.+类)$")
# 专业行：例 `010103K 宗教学（注：xxx）`
MAJOR_RE = re.compile(r"^(\d{6,7})(TK|KT|T|K)?\s+(.+)$")
# 页码行：例 `— 4 —`
PAGE_RE = re.compile(r"^—\s*\d+\s*—$")

# 14 学科门类（交叉学科）没有显式专业类层级，统一挂到一个虚拟专业类下
SYNTHETIC_CLASS_SUFFIX = "00"


def extract_lines() -> list[str]:
    """逐页抽取文本，剔除空行和页码行。"""
    lines: list[str] = []
    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.split("\n"):
                line = raw.strip()
                if not line:
                    continue
                if PAGE_RE.match(line):
                    continue
                lines.append(line)
    return lines


def merge_wrapped(lines: list[str]) -> list[str]:
    """合并由 PDF 自动换行造成的续行。

    判断规则：不匹配 门类/专业类/专业 三种行首格式的行视为续行，附加到前一行末尾。
    页码已在 extract_lines 中过滤。
    """
    merged: list[str] = []
    for line in lines:
        is_header = bool(
            CATEGORY_RE.match(line)
            or CLASS_RE.match(line)
            or MAJOR_RE.match(line)
        )
        if is_header or not merged:
            merged.append(line)
        else:
            merged[-1] = merged[-1] + line
    return merged


def split_name_and_note(text: str) -> tuple[str, str | None]:
    """从 `名称（注：内容）` 中拆出名称与注释。注释可能含多句和句号。"""
    m = re.match(r"^(.+?)（注：(.+)）\s*$", text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text.strip(), None


def parse() -> dict:
    raw_lines = extract_lines()
    # 跳过封面与说明，定位到第一个 `01 学科门类：哲学`
    start = next(i for i, l in enumerate(raw_lines) if CATEGORY_RE.match(l))
    lines = merge_wrapped(raw_lines[start:])

    categories: list[dict] = []
    current_cat: dict | None = None
    current_cls: dict | None = None

    for line in lines:
        if m := CATEGORY_RE.match(line):
            current_cat = {
                "code": m.group(1),
                "name": m.group(2).strip(),
                "classes": [],
            }
            categories.append(current_cat)
            current_cls = None
            continue

        if (m := CLASS_RE.match(line)) and current_cat is not None:
            current_cls = {
                "code": m.group(1),
                "name": m.group(2).strip(),
                "majors": [],
            }
            current_cat["classes"].append(current_cls)
            continue

        if (m := MAJOR_RE.match(line)) and current_cat is not None:
            digits = m.group(1)
            suffix = m.group(2) or ""
            name, note = split_name_and_note(m.group(3))
            # 交叉学科等无显式专业类层级时，临时挂载到虚拟专业类
            if current_cls is None:
                current_cls = {
                    "code": current_cat["code"] + SYNTHETIC_CLASS_SUFFIX,
                    "name": current_cat["name"] + "类",
                    "majors": [],
                    "synthetic": True,  # 14 交叉学科无显式专业类，UI 不渲染该层
                }
                current_cat["classes"].append(current_cls)
            current_cls["majors"].append({
                "code": digits + suffix,
                "name": name,
                "isSpecial": "T" in suffix,
                "isControlled": "K" in suffix,
                "note": note,
                "intro": None,
            })
            continue

    return categories


def build_payload(categories: list[dict]) -> dict:
    n_classes = sum(
        1
        for c in categories
        for cls in c["classes"]
        if not cls.get("synthetic")
    )
    n_majors = sum(len(cls["majors"]) for c in categories for cls in c["classes"])
    return {
        "meta": {
            "title": "普通高等学校本科专业目录",
            "year": 2026,
            "publisher": "中华人民共和国教育部",
            "publishDate": "2026 年 4 月",
            "source": "教育部官网附件 W020260427440749576927.pdf",
            "notes": [
                "《普通高等学校本科专业目录》是高等教育工作的基本指导性文件之一。它规定专业划分、名称及所属门类，是设置和调整专业、实施人才培养、安排招生、授予学位、指导就业，进行教育统计和人才需求预测等工作的重要依据。专业目录每年更新发布。",
                "专业目录包含基本专业和特设专业。基本专业一般是指学科基础比较成熟、社会需求相对稳定、布点数量相对较多、继承性较好的专业。特设专业是满足经济社会发展特殊需求所设置的专业，在专业代码后加“T”表示。",
                "专业目录中涉及国家安全、特殊行业等专业由国家控制布点，称为国家控制布点专业，在专业代码后加“K”表示。",
                "专业目录所列专业，除已注明者外，均按所在学科门类授予相应的学位。对已注明了学位授予门类的专业，按照注明的学科门类授予相应的学位；可授两种（或以上）学位门类的专业，原则上由有关高等学校在设置专业布点时确定授予其中一种。",
                "本科教育的基本修业年限为四至五年，各专业修业年限由有关高等学校在设置专业布点时确定，专业目录不再单独列出。",
            ],
        },
        "stats": {
            "categories": len(categories),
            "classes": n_classes,
            "majors": n_majors,
        },
        "categories": categories,
    }


def main() -> None:
    categories = parse()
    payload = build_payload(categories)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    pretty = json.dumps(payload, ensure_ascii=False, indent=2)
    compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_JSON.write_text(pretty, encoding="utf-8")
    # data.js 写成可被本地 file:// 直接加载的脚本，避免 fetch 受限
    OUT_JS.write_text(
        f"window.MAJORS_DATA = {compact};\n",
        encoding="utf-8",
    )
    s = payload["stats"]
    print(f"门类 {s['categories']} / 专业类 {s['classes']} / 专业 {s['majors']}")
    print(f"已写入 {OUT_JSON.relative_to(ROOT)}, {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
