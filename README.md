# web2pdf 网页截图

一个 Microsoft Edge / Chrome 浏览器扩展，可以把网页截图保存成 **PDF、PNG 或 JPEG**，适合存档和分享。保存的文件名自动带上网页地址，日后一看就知道出处。

📖 **[安装和使用指南](docs/安装和使用指南.md)**（[PDF 版](docs/安装和使用指南.pdf)）

## 功能

| 截图方式 | 快捷键 | 说明 |
|----------|--------|------|
| 可见区域 | `Alt+Shift+V` | 截当前屏幕看到的部分 |
| 整个网页 | `Alt+Shift+F` | 自动从顶滚到底，拼成一张长图；悬浮的顶栏只出现一次 |
| 选择区域 | `Alt+Shift+S` | 拖动框选，**拖动时可以滚动滚轮**，贴近窗口上下边缘会自动滚动，选区可以超过一屏；松开后可拖手柄微调 |
| 选择元素 | `Alt+Shift+E` | 悬停高亮网页元素，滚轮或 ↑/↓ 切换上级/下级；元素内部有滚动条时（聊天记录、侧栏、代码框）会把里面的内容全部截出来 |

- **保存前预览**：截完先在新标签页查看完整截图，确认内容完整后再选格式保存，也可以重新截图或取消。这个功能可以在弹出菜单里关掉。
- **文件名带网址**：`页面标题_网址_日期-时间.pdf`，直接保存到下载文件夹。
- **长截图**：PDF 是一整页超长页面，不按 A4 分页。超过尺寸上限时自动拆成 `_part1`、`_part2` 等多个文件，拼接处没有缝隙。
- **页面复原**：截图时临时隐藏的悬浮元素、滚动位置，截完都会还原。中途切换或关闭页面会自动放弃，不会留下残缺的文件。

## 安装

1. 下载本仓库：点 **Code → Download ZIP** 并解压，或者 `git clone https://github.com/koardor/web2pdf.git`。
2. 打开 Edge，地址栏输入 `edge://extensions`，打开左下角的 **"开发人员模式"**。
3. 点 **"加载解压缩的扩展"**，选择仓库文件夹（直接包含 `manifest.json` 的那一层）。
4. 点地址栏右侧的拼图图标 🧩，把 **web2pdf 网页截图** 固定到工具栏。

> 想要一个不含测试和开发文件的干净插件文件夹，可以在仓库目录运行 `node tools/build.js`（需要 [Node.js](https://nodejs.org/) 18 或更高版本），然后在第 3 步选择生成的 `dist` 文件夹。

Chrome 的安装步骤相同，地址改为 `chrome://extensions`。

## 使用

点工具栏上的相机图标，选择截图方式和格式，或者直接按快捷键。各个功能的详细操作和常见问题，请看 **[安装和使用指南](docs/安装和使用指南.md)**。

快捷键可以在 `edge://extensions/shortcuts` 修改。

## 已知限制

- `edge://`、`chrome://` 开头的浏览器页面和扩展商店页面不能截图，这是浏览器的限制。
- 只截纵向内容，宽度以浏览器窗口为准。
- 聊天类网页的页面本身不滚动，"整个网页"只能截到一屏，长对话请用"选择元素"。
- 无限滚动、虚拟列表这类边滚动边替换内容的页面，可能拼接不完整。
- 一次截图总高度最多 100,000 像素。

## 开发

纯 JavaScript，Manifest V3，没有构建依赖。PDF 生成使用 [jsPDF](https://github.com/parallax/jsPDF) 2.5.2，已放在 `vendor/` 里。

```bash
npm test                  # 自动测试：文件名、分块与拆分计算、后台调度流程
node tools/serve.js       # 本地服务 http://localhost:8000/ ，用来打开 test/pages/ 下的测试页
node tools/build.js       # 生成只含插件运行文件的 dist/
node tools/make-icons.js  # 重新生成图标
python tools/guide_pdf.py # 重新生成安装和使用指南的 PDF 版（需要 Python 的 markdown 包和 Edge）
```

```
manifest.json
src/
  background.js        后台：调度截图、节流、下载、预览流程
  content/             注入网页的脚本：滚动与还原、区域选择、元素选择
  offscreen/           隐藏页面：拼接截图、按格式编码（PNG/JPEG/PDF）
  popup/               工具栏弹出菜单
  preview/             保存前预览页
  lib/                 纯逻辑：文件名、分块与拆分计算（浏览器和 Node 共用）
test/
  lib/, background.test.js   Node 自动测试
  pages/                     手动测试用网页
  harness/                   在普通网页里模拟扩展环境的测试工具
docs/                  使用指南、设计文档、验收清单
```

在 Edge 里手动测试的项目见 [验收清单](docs/验收清单.md)。

## 许可证

[MIT](LICENSE)。`vendor/jspdf.umd.min.js` 是 jsPDF，同样使用 MIT 许可证，版权归其作者所有。
