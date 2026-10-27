/**
 * 分页算法验证（实测高度版）。
 *
 * 假 document 按「真实排版」返回高度：一行能放几个字由容器宽度和字号决定，
 * 文本换行后的行数 × 行高 = 该段高度。这样测试就能验证新算法是否真的
 * 「每页都不超容量、也不丢字」——也就是用户看到的「最后一行被裁掉」那个 bug。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8');

function extractFunction(name) {
    // 支持 async 函数：先找 `async function name(`，找不到再退回 `function name(`
    let start = source.indexOf(`async function ${name}(`);
    if (start < 0) start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, `应能找到 ${name}`);
    let depth = 0;
    let seen = false;
    for (let i = start; i < source.length; i += 1) {
        if (source[i] === '{') {
            depth += 1;
            seen = true;
        } else if (source[i] === '}') {
            depth -= 1;
            if (seen && depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`没能取出 ${name}`);
}

const LINE = 24; // 行高 px
const CHAR = 16; // 汉字宽度 px

/**
 * 假 DOM：模拟真实流式排版。
 *   · 每个节点的 top = 前面所有节点累计高度（含段间距），即真实流坐标
 *   · p 高度 = ceil(视觉字数 / 每行字数) × 行高，下边距 0.55em
 *   · h3 = 0.92em 字号 × 1.2 行高，下边距 0.6em
 * 新算法读的是 top/bottom（流坐标），所以假 DOM 必须给出正确的 top。
 */
function makeFakeDocument(width) {
    const charsPerLine = Math.max(1, Math.floor(width / CHAR));
    const unitsOfText = (text) => {
        let units = 0;
        for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
        return units;
    };

    let flow = 0;

    const makeNode = (tag) => {
        const node = {
            tagName: tag.toUpperCase(),
            style: { cssText: '' },
            textContent: '',
            parentNode: null,
            _top: 0,
            appendChild(child) {
                child.parentNode = node;
                child._top = flow;
                flow += child._height() + child._marginBottom();
                return child;
            },
            removeChild(child) {
                child.parentNode = null;
                return child;
            },
            _marginBottom() {
                if (node.tagName === 'H3') return 0.6 * CHAR;
                if (node.tagName === 'P') return 0.55 * CHAR;
                return 0;
            },
            _height() {
                if (node.tagName === 'H3') return 0.92 * CHAR * 1.2;
                const units = unitsOfText(String(node.textContent));
                return Math.max(1, Math.ceil(units / charsPerLine)) * LINE;
            },
            getBoundingClientRect() {
                const h = node._height();
                return { height: h, width: CHAR, top: node._top, bottom: node._top + h };
            },
        };
        return node;
    };

    const doc = {
        body: makeNode('div'),
        createElement(tag) {
            return makeNode(tag);
        },
    };
    doc.__reset = () => {
        flow = 0;
    };
    return doc;
}

/**
 * 假 getComputedStyle：必须按节点类型返回真实的 marginBottom，
 * 否则分页读不到间距、页尾会多塞一段（这正是「有些页空很多」的诱因）。
 */
const fakeWindow = {
    getComputedStyle(node) {
        const tag = String((node && node.tagName) || 'P').toUpperCase();
        const margin = tag === 'H3' ? 0.6 * CHAR : tag === 'P' ? 0.55 * CHAR : 0;
        return { fontSize: `${CHAR}px`, marginBottom: `${margin}px` };
    },
};

const factory = new Function(
    'document',
    'window',
    'MEASURE_BATCH',
    'yieldToMain',
    // new Function 的函数体不是 async，所以要自己包一层 async IIFE 把 paginate 暴露出来
    `return (async () => {\n${extractFunction('paginate')}\nreturn paginate;\n})();`,
);

// 每批测量段数：取小一点，让测试能真正走多批路径（验证分批逻辑）
const MEASURE_BATCH = 3;
// 让出主线程：测试里用微任务即可，不真的等 setTimeout
const yieldToMain = () => Promise.resolve();

const style = {
    fontFamily: 'serif',
    fontSize: '16px',
    fontWeight: '400',
    letterSpacing: 'normal',
    lineHeight: '1.75',
    indent: 2,
};

const strip = (text) => text.replace(/\s/g, '');
const WIDTH = 320;
const HEIGHT = 220;

const paginate = await factory(makeFakeDocument(WIDTH), fakeWindow, MEASURE_BATCH, yieldToMain);

// ---- 1. 不丢字、不重字 ----
const paragraphs = Array.from({ length: 12 }, (_, i) => `第${i + 1}段：` + '正文内容'.repeat(18));
const pages = await paginate(paragraphs, WIDTH, HEIGHT, style);
assert.ok(pages.length > 1, '应切成多页');
assert.equal(strip(pages.flat().join('')), strip(paragraphs.join('')), '拼回来的正文应与原文一致');

// ---- 2. 每页占用不超容量（用假 DOM 的真实流坐标独立核算，不重复实现里的公式） ----
// 把一页的段落重新排进假 DOM，读出「最后一段 bottom - 第一段 top」就是这页的真实占用。
function pageUsage(page) {
    const doc = makeFakeDocument(WIDTH);
    doc.__reset();
    const host = doc.createElement('div');
    let firstTop = null;
    let lastBottom = null;
    for (const para of page) {
        const node = doc.createElement('p');
        node.textContent = para;
        host.appendChild(node);
        const rect = node.getBoundingClientRect();
        if (firstTop === null) firstTop = rect.top;
        lastBottom = rect.bottom;
    }
    return lastBottom === null ? 0 : lastBottom - firstTop;
}

