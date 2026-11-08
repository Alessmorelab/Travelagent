import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { validPlace } from '../src/domain/map-data.mjs';
import { createMiniController } from '../src/services/wechat.mjs';
import * as adjustment from '../src/domain/day-adjustment.mjs';
import { createTravelStore } from '../src/domain/travel.mjs';

const require = createRequire(import.meta.url);
const reconcile = require('react-reconciler');
const { transformSync } = require('@babel/core');
const move = (parent, child, before) => {
  parent.children = parent.children.filter((item) => item !== child);
  const index = before ? parent.children.indexOf(before) : -1;
  parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
};
const renderer = reconcile({
  supportsMutation: true, isPrimaryRenderer: false,
  getRootHostContext: () => null, getChildHostContext: () => null,
  getPublicInstance: (item) => item, prepareForCommit: () => null, resetAfterCommit() {},
  createInstance: (type, props) => ({ type, props, children: [] }),
  createTextInstance: (value) => ({ type: '#text', value, children: [] }),
  appendInitialChild: (parent, child) => move(parent, child), finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false, prepareUpdate: () => true,
  commitUpdate(instance, _payload, _type, _old, props) { instance.props = props; },
  commitTextUpdate(instance, _old, value) { instance.value = value; },
  appendChild: (parent, child) => move(parent, child), appendChildToContainer: (parent, child) => move(parent, child),
  insertBefore: move, insertInContainerBefore: move,
  removeChild(parent, child) { parent.children = parent.children.filter((item) => item !== child); },
  removeChildFromContainer(parent, child) { parent.children = parent.children.filter((item) => item !== child); },
  clearContainer(parent) { parent.children = []; }, detachDeletedInstance() {},
  getCurrentEventPriority: () => 16, scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1
});
const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const textOf = (node) => node.type === '#text' ? node.value : node.children.map(textOf).join('');
const settle = async () => { for (let index = 0; index < 8; index++) { renderer.flushPassiveEffects(); await new Promise(setImmediate); } };

function mountAdjustment(t, store, client, props = {}) {
  const { code } = transformSync(readFileSync(new URL('../src/day-adjustment-sheet.tsx', import.meta.url), 'utf8'), {
    filename: 'day-adjustment-sheet.tsx', babelrc: false, configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic' }], require.resolve('@babel/preset-typescript')],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@tarojs/components') return { Button: 'button', Picker: 'picker', Text: 'text', Textarea: 'textarea', View: 'view' };
    if (name === './components') return { Sheet: ({ children, onClose }) => React.createElement('sheet', { onClose }, children) };
    if (name === './domain/day-adjustment.mjs') return adjustment;
    if (name === './services/wechat.mjs') return { createMiniController };
    if (name === './stores/travel') return { chatClient: client, store };
    return require(name);
  }, compiled, compiled.exports);
  const container = { children: [] }, root = renderer.createContainer(container, 0, null, false, null, '', console.error, null);
  const render = (overrides = {}) => renderer.updateContainer(React.createElement(compiled.exports.DayAdjustmentSheet, {
    trip: store.getState().trips[0], day: 0, connection: { mode: 'live', apiUrl: 'https://fixture.example' }, onClose() {}, ...props, ...overrides
  }), root, null);
  render();
  const unmount = () => { renderer.updateContainer(null, root, null); renderer.flushPassiveEffects(); };
  t.after(unmount);
  const button = (label) => flatten(container).find((node) => node.type === 'button' && textOf(node).includes(label));
  return { container, render, unmount, button };
}

