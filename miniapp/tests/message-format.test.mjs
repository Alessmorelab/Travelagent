import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAssistantMessage } from '../src/domain/message-format.mjs';

test('旅行回复的标题、加粗、列表和行内代码显示为排版而非标记', () => {
  const html = formatAssistantMessage('### 武汉三日游\n\n**第一天**\n- 黄鹤楼\n- 东湖\n\n1. 先预约\n2. 再出发\n\n乘坐 `地铁2号线`。');
  assert.match(html, /<h3[^>]*>武汉三日游<\/h3>/);
  assert.match(html, /<strong>第一天<\/strong>/);
  assert.match(html, /<ul[^>]*>.*黄鹤楼.*东湖.*<\/ul>/);
  assert.match(html, /<ol[^>]*>.*先预约.*再出发.*<\/ol>/);
  assert.match(html, /<code[^>]*>地铁2号线<\/code>/);
  assert.doesNotMatch(html, /###|\*\*/);
});

test('模型输出的 HTML、危险链接和图片不会被当作可执行内容或远程资源', () => {
  const html = formatAssistantMessage('<script>alert(1)</script>\n<img src="https://example.com/tracker">\n[危险](javascript:alert)\n![图片](https://example.com/pic.png)\nA & B');
  assert.doesNotMatch(html, /<(?:script|img|a)\b|<[^>]+\s(?:href|src)=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /example.com\/pic.png/);
});

test('流式输出中尚未闭合的代码块保留正文且按纯文本转义', () => {
  const html = formatAssistantMessage('操作步骤：\n```text\n<保留原文>\nA&B');
  assert.match(html, /<pre[^>]*><code>&lt;保留原文&gt;\nA&amp;B<\/code><\/pre>/);
});

test('行程对比表按列显示，表格后的普通段落不会丢失', () => {
  const html = formatAssistantMessage('| 日期 | 安排 |\n| --- | --- |\n| 第一天 | **东湖** |\n| 第二天 | 省博 |\n\n需要提前预约。');
  assert.match(html, /<table[^>]*>.*<th[^>]*>日期<\/th>/);
  assert.match(html, /<td[^>]*><strong>东湖<\/strong><\/td>/);
  assert.match(html, /<\/table><p[^>]*>需要提前预约。<\/p>/);
});

test('编号列表被说明段落分开时保留原编号', () => {
  const html = formatAssistantMessage('1. 日期\n\n需要确认出发时间。\n\n2. 人数\n\n3. 预算');
  assert.match(html, /<ol start="1"/);
  assert.match(html, /<ol start="2"/);
  assert.match(html, /<ol start="3"/);
});
