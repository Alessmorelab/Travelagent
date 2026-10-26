const assert = require('node:assert/strict');
const path = require('node:path');

// This checks compiled page registration/rendering, not native layout or device APIs.
const storage = new Map();
let app;
let current = [];
let updates = 0;
const pages = [];
global.wx = {
  getSystemInfoSync: () => ({ platform: 'devtools', windowWidth: 375, windowHeight: 812, pixelRatio: 2 }),
  getAppBaseInfo: () => ({ SDKVersion: '3.11.0', version: '8.0.0', theme: 'light' }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2 }),
  getStorageSync: (key) => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value),
  nextTick: (callback) => queueMicrotask(callback),
  onAppShow() {}, onAppHide() {}, onWindowResize() {}, canIUse: () => false
};
global.getCurrentPages = () => current;
global.App = (config) => { app = config; };
global.Page = (config) => pages.push(config);
global.Component = () => {};
global.getApp = () => app;

(async () => {
  const dist = path.resolve(__dirname, '../dist');
  require(path.join(dist, 'app.js'));
  assert.ok(app, 'compiled bundle must register an App');
  app.onLaunch?.({});
  const names = ['assistant', 'trips', 'favorites', 'profile'];
  for (const name of names) require(path.join(dist, `pages/${name}/index.js`));
  assert.equal(pages.length, 4);
  for (const [index, config] of pages.entries()) {
    const page = {
      ...config,
      route: `pages/${names[index]}/index`,
      setData(data, callback) { updates++; this.data = { ...this.data, ...data }; callback?.(); }
    };
    current = [page];
    page.onLoad?.({}); page.onShow?.();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.ok(page.data && JSON.stringify(page.data).length > 100, `${names[index]} must produce a render tree`);
    page.onHide?.(); page.onUnload?.();
  }
  assert.ok(updates >= 4);
  console.log(`Compiled WeChat runtime verified: App + 4 pages mounted, ${updates} render updates.`);
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
