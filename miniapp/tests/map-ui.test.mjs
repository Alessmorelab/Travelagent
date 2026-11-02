import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { validPlace } from '../src/domain/map-data.mjs';
import { createMiniController } from '../src/services/wechat.mjs';

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
