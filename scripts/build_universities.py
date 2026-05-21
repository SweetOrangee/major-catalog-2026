"""从 ksyx 抓取数据（必备）+ schinfo / Chinese_Universities.csv（可选）合并出
全国高校元数据表 data/universities.json。

输出结构：
  {
    "provinces": {"11":"北京","12":"天津",...},
    "list": [
      {
        "yxdm": "10001",
        "name": "北京大学",
        "ssdm": "11",
        "syl": true,               # 是否双一流建设高校（schinfo 才有）
        "schid": "1",              # 阳光高考内部院校 ID，用于外链（schinfo 才有）
        "tags": ["985","211","一流大学A类"]  # Chinese_Universities.csv 的 note 解析
      },
      ...（按 yxdm 升序）
    ]
  }

无 schinfo / csv 时只填基础三字段，UI 渲染需做空值兜底。
"""
from __future__ import annotations
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KSYX = ROOT / "scratch" / "raw" / "ksyx_full.json"
SCHINFO = ROOT / "scratch" / "raw" / "schinfo_full.json"      # 可选
CSV_RANK = ROOT / "Chinese_Universities.csv"                  # 可选
OUT = ROOT / "data" / "universities.json"


def normalize_name(s: str) -> str:
    """用于跨数据源做院校名匹配的归一化：去括号注释/空格/常见后缀差异"""
    s = re.sub(r"[（(].*?[)）]", "", s)  # 去括号里的注释
    s = re.sub(r"\s+", "", s)
    return s


def load_from_ksyx() -> tuple[dict, dict]:
    """返回 (universities_dict by yxdm, provinces_map by ssdm)"""
    raw = json.load(open(KSYX, encoding="utf-8"))
    universities: dict[str, dict] = {}
    provinces: dict[str, str] = {}
    for spec_id, item in raw.items():
        for p in item.get("provinces") or []:
            if p.get("code") and p.get("name"):
                provinces[p["code"]] = p["name"]
        for s in item.get("schools") or []:
            yxdm = s.get("yxdm")
            if not yxdm:
                continue
            if yxdm not in universities:
                universities[yxdm] = {
                    "yxdm": yxdm,
                    "name": s.get("yxmc"),
                    "ssdm": s.get("ssdm"),
                }
            # 偶尔同名院校 ssdm 不一致，保留首次出现的
    return universities, provinces


def enrich_from_schinfo(universities: dict) -> int:
    """如果 schinfo_full.json 存在则按 yxdm 补 syl + schid（用于双一流标签和外链）。

    主管部门 zgbmmc、研究生院 yjsy 字段在 handbook 上对学生意义不大，故不采纳。
    """
    if not SCHINFO.exists():
        return 0
    raw = json.load(open(SCHINFO, encoding="utf-8"))
    n = 0
    for item in raw:
        yxdm = item.get("yxdm")
        if not yxdm or yxdm not in universities:
            continue
        u = universities[yxdm]
        if item.get("syl"):
            u["syl"] = True
        if item.get("schid"):
            u["schid"] = item["schid"]
        n += 1
    return n


def parse_csv_note(note: str) -> list[str]:
    """note 字段示例：'一流大学A类/985/211' → ['985','211','一流大学A类']

    "一流学科"是研究生一级学科建设，与本科专业编码体系不同，
    挂在专业页会误导学生，这里直接过滤掉。
    """
    keep = {"985", "211", "一流大学A类", "一流大学B类"}
    tags = [t.strip() for t in (note or "").split("/") if t.strip() in keep]
    priority = {"985": 0, "211": 1, "一流大学A类": 2, "一流大学B类": 3}
    tags.sort(key=lambda t: priority[t])
    return tags


def enrich_from_csv(universities: dict) -> tuple[int, list[str]]:
    """按院校名匹配 Chinese_Universities.csv，补 tags 字段。返回 (匹配数, 未匹配名单)"""
    if not CSV_RANK.exists():
        return 0, []
    rows = list(csv.DictReader(open(CSV_RANK, encoding="gbk")))

    # 建归一名 -> yxdm 索引
    name_idx = {normalize_name(u["name"] or ""): yxdm for yxdm, u in universities.items()}

    matched = 0
    unmatched = []
    for r in rows:
        nm = normalize_name(r["name"])
        yxdm = name_idx.get(nm)
        if not yxdm:
            unmatched.append(r["name"])
            continue
        tags = parse_csv_note(r.get("note", ""))
        if tags:
            universities[yxdm]["tags"] = tags
        matched += 1
    return matched, unmatched


def main() -> None:
    universities, provinces = load_from_ksyx()
    n_schinfo = enrich_from_schinfo(universities)
    n_csv, unmatched = enrich_from_csv(universities)

    # 按 yxdm 升序
    out_list = sorted(universities.values(), key=lambda u: u["yxdm"])
    obj = {"provinces": provinces, "list": out_list}

    OUT.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

    n_total = len(out_list)
    n_tagged = sum(1 for u in out_list if u.get("tags"))
    n_syl = sum(1 for u in out_list if u.get("syl"))
    print(f"院校总数:     {n_total}")
    print(f"省份映射:     {len(provinces)}")
    print(f"  schinfo 补充: {n_schinfo} 所 (省份名/主管部门/双一流/研究生院)")
    print(f"  csv 打标签:   {n_csv} 所 → 其中有 tags 的 {n_tagged} 所")
    print(f"  双一流 syl:   {n_syl} 所")
    if unmatched:
        print(f"  csv 未匹配 {len(unmatched)} 条（示例）: {unmatched[:5]}")
    print()
    print(f"universities.json: {OUT.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
