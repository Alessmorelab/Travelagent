// A small, escaped Markdown renderer for the text formats used in travel replies.
// Raw HTML and remote images are displayed as text, never executed or loaded.
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function inline(text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let result = '', start = 0;
  let match;
  while ((match = pattern.exec(text))) {
    result += escape(text.slice(start, match.index));
    const value = match[0];
    if (value.startsWith('`')) result += `<code style="background:#eef1eb;padding:2px 4px;border-radius:4px;">${escape(value.slice(1, -1))}</code>`;
    else if (value.startsWith('**') || value.startsWith('__')) result += `<strong>${escape(value.slice(2, -2))}</strong>`;
    else {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(value);
      result += `${escape(label)}（${escape(url)}）`;
    }
    start = match.index + value.length;
  }
  return result + escape(text.slice(start));
}

export function formatAssistantMessage(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [], list = [], listTag = '', listStart = 1, code = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p style="margin:0 0 12px;">${paragraph.map(inline).join('<br/>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(`<${listTag}${listTag === 'ol' ? ` start="${listStart}"` : ''} style="margin:0 0 14px;padding-left:22px;">${list.map((line) => `<li style="margin:5px 0;">${inline(line)}</li>`).join('')}</${listTag}>`);
    list = []; listTag = ''; listStart = 1;
  };
  const flushCode = () => { blocks.push(`<pre style="white-space:pre-wrap;word-break:break-all;background:#eef1eb;padding:12px;border-radius:10px;margin:8px 0 14px;"><code>${escape(code.join('\n'))}</code></pre>`); code = null; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flushParagraph(); flushList();
      if (code === null) code = []; else flushCode();
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
    if (line.includes('|') && tableDivider.test(lines[index + 1] || '')) {
      flushParagraph(); flushList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const header = cells(line);
      const rows = []; index += 2;
      for (; index < lines.length && lines[index].includes('|') && lines[index].trim(); index++) rows.push(cells(lines[index]));
      index--;
      const cell = (value, tag) => `<${tag} style="border:1px solid #dfe5d8;padding:8px;text-align:left;vertical-align:top;word-break:break-word;">${inline(value)}</${tag}>`;
      blocks.push(`<table style="border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0;font-size:13px;"><thead><tr>${header.map((value) => cell(value, 'th')).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => cell(row[i] || '', 'td')).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-*+])\s+|(\d+)[.)、]\s+)(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(`<h3 style="font-size:17px;line-height:1.6;margin:18px 0 8px;font-weight:600;">${inline(heading[2])}</h3>`);
    } else if (item) {
      flushParagraph();
      const tag = item[1] ? 'ul' : 'ol';
      if (tag !== listTag) flushList();
      if (!list.length && tag === 'ol') listStart = Number(item[2]);
      listTag = tag; list.push(item[3]);
    } else if (/^\s*>\s?/.test(line)) {
      flushParagraph(); flushList();
      blocks.push(`<blockquote style="border-left:3px solid #cbd7c6;padding-left:10px;margin:10px 0;color:#75806f;">${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph(); flushList(); blocks.push('<hr style="border:0;border-top:1px solid #e4e8dc;margin:16px 0;"/>');
    } else if (!line.trim()) { flushParagraph(); flushList(); }
    else { flushList(); paragraph.push(line); }
  }
  flushParagraph(); flushList(); if (code !== null) flushCode();
  return blocks.join('');
}
