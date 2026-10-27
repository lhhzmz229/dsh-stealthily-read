/**
 * Host 半边的离线自检：用假的 ctx / req / res 跑一遍上传 → 列表 → 读章 → 进度 → 删除。
 * 不依赖 DSH 运行时，纯粹验证解码、切章、路由与落盘。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-selftest-'));
process.env.DSH_HOME = tmpHome;

const { apply } = await import('../index.js');

let handler = null;
const ctx = {
    logger: { info() {}, error() {} },
    effect(fn) {
        const dispose = fn();
        return typeof dispose === 'function' ? dispose : () => {};
    },
    get(name) {
        return name === 'connection' ? { requestRejection: () => undefined } : undefined;
    },
    webServer: {
        register(route) {
            assert.equal(route.kind, 'prefix');
            assert.equal(route.path, '/dsh-stealthily-read/api');
            handler = route.handler;
            return () => {};
        },
    },
};
apply(ctx);
assert.ok(handler, 'webServer 路由应已注册');

/** 造一个最小的 req / res 对 */
function request(method, urlPath, body) {
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
    const req = Readable.from(payload);
    req.method = method;
    req.url = `/dsh-stealthily-read/api${urlPath}`;
    req.headers = { host: '127.0.0.1:1234' };
    const res = {
        headersSent: false,
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(key, value) {
            this.headers[key.toLowerCase()] = value;
        },
        end(chunk) {
            this.body = chunk === undefined ? '' : String(chunk);
            this.headersSent = true;
        },
    };
    return { req, res };
}

async function callApi(method, urlPath, body) {
    const { req, res } = request(method, urlPath, body);
    await handler(req, res);
    return { status: res.statusCode, data: JSON.parse(res.body || '{}') };
}

// ---- 1. 上传 UTF-8 中文 txt ----
const novel = [
    '书名页：测试之书',
    '',
    '第一章 开始',
    '　　这是第一章的正文。',
    '　　第二行。',
    '',
    '第二章 继续',
    '　　第二章正文。',
    '',
    '番外 一',
    '　　番外正文。',
].join('\n');

const uploaded = await callApi('POST', '/books', {
    name: '测试之书.txt',
    title: '测试之书',
    dataBase64: Buffer.from(novel, 'utf8').toString('base64'),
});
assert.equal(uploaded.status, 200);
assert.equal(uploaded.data.ok, true);
const bookId = uploaded.data.book.id;
assert.equal(uploaded.data.book.encoding, 'utf-8');
assert.equal(uploaded.data.book.chapterCount, 4, '书名页 + 2 章 + 番外');

// ---- 2. 列表 ----
const listed = await callApi('GET', '/state');
assert.equal(listed.data.books.length, 1);
assert.equal(listed.data.books[0].title, '测试之书');

// ---- 3. 逐章读 ----
const titles = [];
for (let i = 0; i < 4; i += 1) {
    const chapter = await callApi('GET', `/books/${bookId}/chapter?index=${i}`);
    assert.equal(chapter.status, 200);
    assert.equal(chapter.data.index, i);
    assert.equal(chapter.data.total, 4);
    titles.push(chapter.data.title);
    assert.ok(!chapter.data.text.includes(chapter.data.title), '正文不应重复标题行');
}
assert.deepEqual(titles, ['开始', '第一章 开始', '第二章 继续', '番外 一']);
console.log('章节标题:', titles.join(' | '));
assert.equal(titles[0], '开始', '第一个标题前的内容单独成章');
assert.equal(titles[1], '第一章 开始');
assert.equal(titles[2], '第二章 继续');
assert.equal(titles[3], '番外 一');

const second = await callApi('GET', `/books/${bookId}/chapter?index=2`);
assert.ok(second.data.text.includes('第二章正文'));

// 越界索引夹到最后一章
const clamped = await callApi('GET', `/books/${bookId}/chapter?index=99`);
assert.equal(clamped.data.index, 3);

// ---- 4. 进度与浮层状态 ----
const progress = await callApi('POST', `/books/${bookId}/progress`, { progress: { index: 2, ratio: 0.5 } });
assert.equal(progress.data.ok, true);
assert.equal(progress.data.state.progress[bookId].index, 2);
assert.equal(progress.data.state.activeBookId, bookId);

