"""把 docs/安装和使用指南.md 转成 PDF：先渲染成带样式的 HTML，再用无界面的 Edge 打印。
用法：python tools/guide_pdf.py"""
import pathlib
import subprocess
import tempfile

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "安装和使用指南.md"
OUT = ROOT / "docs" / "安装和使用指南.pdf"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

CSS = """
@page { size: A4; margin: 16mm 16mm 18mm; }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 10.5pt; line-height: 1.65; color: #1f2937; }
h1 { font-size: 20pt; color: #1d4ed8; margin: 0 0 4pt; }
h1 + p { color: #6b7280; margin-top: 0; }
h2 { font-size: 14pt; color: #1d4ed8; border-bottom: 1.5pt solid #bfdbfe; padding-bottom: 3pt; margin-top: 18pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
hr { display: none; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; break-inside: avoid; }
th, td { border: 0.75pt solid #d1d5db; padding: 4pt 7pt; text-align: left; vertical-align: top; }
th { background: #eff6ff; }
code { font-family: Consolas, "Microsoft YaHei", monospace; background: #f3f4f6; border-radius: 3pt; padding: 0 3pt; font-size: 9.5pt; }
blockquote { margin: 8pt 0; padding: 4pt 10pt; background: #f8fafc; border-left: 3pt solid #93c5fd; color: #374151; break-inside: avoid; }
blockquote p { margin: 3pt 0; }
ul, ol { padding-left: 18pt; }
li { margin: 2pt 0; }
p > strong:first-child { color: #111827; }
"""

html = markdown.markdown(SRC.read_text(encoding="utf-8"), extensions=["tables", "sane_lists"])
page = f"<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><title>web2pdf 安装和使用指南</title><style>{CSS}</style></head><body>{html}</body></html>"

with tempfile.TemporaryDirectory() as tmp:
    src = pathlib.Path(tmp) / "guide.html"
    src.write_text(page, encoding="utf-8")
    subprocess.run([EDGE, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--user-data-dir={pathlib.Path(tmp) / 'profile'}",
                    f"--print-to-pdf={OUT}", src.as_uri()], check=True, timeout=120)
print(f"已生成 {OUT}")
