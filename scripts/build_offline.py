"""把 index.html / style.css / app.js / data.js 打包成单文件 HTML。

输出: ../dist/offline.html
用途: 通过微信 / AirDrop / U 盘发给学生，双击即开，断网可用。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "index.html"
CSS = ROOT / "assets" / "style.css"
APP_JS = ROOT / "assets" / "app.js"
DATA_JS = ROOT / "assets" / "data.js"
OUT = ROOT / "dist" / "offline.html"


def main() -> None:
    html = HTML.read_text(encoding="utf-8")
    css = CSS.read_text(encoding="utf-8")
    data_js = DATA_JS.read_text(encoding="utf-8")
    app_js = APP_JS.read_text(encoding="utf-8")

    # 替换 stylesheet 引用 -> 内联 style
    html = html.replace(
        '<link rel="stylesheet" href="./assets/style.css" />',
        f"<style>\n{css}\n</style>",
    )
    # 替换 script 引用 -> 内联 script
    html = html.replace(
        '<script src="./assets/data.js"></script>',
        f"<script>\n{data_js}\n</script>",
    )
    html = html.replace(
        '<script src="./assets/app.js"></script>',
        f"<script>\n{app_js}\n</script>",
    )

    # 简单一致性检查：没有残留外链
    assert "./assets/" not in html, "仍有未替换的 ./assets/ 引用"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    size_kb = len(html.encode("utf-8")) / 1024
    print(f"已生成 {OUT.relative_to(ROOT)} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
