import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = JSON.parse(await readFile(resolve(root, 'project.config.json'), 'utf8'));
assert.equal(project.miniprogramRoot, 'dist/');
const workspaceProject = JSON.parse(await readFile(resolve(root, '../project.config.json'), 'utf8'));
assert.equal(resolve(root, '../', workspaceProject.miniprogramRoot), resolve(root, 'dist/'), 'repository import must use the same compiled package');
const preview = process.argv.includes('--preview');
const dist = resolve(root, preview ? 'build/weapp-preview' : project.miniprogramRoot);
if (preview) {
  const config = JSON.parse(await readFile(resolve(dist, 'project.config.json'), 'utf8'));
  assert.equal(config.miniprogramRoot, './');
  assert.equal(config.compileType, 'miniprogram');
  assert.equal(config.setting.urlCheck, true);
  assert.ok(/^wx[0-9a-f]{16}$/.test(config.appid), '预览工程缺少有效格式的 AppID');
  if (process.env.ROAM_APP_ID !== undefined) {
    assert.ok(config.appid === process.env.ROAM_APP_ID.trim(), '预览工程的 AppID 与构建配置不一致');
  }
}
const app = JSON.parse(await readFile(resolve(dist, 'app.json'), 'utf8'));
assert.deepEqual(app.pages, ['pages/assistant/index', 'pages/trips/index', 'pages/favorites/index', 'pages/profile/index']);
assert.equal(app.tabBar.list.length, 4);
for (const page of app.pages) {
  // All four pages use the global app.wxss; a page-specific WXSS is optional.
  for (const extension of ['js', 'json', 'wxml']) await stat(resolve(dist, `${page}.${extension}`));
}
for (const tab of app.tabBar.list) {
  for (const key of ['iconPath', 'selectedIconPath']) {
    const png = await readFile(resolve(dist, tab[key]));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.length < 40960);
  }
}
for (const name of ['app.js', 'app.wxss', 'base.wxml']) await stat(resolve(dist, name));
const css = await readFile(resolve(dist, 'app.wxss'), 'utf8');
assert.ok(css.includes('rpx'), 'design sizes should compile to responsive rpx');
console.log('WeChat package verified: 4 pages, 4 tabs, 8 PNG icons, WXML/JS/WXSS and project import path.');
if (preview) console.log('已校验独立预览工程入口、AppID 配置与域名校验开关。');
else if (project.appid === 'touristappid') console.log('miniapp 使用游客配置。真机预览可使用 npm run build:weapp:preview 生成独立工程。');
