"""从 ksyx 抓取数据（必备）+ schinfo（可选）合并出
全国高校元数据表 data/universities.json，并按内置权威名单打 985/211/一流大学 A 类/B 类标签。

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
        "tags": ["985","211","一流大学A类"]  # 按内置权威名单打的标签
      },
      ...（按 yxdm 升序）
    ]
  }

无 schinfo 时只填基础三字段 + tags，UI 渲染需做空值兜底。
之前依赖外部 Chinese_Universities.csv 做名字模糊匹配会漏标十几所院校（如北师大、央财、大工等），
现改为内置权威名单（985/211/一流大学 A 类/B 类多年不变，可靠性高）。
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KSYX = ROOT / "scratch" / "raw" / "ksyx_full.json"
SCHINFO = ROOT / "scratch" / "raw" / "schinfo_full.json"      # 可选
OUT = ROOT / "data" / "universities.json"


# =========================================================
# 权威名单（按教育部历史公布，已稳定多年）
# 匹配规则：与 universities.json 里院校名 normalize 后严格相等
#   - 多校区（哈工大本部/威海/深圳）normalize 去括号后名字一致，会同时被标 → 预期
#   - 独立学院（XX 分校）normalize 后名字带"分校"二字，不会误标 → 预期
# =========================================================

# 985 工程：共 39 所
NAMES_985 = {
    # 北京 (8)
    "北京大学", "中国人民大学", "清华大学",
    "北京航空航天大学", "北京理工大学", "中国农业大学",
    "北京师范大学", "中央民族大学",
    # 天津 (2)
    "南开大学", "天津大学",
    # 辽宁 (2)
    "大连理工大学", "东北大学",
    # 吉林 (1)
    "吉林大学",
    # 黑龙江 (1)
    "哈尔滨工业大学",
    # 上海 (4)
    "复旦大学", "同济大学", "上海交通大学", "华东师范大学",
    # 江苏 (2)
    "南京大学", "东南大学",
    # 浙江 (1)
    "浙江大学",
    # 安徽 (1)
    "中国科学技术大学",
    # 福建 (1)
    "厦门大学",
    # 山东 (2)
    "山东大学", "中国海洋大学",
    # 湖北 (2)
    "武汉大学", "华中科技大学",
    # 湖南 (3)
    "中南大学", "湖南大学", "国防科技大学",
    # 广东 (2)
    "中山大学", "华南理工大学",
    # 重庆 (1)
    "重庆大学",
    # 四川 (2)
    "四川大学", "电子科技大学",
    # 陕西 (3)
    "西安交通大学", "西北工业大学", "西北农林科技大学",
    # 甘肃 (1)
    "兰州大学",
}

# 一流大学 B 类：985 院校中的 3 所 + 新疆/云南/郑州 共 6 所
NAMES_FIRST_CLASS_B = {
    "东北大学", "湖南大学", "西北农林科技大学",
    "新疆大学", "云南大学", "郑州大学",
}

# 一流大学 A 类：985 减去归入 B 类的 3 所 = 36 所
NAMES_FIRST_CLASS_A = NAMES_985 - {"东北大学", "湖南大学", "西北农林科技大学"}

# 211 工程：39 所 985 + 73 所非 985 = 112 所（不含 3 所军事院校，加上后为 115 所）
# 这里采纳"广义 211"——包含 3 所原 211 军校：国防科大、海军军医大学（原第二军医）、空军军医大学（原第四军医）
# 国防科大在 985 集合里，所以下面"非 985 的 211"再加 2 所军校
NAMES_211_NON985 = {
    # 北京 (18 = 26 北京 211 - 8 北京 985)
    "北京交通大学", "北京工业大学", "北京科技大学",
    "北京化工大学", "北京邮电大学", "北京林业大学",
    "北京中医药大学", "北京外国语大学", "中国传媒大学",
    "中央财经大学", "对外经济贸易大学", "北京体育大学",
    "中央音乐学院", "中国政法大学", "华北电力大学",
    "中国矿业大学(北京)", "中国石油大学(北京)", "中国地质大学(北京)",
    # 天津 (2)
    "天津医科大学", "河北工业大学",  # 河工大本部在天津
    # 山西 (1)
    "太原理工大学",
    # 内蒙古 (1)
    "内蒙古大学",
    # 辽宁 (2)
    "辽宁大学", "大连海事大学",
    # 吉林 (2)
    "延边大学", "东北师范大学",
    # 黑龙江 (3)
    "哈尔滨工程大学", "东北农业大学", "东北林业大学",
    # 上海 (6 = 10 上海 211 - 4 上海 985)
    "华东理工大学", "东华大学", "上海外国语大学",
    "上海财经大学", "上海大学", "海军军医大学",  # 原第二军医大学
    # 江苏 (9 = 11 江苏 211 - 2 江苏 985)
    "苏州大学", "南京航空航天大学", "南京理工大学",
    "中国矿业大学", "河海大学", "江南大学",
    "南京农业大学", "中国药科大学", "南京师范大学",
    # 安徽 (2)
    "合肥工业大学", "安徽大学",
    # 福建 (1)
    "福州大学",
    # 江西 (1)
    "南昌大学",
    # 山东 (1)
    "中国石油大学(华东)",
    # 湖北 (5)
    "中南财经政法大学", "华中农业大学", "华中师范大学",
    "武汉理工大学", "中国地质大学(武汉)",
    # 湖南 (1，国防科大已在 985)
    "湖南师范大学",
    # 广东 (2)
    "暨南大学", "华南师范大学",
    # 广西 (1)
    "广西大学",
    # 海南 (1)
    "海南大学",
    # 重庆 (1)
    "西南大学",
    # 四川 (3)
    "西南交通大学", "四川农业大学", "西南财经大学",
    # 贵州 (1)
    "贵州大学",
    # 云南 (1)
    "云南大学",
    # 陕西 (5)
    "西北大学", "西安电子科技大学", "长安大学",
    "陕西师范大学", "空军军医大学",  # 原第四军医大学
    # 新疆 (2)
    "新疆大学", "石河子大学",
    # 宁夏 (1)
    "宁夏大学",
    # 青海 (1)
    "青海大学",
    # 西藏 (1)
    "西藏大学",
}

NAMES_211 = NAMES_985 | NAMES_211_NON985


# tag 输出顺序优先级
TAG_PRIORITY = {"985": 0, "211": 1, "一流大学A类": 2, "一流大学B类": 3}


def normalize_name(s: str) -> str:
    """跨数据源做院校名匹配的归一化：去括号注释/空格"""
    s = re.sub(r"[（(].*?[)）]", "", s)
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
    return universities, provinces


def enrich_from_schinfo(universities: dict) -> int:
    """如果 schinfo_full.json 存在则按 yxdm 补 syl + schid（双一流标签和外链）"""
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


def enrich_from_builtin(universities: dict) -> dict:
    """按内置权威名单给每所院校打 985/211/一流A类/一流B类 tag。

    匹配规则：normalize 后严格相等。这样：
      - 多校区（哈工大本部/威海/深圳）会被同时标记（normalize 去括号后名字一致）
      - 独立学院（"XX 分校"）不会被误标（normalize 后多了"分校"二字）
    """
    # 反向索引：normalized name → [yxdm,...]
    rev_idx: dict[str, list[str]] = {}
    for yxdm, u in universities.items():
        nm = normalize_name(u.get("name") or "")
        rev_idx.setdefault(nm, []).append(yxdm)

    stats = {"985": 0, "211": 0, "一流大学A类": 0, "一流大学B类": 0}
    unmatched: dict[str, list[str]] = {"985": [], "211": [], "一流大学A类": [], "一流大学B类": []}

    def apply(name_set: set[str], tag: str) -> None:
        for raw_name in name_set:
            nm = normalize_name(raw_name)
            yxdms = rev_idx.get(nm)
            if not yxdms:
                unmatched[tag].append(raw_name)
                continue
            for yxdm in yxdms:
                tags = universities[yxdm].setdefault("tags", [])
                if tag not in tags:
                    tags.append(tag)
                    stats[tag] += 1

    apply(NAMES_985, "985")
    apply(NAMES_211, "211")
    apply(NAMES_FIRST_CLASS_A, "一流大学A类")
    apply(NAMES_FIRST_CLASS_B, "一流大学B类")

    # 排序 tags
    for u in universities.values():
        if "tags" in u:
            u["tags"].sort(key=lambda t: TAG_PRIORITY.get(t, 99))

    return {"stats": stats, "unmatched": unmatched}


def main() -> None:
    universities, provinces = load_from_ksyx()
    n_schinfo = enrich_from_schinfo(universities)
    report = enrich_from_builtin(universities)

    # 按 yxdm 升序
    out_list = sorted(universities.values(), key=lambda u: u["yxdm"])
    obj = {"provinces": provinces, "list": out_list}

    OUT.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

    n_total = len(out_list)
    n_tagged = sum(1 for u in out_list if u.get("tags"))
    n_985 = sum(1 for u in out_list if "985" in (u.get("tags") or []))
    n_211 = sum(1 for u in out_list if "211" in (u.get("tags") or []))
    n_A = sum(1 for u in out_list if "一流大学A类" in (u.get("tags") or []))
    n_B = sum(1 for u in out_list if "一流大学B类" in (u.get("tags") or []))
    n_syl = sum(1 for u in out_list if u.get("syl"))
    print(f"院校总数:       {n_total}")
    print(f"省份映射:       {len(provinces)}")
    print(f"  schinfo 补充: {n_schinfo} 所 (syl/schid)")
    print(f"  内置打标:")
    print(f"    985:        {n_985} 所 (权威 39)")
    print(f"    211:        {n_211} 所 (权威 115)")
    print(f"    一流大学A类: {n_A} 所 (权威 36)")
    print(f"    一流大学B类: {n_B} 所 (权威 6)")
    print(f"    有 tag 的:   {n_tagged} 所")
    print(f"  双一流 syl:   {n_syl} 所")
    for tag, miss in report["unmatched"].items():
        if miss:
            print(f"  [警告] {tag} 未匹配 {len(miss)} 条: {miss}")
    print()
    print(f"universities.json: {OUT.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
