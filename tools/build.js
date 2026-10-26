// 生成只含运行所需文件的插件目录 dist/（不含测试、工具、文档）：node tools/build.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const INCLUDE = ['manifest.json', 'icons', 'vendor', 'src'];

fs.rmSync(DIST, { recursive: true, force: true });
for (const item of INCLUDE) fs.cpSync(path.join(ROOT, item), path.join(DIST, item), { recursive: true });

// 检查 manifest 和各页面引用的文件都在
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const refs = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  'src/offscreen/offscreen.html', 'src/preview/preview.html',
  'src/lib/filename.js', 'src/lib/tiles.js', 'src/lib/urls.js',
  'src/content/agent.js', 'src/content/region.js', 'src/content/element.js',
];
const missing = refs.filter((r) => !fs.existsSync(path.join(DIST, r)));
if (missing.length) {
  console.error('缺少文件：', missing);
  process.exit(1);
}
console.log(`dist/ 已生成（版本 ${manifest.version}）`);