test('地图按天查询，同名地点需选择，实际路径与失败路段重试保持对应', async (t) => {
  const bindings = [], queries = [], routes = [];
  const makePlace = (name, longitude = 114.3, address = '武汉市') => ({ name, address, latitude: 30.5, longitude, coordinate_system: 'gcj02', source: 'fixture', retrieved_at: 'test' });
  const client = {
    async resolvePlaces(_url, city, names) {
      queries.push(names);
      return names.map((name) => ({ query: name, places: name === '博物馆' ? [makePlace(name, 114.4, '武昌区'), makePlace(name, 114.5, '江岸区')] : [makePlace(name)] }));
    },
    async routeDay(_url, stops, mode, segments) {
      routes.push({ stops, mode, segments });
      return (segments || stops.slice(1).map((_, index) => index)).map((index) => !segments && index === 1
        ? { index, failure: { kind: 'timeout', message: '该段超时' } }
        : { index, source: 'fixture', retrieved_at: 'test', distance_m: 100, duration_seconds: 80,
          points: [{ latitude: stops[index].latitude, longitude: stops[index].longitude }, { latitude: stops[index + 1].latitude, longitude: stops[index + 1].longitude }] });
    }
  };
  const { code } = transformSync(readFileSync(new URL('../src/itinerary-map.tsx', import.meta.url), 'utf8'), {
    filename: 'itinerary-map.tsx', babelrc: false, configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic' }], require.resolve('@babel/preset-typescript')],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@tarojs/components') return { Button: 'button', Input: 'input', Map: 'map', ScrollView: 'scroll', Text: 'text', View: 'view' };
    if (name === '@tarojs/taro') return { openLocation: async () => {} };
    if (name === './domain/map-data.mjs') return { validPlace };
    if (name === './services/wechat.mjs') return { createMiniController };
    if (name === './saved-place-button') return { SavedPlaceButton: () => null };
    if (name === './stores/travel') return { chatClient: client, store: { bindMapPlace(...args) { bindings.push(args); } } };
    return require(name);
  }, compiled, compiled.exports);
  const container = { children: [] }, root = renderer.createContainer(container, 0, null, false, null, '', console.error, null);
  const days = [['黄鹤楼', '博物馆', '东湖'], ['公园']].map((day) => day.map((title) => ({ title, time: '上午', detail: '', icon: 'compass-outline' })));
  renderer.updateContainer(React.createElement(compiled.exports.ItineraryMap, {
    state: { connection: { mode: 'live', apiUrl: 'https://fixture.example' } }, kind: 'trip', id: 'trip', days, destination: '武汉', onClose() {}
  }), root, null);
  t.after(() => { renderer.updateContainer(null, root, null); renderer.flushPassiveEffects(); });
  await settle();
  assert.deepEqual(queries, [['黄鹤楼', '博物馆', '东湖']]);
  assert.equal(bindings.length, 2, 'Two identically named museums require confirmation');
  assert.equal(routes.length, 0);
  const candidate = flatten(container).find((node) => node.type === 'button' && node.props.className === 'map-candidate' && textOf(node).includes('江岸区'));
  assert.ok(candidate); candidate.props.onClick(); await settle();
  let map = flatten(container).find((node) => node.type === 'map');
  assert.equal(map.props.markers.length, 3);
  assert.equal(map.props.polyline.length, 1, 'A failed leg must not become a line');
  assert.equal(bindings.at(-1)[5].address, '江岸区');
  const retry = flatten(container).find((node) => node.type === 'button' && textOf(node) === '仅重试失败路段');
  retry.props.onClick(); await settle();
  assert.deepEqual(routes.at(-1).segments, [1]);
  map = flatten(container).find((node) => node.type === 'map');
  assert.equal(map.props.polyline.length, 2);
  // Editing the first stop changes one leg; the second leg is still valid.
  const updatedDays = days.map((items) => items.map((item, index) => ({ ...item,
    place: index === 1 ? makePlace(item.title, 114.5, '江岸区') : makePlace(item.title) })));
  updatedDays[0][0] = { ...updatedDays[0][0], title: '新景点', place: makePlace('新景点', 114.8) };
  renderer.updateContainer(React.createElement(compiled.exports.ItineraryMap, {
    state: { connection: { mode: 'live', apiUrl: 'https://fixture.example' } }, kind: 'trip', id: 'trip', days: updatedDays, destination: '武汉', onClose() {}
  }), root, null);
  await settle();
  assert.deepEqual(routes.at(-1).segments, [0], 'Only the changed road segment should be queried again');
  map = flatten(container).find((node) => node.type === 'map');
  assert.equal(map.props.markers[0].longitude, 114.8);
  const day2 = flatten(container).find((node) => node.type === 'view' && node.props.className === 'day-tab ' && textOf(node) === 'DAY 02');
  day2.props.onClick(); await settle();
  map = flatten(container).find((node) => node.type === 'map');
  assert.equal(map.props.markers.length, 1);
  assert.equal(map.props.polyline.length, 0, 'Day 1 geometry cannot survive switching to Day 2');
  assert.equal(routes.at(-1).segments.length, 1);
});

