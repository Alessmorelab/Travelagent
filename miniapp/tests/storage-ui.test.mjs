import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createTravelStore } from '../src/domain/travel.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
const nodes = (node) => {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat().flatMap(nodes)];
};

test('保存失败提示优先于普通提示，点击重试后显示进度并在成功后消失', async (t) => {
  let recover = false, complete;
  const store = createTravelStore({ async getItem() { return null; }, async setItem() {
    if (!recover) throw new Error('fixture write failure');
    await new Promise((resolve) => { complete = resolve; });
  } });
  t.after(() => store.dispose()); await store.hydrate();
  const { code } = transformSync(readFileSync(new URL('../src/components.tsx', import.meta.url), 'utf8'), {
    filename: 'components.tsx', babelrc: false, configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic' }], require.resolve('@babel/preset-typescript')],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@tarojs/components') return { View: 'view', Text: 'text', Button: 'button' };
    if (name === '@tarojs/taro') return {};
    if (name === './stores/travel') return { store };
    if (name === './domain/travel.mjs') return { DESTINATIONS: [], AGENTS: [] };
    return require(name);
  }, compiled, compiled.exports);
  const render = () => compiled.exports.Toast({ state: store.getState() });
  store.toggleFavorite('coast'); await store.flush();
  store.toast('已复制行程');
  let tree = render();
  assert.equal(tree.props.className, 'save-warning');
  assert.ok(nodes(tree).some((node) => node.props.children === '有改动尚未保存到本机'));
  assert.equal(nodes(tree).some((node) => node.props.children === '已复制行程'), false);
  let button = nodes(tree).find((node) => node.type === 'button');
  assert.equal(button.props.children, '重试保存');
  assert.equal(button.props.disabled, false);
  recover = true;
  button.props.onClick(); await new Promise(setImmediate);
  tree = render(); button = nodes(tree).find((node) => node.type === 'button');
  assert.equal(tree.props.className, 'save-warning');
  assert.equal(button.props.children, '正在保存…');
  assert.equal(button.props.disabled, true);
  complete(); await store.flush();
  assert.equal(render().props.className, 'toast');
  store.toast('');
  assert.equal(render(), null);
});