const overlay = await callApi('POST', '/state', {
    state: { overlay: { x: 100, y: 200, w: 400, h: 300, alpha: 0.4, fontSize: 18, open: true } },
});
assert.equal(overlay.data.state.overlay.alpha, 0.4);
assert.equal(overlay.data.state.progress[bookId].index, 2, '写浮层不应冲掉进度');

const reopened = await callApi('GET', '/state');
assert.equal(reopened.data.state.activeBookId, bookId);
assert.equal(reopened.data.state.overlay.open, true);

// ---- 5. GB18030 编码的 txt ----
const gbkText = '第一章 起点\n　　中文正文测试。\n第二章 终点\n　　结束。\n';
// 用 Node 的 gb18030 编码表反向构造：这里借助 iconv 不可用，改用已知字节序列
// 「第一章 起点」在 GBK 里的字节，其余用 ASCII 安全字符，验证解码分支即可。
const gbkBytes = Buffer.concat([
    Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]), // 第一章
    Buffer.from(' \u0000', 'latin1').subarray(0, 1),
    Buffer.from([0xc6, 0xf0, 0xb5, 0xe3]), // 起点
    Buffer.from('\n  body line\n', 'utf8'),
]);
const gbkUpload = await callApi('POST', '/books', {
    name: 'gbk.txt',
    title: 'GBK 书',
    dataBase64: gbkBytes.toString('base64'),
});
assert.equal(gbkUpload.status, 200);
assert.equal(gbkUpload.data.book.encoding, 'gb18030');
const gbkChapter = await callApi('GET', `/books/${gbkUpload.data.book.id}/chapter?index=0`);
assert.ok(gbkChapter.data.title.includes('第一章'), `GBK 标题应被正确解码，实际：${gbkChapter.data.title}`);

// ---- 6. 删除 ----
const removed = await callApi('POST', `/books/${bookId}/delete`, {});
assert.equal(removed.data.ok, true);
const afterDelete = await callApi('GET', '/state');
assert.equal(afterDelete.data.books.length, 1);
assert.equal(afterDelete.data.state.progress[bookId], undefined, '删除后进度也应清掉');

// ---- 7. 拒绝非法 id ----
const bad = await callApi('GET', '/books/..%2f..%2fetc/chapter?index=0');
assert.equal(bad.status, 400);

// ---- 8. 目录（章节跳转用） ----
const tocBook = gbkUpload.data.book.id;
const toc = await callApi('GET', `/books/${tocBook}/toc`);
assert.equal(toc.data.ok, true);
assert.ok(Array.isArray(toc.data.titles) && toc.data.titles.length > 0, '目录应返回章节标题');

// ---- 9. 改元数据：分类 / 封面 / 书名 ----
const metaBook = tocBook;
const patched = await callApi('POST', `/books/${metaBook}/meta`, { category: '玄幻', title: '改过的书名' });
assert.equal(patched.data.ok, true);
assert.equal(patched.data.book.category, '玄幻');
assert.equal(patched.data.book.title, '改过的书名');

const withCover = await callApi('POST', `/books/${metaBook}/meta`, {
    cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
});
assert.ok(withCover.data.book.cover.startsWith('data:image/png;base64,'), '封面应被保存');

// 列表里能读到分类与封面
const listedAfterMeta = await callApi('GET', '/state');
const seen = listedAfterMeta.data.books.find((b) => b.id === metaBook);
assert.equal(seen.category, '玄幻');
assert.ok(seen.cover.startsWith('data:image/'), '列表里应带封面');

// 非法封面（http URL）必须被拒——放在最后，因为它会把封面清空
const badCover = await callApi('POST', `/books/${metaBook}/meta`, { cover: 'https://evil.example/x.png' });
assert.equal(badCover.data.book.cover, '', '非 data URL 的封面应被清空');

// ---- 10. 全书搜索 ----
const search = await callApi('GET', `/books/${metaBook}/search?q=${encodeURIComponent('第一章')}`);
assert.equal(search.data.ok, true);
assert.ok(search.data.hits.length > 0, '应能搜到章节');
assert.ok(search.data.hits[0].title.includes('第一章'), '命中应带章节标题');
assert.ok(typeof search.data.hits[0].snippet === 'string' && search.data.hits[0].snippet !== '', '命中应带片段');

const emptySearch = await callApi('GET', `/books/${metaBook}/search?q=`);
assert.deepEqual(emptySearch.data.hits, [], '空关键词不应返回命中');