test('局部调整界面保护预约，确认地点后比较真实路段接口，并只在确认时保存', async (t) => {
  const store = createTravelStore({ async getItem() { return null; }, async setItem() {} });
  t.after(() => store.dispose()); await store.hydrate();
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1\n**上午｜博物馆**\n已预约\n**下午｜公园**\n散步' }, '武汉');
  store.setActivityLocked(id, 0, 0, true);
  const place = (name, longitude) => ({ name, address: '测试地址', city: '武汉', latitude: 30.5, longitude, coordinate_system: 'gcj02', source: 'fixture', retrieved_at: 'test' });
  store.bindMapPlace('trip', id, 0, 0, '博物馆', place('博物馆', 114.3));
  store.bindMapPlace('trip', id, 0, 1, '公园', place('公园', 114.4));
  const before = store.getState().trips[0], routes = [];
  const client = {
    async adjustDay(_url, request) {
      assert.deepEqual(request.targets, [1]); assert.equal(request.activities[0].protected, true);
      return [{ index: 1, title: '科技馆', time: '下午', detail: '室内展览' }];
    },
    async resolvePlaces() { return [{ query: '科技馆', places: [place('科技馆', 114.35)] }]; },
    async routeDay(_url, stops, mode) {
      routes.push({ stops, mode });
      return [{ index: 0, source: 'fixture', retrieved_at: 'test', duration_seconds: stops[1].name === '公园' ? 1800 : 600 }];
    }
  };
  let closed = false;
  const { container, button } = mountAdjustment(t, store, client, { onClose() { closed = true; } });
  await settle();
  assert.equal(button('博物馆').props.disabled, true);
  button('公园').props.onClick();
  flatten(container).find((node) => node.type === 'textarea').props.onInput({ detail: { value: '换成室内' } });
  button('生成改动预览').props.onClick(); await settle();
  assert.equal(store.getState().trips[0], before);
  assert.match(textOf(container), /交通耗时暂未估算/);
  button('查询新地点').props.onClick(); await settle();
  button('科技馆测试地址').props.onClick();
  button('查询步行耗时对比').props.onClick(); await settle();
  assert.deepEqual(routes.map(({ stops }) => stops.map(({ name }) => name)), [['博物馆', '公园'], ['博物馆', '科技馆']]);
  assert.match(textOf(container), /约 30 分钟.*约 10 分钟/);
  assert.equal(store.getState().trips[0], before);
  button('确认保存').props.onClick();
  assert.equal(closed, true);
  assert.equal(store.getState().trips[0].days[0][1].place.name, '科技馆');
  assert.equal(store.getState().trips[0].days[0][0], before.days[0][0]);
});

test('停止生成、地点查询或路段比较后可重试，迟到结果不会覆盖新请求', async (t) => {
  const store = createTravelStore({ async getItem() { return null; }, async setItem() {} });
  t.after(() => store.dispose()); await store.hydrate();
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1\n**上午｜博物馆**\n参观\n**下午｜公园**\n散步' }, '武汉');
  const place = (name, longitude) => ({ name, address: '测试地址', city: '武汉', latitude: 30.5, longitude, coordinate_system: 'gcj02', source: 'fixture', retrieved_at: 'test' });
  store.bindMapPlace('trip', id, 0, 0, '博物馆', place('博物馆', 114.3));
  store.bindMapPlace('trip', id, 0, 1, '公园', place('公园', 114.4));
  const before = store.getState().trips[0], generations = [], lookups = [], routes = [];
  const client = {
    adjustDay(_url, _request, signal) { return new Promise((resolve) => generations.push({ resolve, signal })); },
    resolvePlaces(_url, _city, _names, signal) { return new Promise((resolve) => lookups.push({ resolve, signal })); },
    routeDay(_url, _stops, _mode, _segments, signal) { return new Promise((resolve, reject) => routes.push({ resolve, reject, signal })); },
  };
  const { container, button } = mountAdjustment(t, store, client);
  await settle();
  button('公园').props.onClick();
  flatten(container).find((node) => node.type === 'textarea').props.onInput({ detail: { value: '换成室内' } });
  button('生成改动预览').props.onClick(); await settle();
  button('停止本次请求').props.onClick();
  assert.equal(generations[0].signal.aborted, true);
  assert.equal(flatten(container).find((node) => node.type === 'textarea').props.value, '换成室内');
  assert.equal(button('生成改动预览').props.disabled, false);
  button('生成改动预览').props.onClick(); await settle();
  generations[0].resolve([{ index: 1, title: '旧建议', time: '下午', detail: '' }]); await settle();
  assert.doesNotMatch(textOf(container), /旧建议/);
  assert.equal(button('生成改动预览').props.disabled, true);
  generations[1].resolve([{ index: 1, title: '科技馆', time: '下午', detail: '室内展览' }]); await settle();

  button('查询新地点').props.onClick(); await settle();
  button('停止本次请求').props.onClick();
  assert.equal(lookups[0].signal.aborted, true);
  button('查询新地点').props.onClick(); await settle();
  lookups[0].resolve([{ places: [place('过期候选', 114.8)] }]); await settle();
  assert.doesNotMatch(textOf(container), /过期候选/);
  assert.equal(button('确认保存').props.disabled, true);
  lookups[1].resolve([{ places: [place('科技馆', 114.35)] }]); await settle();
  button('科技馆测试地址').props.onClick();
  button('查询步行耗时对比').props.onClick(); await settle();
  button('停止本次请求').props.onClick();
  assert.equal(routes[0].signal.aborted, true);
  assert.equal(routes[1].signal.aborted, true);
  button('查询步行耗时对比').props.onClick(); await settle();
  routes[0].reject(new Error('过期请求失败')); routes[1].resolve([]); await settle();
  assert.doesNotMatch(textOf(container), /过期请求失败/);
  assert.equal(button('确认保存').props.disabled, true);
  routes[2].resolve([{ duration_seconds: 1800, source: 'fixture', retrieved_at: 'test' }]);
  routes[3].resolve([{ duration_seconds: 600, source: 'fixture', retrieved_at: 'test' }]); await settle();
  assert.match(textOf(container), /约 30 分钟.*约 10 分钟/);
  assert.equal(store.getState().trips[0], before);
  button('确认保存').props.onClick();
  assert.equal(store.getState().trips[0].days[0][1].place.name, '科技馆');
});

