/**
 * 预取 + 缓存行为测试。
 *
 * 直接从 client.js 抽出 CHAPTER_CACHE / cacheGet / cachePut / fetchChapter /
 * prefetchAround / loadChapter 的等价逻辑，用假的 call() 跑一遍，验证：
 *   1. 首次加载会请求网络，并写入缓存；
 *   2. 加载后会预取前后各 2 章；
 *   3. 再次加载同一章时**不再请求网络**（瞬开）；
 *   4. 预取不会重复请求同一章（去重）；
 *   5. 缓存有上限，不会无限增长。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8');

function extractFn(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `应能找到 ${name}`);
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; seen = true; }
    else if (source[i] === '}') { depth -= 1; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`没能取出 ${name}`);
}

function extractConst(name) {
  const m = new RegExp(`const ${name} = [^;]+;`).exec(source);
  assert.ok(m, `应能找到 ${name}`);
  return m[0];
}

// 构造被测环境：假的 call / setState / state
const requests = [];
const stateRef = { current: { busy: false, chapter: null } };
const calls = [];

const harness = new Function(
  'call',
  'setState',
  'stateRef',
  `
  ${extractConst('CHAPTER_CACHE')}
  ${extractConst('CHAPTER_CACHE_LIMIT')}
  ${extractConst('PREFETCH_RANGE')}
  ${extractConst('PREFETCHING')}
  ${extractFn('cacheGet')}
  ${extractFn('cachePut')}
  ${extractFn('fetchChapter')}
  ${extractFn('prefetchAround')}
  ${extractFn('loadChapter')}
  return { loadChapter, prefetchAround, cacheGet, cachePut, CHAPTER_CACHE, PREFETCHING };
  `,
);

const call = (url) => {
  calls.push(url);
  // 模拟 20 章的书
  const m = /index=(\d+)/.exec(url);
  const index = Number(m[1]);
  return Promise.resolve({ index, total: 20, title: `第${index}章`, text: `正文${index}` });
};

const setState = (patch) => {
  stateRef.current = { ...stateRef.current, ...patch };
};

const api = harness(call, setState, stateRef);

const flush = () => new Promise((r) => setTimeout(r, 10));

// ---- 1. 首次加载会请求网络并写入缓存 ----
await api.loadChapter('book1', 5);
await flush();
assert.ok(calls.some((u) => u.includes('index=5')), '首次加载应请求网络');
assert.ok(api.cacheGet('book1', 5), '加载后应写入缓存');
assert.equal(stateRef.current.chapter.text, '正文5', '应切到该章');

// ---- 2. 加载后应预取前后各 2 章 ----
await flush();
for (const i of [3, 4, 6, 7]) {
  assert.ok(api.cacheGet('book1', i), `应预取第 ${i} 章`);
}
// 超出范围的（2 和 8）不应该被预取
assert.equal(api.cacheGet('book1', 2), undefined, '预取范围应为前后各 2 章');
assert.equal(api.cacheGet('book1', 8), undefined, '预取范围应为前后各 2 章');

// ---- 3. 再次加载同一章不再请求网络 ----
const before = calls.length;
await api.loadChapter('book1', 5);
assert.equal(calls.length, before, '缓存命中不应再请求网络');
assert.equal(stateRef.current.chapter.text, '正文5');

// ---- 4. 预取去重：连续翻章不会重复请求同一章 ----
calls.length = 0;
api.prefetchAround('book1', 6, 20);
api.prefetchAround('book1', 6, 20);
api.prefetchAround('book1', 6, 20);
await flush();
const indexCalls = calls.map((u) => Number(/index=(\d+)/.exec(u)[1]));
const dup = indexCalls.filter((v, i) => indexCalls.indexOf(v) !== i);
assert.deepEqual(dup, [], '同一章不应被重复预取');

// ---- 5. 缓存上限 ----
for (let i = 0; i < 40; i += 1) {
  api.cachePut('book2', i, { index: i, total: 40, title: `t${i}`, text: `x${i}` });
}
const bucket = api.CHAPTER_CACHE.get('book2');
assert.ok(bucket.size <= 12, `缓存应有上限，实际 ${bucket.size}`);

console.log('预取自检通过 ✓ 缓存命中不请求、预取前后各 2 章、去重、有上限');