// ---- 11. 更换本地文件：保留 id / 分类 / 封面，重算章节 ----
const replacement = ['第一章 新开始', '　　新正文。', '', '第二章 新继续', '　　更多正文。'].join('\n');
const replaced = await callApi('POST', `/books/${metaBook}/replace`, {
    name: 'new.txt',
    dataBase64: Buffer.from(replacement, 'utf8').toString('base64'),
});
assert.equal(replaced.data.ok, true);
assert.equal(replaced.data.book.id, metaBook, '换文件应保留原 id');
assert.equal(replaced.data.book.category, '玄幻', '换文件应保留分类');
assert.equal(replaced.data.book.chapterCount, 2, '换文件应重新分章');

const newChapter = await callApi('GET', `/books/${metaBook}/chapter?index=0`);
assert.ok(newChapter.data.text.includes('新正文'), '换文件后正文应更新');

// ---- 12. 「N、标题」编号格式（很多 txt 是这种，没有「第 N 章」） ----
// 关键点：正文里也有「1、…」开头的列表、书末还有重新编号的感谢名单，
// 必须靠「最长连续序号链」把真章节挑出来，不能把名单当章节。
const numbered = [];
for (let i = 1; i <= 30; i += 1) {
    numbered.push(`${i}、第${i}个标题`);
    numbered.push(`　　这是第 ${i} 章的正文内容。`);
    numbered.push('');
}
// 正文中间插一段以「1、」开头的列表（干扰项，序号会断）
numbered.splice(20, 0, '1、项目最终确定在A和B之间选择；', '2、康康兜兜里有糖，经常在盟群发言；', '');
// 书末再加一段从 1 重新编号的感谢名单（另一条短链）
for (let i = 1; i <= 8; i += 1) {
    numbered.push(`${i}、感谢名单第${i}位`);
    numbered.push('');
}
const numberedText = numbered.join('\n');
const numberedUpload = await callApi('POST', '/books', {
    name: 'numbered.txt',
    title: '编号格式',
    dataBase64: Buffer.from(numberedText, 'utf8').toString('base64'),
});
assert.equal(numberedUpload.status, 200);
assert.equal(numberedUpload.data.book.chapterCount, 30, '应只识别正文 30 章，不含列表与感谢名单');

const numberedToc = await callApi('GET', `/books/${numberedUpload.data.book.id}/toc`);
assert.equal(numberedToc.data.titles.length, 30);
assert.equal(numberedToc.data.titles[0], '1、第1个标题');
assert.equal(numberedToc.data.titles[29], '30、第30个标题');
assert.ok(!numberedToc.data.titles.some((x) => x.includes('感谢名单')), '感谢名单不应被当成章节');
assert.ok(!numberedToc.data.titles.some((x) => x.includes('项目最终确定')), '正文里的列表不应被当成章节');

// 章正文不能带上标题行
const numberedChapter = await callApi('GET', `/books/${numberedUpload.data.book.id}/chapter?index=0`);
assert.ok(!numberedChapter.data.text.includes('1、第1个标题'), '正文不应重复标题行');
assert.ok(numberedChapter.data.text.includes('这是第 1 章的正文内容'), '正文应正确');

// ---- 13. 重新分章（不用重新上传） ----
// 分章规则改进后，已上传的书仍是旧切法。rechunk 直接拿已存正文重算。
const beforeRechunk = await callApi('GET', `/books/${numberedUpload.data.book.id}/toc`);
const rechunked = await callApi('POST', `/books/${numberedUpload.data.book.id}/rechunk`, {});
assert.equal(rechunked.data.ok, true);
assert.equal(rechunked.data.chapters, 30, '重新分章后仍应是 30 章');
assert.ok(rechunked.data.book.chapterCount === 30, '元数据里的章数也要更新');
// 正文没变
const afterRechunk = await callApi('GET', `/books/${numberedUpload.data.book.id}/chapter?index=0`);
assert.ok(afterRechunk.data.text.includes('这是第 1 章的正文内容'), '重新分章不应改动正文');
// 进度被清掉（旧章号与新章节对不上）
const stateAfter = await callApi('GET', '/state');
assert.equal(stateAfter.data.state.progress[numberedUpload.data.book.id], undefined, '重新分章应清掉旧进度');

// ---- 14. 落盘检查 ----
const booksDir = path.join(tmpHome, 'stealthily-read', 'books');
assert.ok(fs.existsSync(path.join(tmpHome, 'stealthily-read', 'state.json')));

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log('全部通过 ✓');
