import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = JSON.parse(await readFile(resolve(root, 'project.config.json'), 'utf8'));
assert.equal(project.miniprogramRoot, 'dist/');
const workspaceProject = JSON.parse(await readFile(resolve(root, '../project.config.json'), 'utf8'));
assert.equal(resolve(root, '../', workspaceProject.miniprogramRoot), resolve(root, 'dist/'), 'repository import must use the same compiled package');
const dist = resolve(root, project.miniprogramRoot);
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
if (workspaceProject.appid && workspaceProject.appid !== 'touristappid') console.log('Repository import uses your configured AppID; the miniapp directory still has the default visitor AppID.');
else if (project.appid === 'touristappid') console.log('Visitor AppID configured: replace it with your own AppID before phone preview or upload.');