test('关闭面板、卸载页面或修改当天安排与服务时，取消在途生成并忽略返回结果', async (t) => {
  for (const action of ['close', 'unmount', 'edit', 'connection', 'demo']) {
    const store = createTravelStore({ async getItem() { return null; }, async setItem() {} });
    t.after(() => store.dispose()); await store.hydrate();
    const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1\n**下午｜公园**\n散步' }, '武汉');
    let finish, signal, closed = false;
    const client = { adjustDay(_url, _request, currentSignal) { signal = currentSignal; return new Promise((resolve) => { finish = resolve; }); } };
    const { container, button, render, unmount } = mountAdjustment(t, store, client, { onClose() { closed = true; } });
    await settle();
    button('公园').props.onClick();
    flatten(container).find((node) => node.type === 'textarea').props.onInput({ detail: { value: '换成室内' } });
    button('生成改动预览').props.onClick(); await settle();
    if (action === 'close') { flatten(container).find((node) => node.type === 'sheet').props.onClose(); assert.equal(closed, true); }
    if (action === 'unmount') unmount();
    if (action === 'edit') { store.setActivityLocked(id, 0, 0, true); render(); }
    if (action === 'connection') render({ connection: { mode: 'live', apiUrl: 'https://second.example' } });
    if (action === 'demo') render({ connection: { mode: 'demo', apiUrl: 'https://fixture.example' } });
    await settle();
    assert.equal(signal.aborted, true, action);
    finish([{ index: 0, title: '迟到建议', time: '下午', detail: '' }]); await settle();
    assert.doesNotMatch(textOf(container), /迟到建议|正在生成/);
    assert.equal(store.getState().trips[0].days[0][0].title, '公园');
  }
});

test('已有预览后修改当天安排可安全返回，重新选择时保护最新锁定状态', async (t) => {
  const store = createTravelStore({ async getItem() { return null; }, async setItem() {} });
  t.after(() => store.dispose()); await store.hydrate();
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1\n**下午｜公园**\n散步' }, '武汉');
  const client = { async adjustDay() { return [{ index: 0, title: '科技馆', time: '下午', detail: '' }]; } };
  const { container, button, render } = mountAdjustment(t, store, client);
  await settle();
  button('公园').props.onClick();
  flatten(container).find((node) => node.type === 'textarea').props.onInput({ detail: { value: '换成室内' } });
  button('生成改动预览').props.onClick(); await settle();
  store.setActivityLocked(id, 0, 0, true); render(); await settle();
  assert.match(textOf(container), /当天安排或服务地址已变化/);
  assert.equal(button('确认保存').props.disabled, true);
  button('返回修改').props.onClick(); await settle();
  assert.equal(button('公园').props.disabled, true);
  assert.equal(button('生成改动预览').props.disabled, true);
});
