import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { formatAssistantMessage } from '../src/domain/message-format.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
const source = readFileSync(new URL('../src/chat-components.tsx', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  filename: 'chat-components.tsx', babelrc: false, configFile: false,
  presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic' }], require.resolve('@babel/preset-typescript')],
  plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', code)((name) => {
  if (name === '@tarojs/components') return { View: 'view', Text: 'text', Button: 'button', Textarea: 'textarea', RichText: 'rich-text' };
  if (name === '@tarojs/taro' || name === './components' || name === './stores/travel') return {};
  if (name === './domain/travel.mjs') return { AGENTS: [] };
  if (name === './domain/message-format.mjs') return { formatAssistantMessage };
  return require(name);
}, compiled, compiled.exports);
const { ChatComposer } = compiled.exports;
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, type); if (found) return found;
  }
  return null;
}

test('回复期间可继续编辑草稿，发送按钮切换为停止且不误发新消息', () => {
  let sent = 0, stopped = 0, draft = '';
  const tree = ChatComposer({ busy: true, blocked: false, value: '下一条问题', onChange: (value) => { draft = value; },
    onSend: () => sent++, onStop: () => stopped++, onMore() {}, onKeyboardHeight() {} });
  const input = find(tree, 'textarea');
  assert.equal(input.props.disabled, false);
  input.props.onInput({ detail: { value: '改成两天' } });
  input.props.onConfirm();
  assert.equal(draft, '改成两天'); assert.equal(sent, 0);
  const actions = tree.props.children[1].props.children;
  const stop = actions.at(-1);
  assert.equal(stop.props.ariaLabel, '停止生成');
  stop.props.onClick(); assert.equal(stopped, 1); assert.equal(sent, 0);
});
