// 模拟超大章节（84434 段）的分页耗时，验证 MEASURE_MAX_PARAGRAPHS 保护是否有效
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; seen = true; }
    else if (source[i] === '}') { depth -= 1; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

// 极简假 DOM：记录 createElement 次数，高度按字数估
function makeDoc() {
  let created = 0;
  const make = (tag) => ({
    tagName: tag.toUpperCase(),
    style: { cssText: '' },
    textContent: '',
    parentNode: null,
    offsetHeight: 0,
    appendChild(c) { c.parentNode = this; return c; },
    removeChild(c) { c.parentNode = null; return c; },
    getBoundingClientRect() {
      const len = String(this.textContent).length;
      const h = tag === 'h3' ? 20 : Math.max(1, Math.ceil(len / 30)) * 24;
      return { height: h, width: 16, top: 0, bottom: h };
    },
  });
  const body = make('div');
  return {
    body,
    createElement(tag) { created += 1; return make(tag); },
    get created() { return created; },
  };
}

const doc = makeDoc();
const fakeWindow = { getComputedStyle: () => ({ fontSize: '16px', marginBottom: '9px' }) };

const MEASURE_BATCH = 120;
const MEASURE_MAX_PARAGRAPHS = 4000;
let yields = 0;
const yieldToMain = () => { yields += 1; return Promise.resolve(); };

const body = [extract('paginate'), 'return paginate;'].join('\n');
const paginate = new Function('document', 'window', 'MEASURE_BATCH', 'MEASURE_MAX_PARAGRAPHS', 'yieldToMain', body)(
  doc, fakeWindow, MEASURE_BATCH, MEASURE_MAX_PARAGRAPHS, yieldToMain,
);

const style = { fontFamily: 'serif', fontSize: '16px', fontWeight: '400', letterSpacing: 'normal', lineHeight: '1.75', indent: 2, heading: true };

async function run(label, count) {
  const paragraphs = Array.from({ length: count }, (_, i) => `第${i}段：` + '正文内容'.repeat(20));
  const t0 = Date.now();
  const pages = await paginate(paragraphs, 360, 600, style, null);
  const ms = Date.now() - t0;
  console.log(`${label}: ${count} 段 → ${pages.length} 页, 耗时 ${ms}ms, 让出 ${yields} 次`);
  return pages;
}

(async () => {
  yields = 0;
  await run('正常章节', 300);
  yields = 0;
  await run('较长章节', 2000);
  yields = 0;
  await run('超大章节(旧规则会把整本书切成一章)', 84434);

  // 超大章节也必须不丢字
  const big = Array.from({ length: 84434 }, (_, i) => `段${i}内容`);
  const pages = await paginate(big, 360, 600, style, null);
  const joined = pages.flat().join('').replace(/\s/g, '');
  const expect = big.join('').replace(/\s/g, '');
  console.log('超大章节不丢字:', joined === expect, '页数', pages.length);
})();
