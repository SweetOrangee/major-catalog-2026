"""生成 data/majors-mini.json，给 functions/api/recommend.js 当 prompt 候选列表用。

每项只保留 {code, name, className, categoryName}，文件约 50KB，
Pages Function 每次请求 ASSETS.fetch 加载。
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAJORS_JSON = ROOT / "data" / "majors-2026.json"
OUT = ROOT / "data" / "majors-mini.json"


def main() -> None:
    majors = json.load(open(MAJORS_JSON, encoding="utf-8"))
    out = []
    for cat in majors["categories"]:
        for cls in cat["classes"]:
            for m in cls["majors"]:
                out.append({
                    "code": m["code"],
                    "name": m["name"],
                    "className": cls["name"],
                    "categoryName": cat["name"],
                })
    # 紧凑输出（function 用，节省下行带宽）
    OUT.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"输出 {len(out)} 条专业到 {OUT.relative_to(ROOT)}")
    print(f"文件大小: {OUT.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