for (const [i, page] of pages.entries()) {
    const used = pageUsage(page);
    assert.ok(used <= HEIGHT + 0.5, `第 ${i + 1} 页占用 ${used.toFixed(1)}px 超过容量 ${HEIGHT}px`);
}

// ---- 3. 页面要「填得够满」：不能每页只放一两行，也不许留出成片空白 ----
for (const [i, page] of pages.entries()) {
    const used = pageUsage(page);
    assert.ok(used > HEIGHT * 0.5, `第 ${i + 1} 页只用了 ${used.toFixed(1)}px，太空`);
}
// 最后一页（除最后一页外）应尽量填满：剩余空间不得超过两行，
// 这正是用户反馈的「下面还有两行左右空白」。
const capacityLines = Math.floor(HEIGHT / LINE);
for (let i = 0; i < pages.length - 1; i += 1) {
    const used = pageUsage(pages[i]);
    const leftLines = (HEIGHT - used) / LINE;
    assert.ok(leftLines < 2, `第 ${i + 1} 页底部空了 ${leftLines.toFixed(2)} 行，超过 2 行`);
}

// ---- 4. 含「跨页切段」的页面也必须填满 ----
// 这是用户实际遇到的情况：长短段混排，某一段被切开后，
// 后续页面突然大片留白。根源是切段后坐标系混用（绝对流坐标 vs 相对高度），
// 后面的段落被算成巨大高度、误判放不下而提前换页。
const mixed = [
    '短段。',
    '长'.repeat(1200), // 会跨好几页
    '又是一段普通长度的正文，用来填充剩余空间。'.repeat(3),
    '再来一段。',
    '中'.repeat(600),
    '收尾段。',
];
const mixedPages = await paginate(mixed, WIDTH, HEIGHT, style);
assert.equal(strip(mixedPages.flat().join('')), strip(mixed.join('')), '混排切段后不能丢字');
for (let i = 0; i < mixedPages.length - 1; i += 1) {
    const used = pageUsage(mixedPages[i]);
    const leftLines = (HEIGHT - used) / LINE;
    assert.ok(used <= HEIGHT + 0.5, `混排第 ${i + 1} 页占用 ${used.toFixed(1)}px 超容量`);
    assert.ok(leftLines < 2, `混排第 ${i + 1} 页底部空了 ${leftLines.toFixed(2)} 行，超过 2 行`);
}

// ---- 5. 窗口变矮 / 字号变大 → 页数变多 ----
const shorter = await paginate(paragraphs, WIDTH, 120, style);
assert.ok(shorter.length > pages.length, '窗口变矮后页数应增加');

const biggerFont = await paginate(paragraphs, WIDTH, HEIGHT, { ...style, fontSize: '22px' });
assert.ok(biggerFont.length >= pages.length, '字号变大后页数不应减少');

// ---- 5. 极端尺寸也能推进 ----
const tiny = await paginate(['一二三四五六七八九十'.repeat(50)], 120, 30, style);
assert.ok(tiny.length > 0, '极端尺寸也要给出至少一页');
assert.equal(strip(tiny.flat().join('')), strip('一二三四五六七八九十'.repeat(50)));

// ---- 6. 空内容 ----
assert.deepEqual(await paginate([], WIDTH, HEIGHT, style), [[]], '空内容应给一页空页');

// ---- 7. 高度刚好差半行时，宁可少放也不裁字 ----
// 构造一段刚好比一页多一点点的内容，确认它被切开而不是被裁掉
const perLine = Math.floor(WIDTH / CHAR);
const longPara = '字'.repeat(perLine * 10 + 3);
const edge = await paginate([longPara], WIDTH, LINE * 10, style);
assert.ok(edge.length >= 2, '超出部分应翻到下一页');
assert.equal(strip(edge.flat().join('')), strip(longPara), '跨页段落不能丢字');

// ---- 8. 分批测量：长章节必须真的分多批，并且每批之间让出主线程 ----
// 这是「上传完 / 切小说后页面卡死、DSH 没事」的修复点：
// 一次性同步测量整章会把主线程占满，界面点什么都没反应。
{
    let yields = 0;
    const countingYield = () => {
        yields += 1;
        return Promise.resolve();
    };
    const longDoc = makeFakeDocument(WIDTH);
    const longPaginate = await factory(longDoc, fakeWindow, MEASURE_BATCH, countingYield);

    // 段落数远大于每批上限，必然走多批
    const manyParagraphs = Array.from({ length: 40 }, (_, i) => `第${i + 1}段：` + '正文'.repeat(10));
    const manyPages = await longPaginate(manyParagraphs, WIDTH, HEIGHT, style);

    const expectedYields = Math.floor((manyParagraphs.length - 1) / MEASURE_BATCH);
    assert.ok(
        yields >= expectedYields,
        `应分 ${Math.ceil(manyParagraphs.length / MEASURE_BATCH)} 批测量、让出 ${expectedYields} 次，实际让出 ${yields} 次`,
    );
    assert.equal(strip(manyPages.flat().join('')), strip(manyParagraphs.join('')), '分批测量后不能丢字');

    // 每页仍不超容量
    for (let i = 0; i < manyPages.length - 1; i += 1) {
        const used = pageUsage(manyPages[i]);
        assert.ok(used <= HEIGHT + 0.5, `长章节第 ${i + 1} 页超容量`);
    }
}

console.log(`分页自检通过 ✓ ${paragraphs.length} 段 → ${pages.length} 页（矮窗口 ${shorter.length} 页）`);
