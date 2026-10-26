/**
 * dsh-stealthily-read — Host half.
 *
 * 只做三件事，全部是「本地资料库 + 阅读进度」的存取，不注册任何模型工具：
 *   1. 接收 txt 小说的原始字节（base64），自动识别编码（UTF-8 / UTF-16 / GB18030），
 *      切成章节后落盘到 ${DSH_HOME}/stealthily-read；
 *   2. 按章节返回正文，避免把整本书一次性塞进浏览器；
 *   3. 保存阅读进度与浮层几何（位置 / 大小 / 透明度 / 字号），刷新页面后能接着看。
 *
 * 之所以不做成模型工具：这是纯阅读界面，模型既不需要也不应该读到你上传的小说。
 *
 * 形态：`export const inject` + `export function apply(ctx)`，不提供 default export
 * （loader 的 unwrapExports 会取 exports.default，裸函数形态会丢 inject）。
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const inject = ['webServer'];

/** 路由前缀：与前端 client.js 里的 API 常量保持一致 */
const API_PREFIX = '/dsh-stealthily-read/api';
/** 单本小说原始字节上限（20 MiB）：超过这个体积的 txt 基本是合集，先自行拆分 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** 请求体上限：base64 会膨胀约 4/3，再留一点 JSON 余量 */
const MAX_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 64 * 1024;
/** 没有章节标题时按这个字数切段 */
const FALLBACK_CHUNK_CHARS = 3000;

/**
 * 章节标记：中文「第 N 章/回/节/卷/篇/集/部/话」，常见独立标题
 * （序章、楔子、尾声、番外…），以及英文 Chapter N。
 * 标记之后还要过 `isChapterTitle` 的「剩余部分」判断——
 * 只匹配前缀会把「第二章正文。」这种正文行也当成标题。
 */
const MARKER_RE = new RegExp(
    '^[\\s\\u3000]*(?:' +
        '第[\\s\\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+[\\s\\u3000]*[章回节卷篇集部话幕]' +
        '|(?:序章|序言|楔子|引子|前言|后记|尾声|终章|结局|番外)' +
        '|(?:Chapter|CHAPTER)[\\s\\u3000]+[0-9IVXLCivxlc]+' +
        ')',
);
/** 标题行最长字符数：再长就不是标题，是正文 */
const CHAPTER_TITLE_MAX = 60;
/** 标记后面还跟正文时，允许的「短标题」长度上限 */
const SHORT_TITLE_MAX = 12;
/** 出现这些标点就说明标记后面接的是句子，不是标题 */
const SENTENCE_PUNCT = /[。！？；…，,]/;

/**
 * 判定一行是不是章节标题。
 *
 * 只认行首的章节标记还不够：`第二章正文。` 同样以 `第二章` 开头。
 * 所以再看标记之后的部分——空、以分隔符开头、或是一小段没有句末标点的短标题，
 * 才算标题；否则当成正文。
 */
function isChapterTitle(line) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.length > CHAPTER_TITLE_MAX) return false;
    const match = MARKER_RE.exec(line);
    if (!match) return false;
    const rest = trimmed.slice(match[0].trim().length);
    if (rest === '') return true;
    if (/^[\s\u3000:：、.．·—–\-（(]/.test(rest)) return true;
    return rest.length <= SHORT_TITLE_MAX && !SENTENCE_PUNCT.test(rest);
}

/** 解码顺序：BOM → UTF-8 严格校验 → GB18030（中文 txt 最常见的编码）→ latin1 兜底 */
function decodeText(buffer) {
    if (buffer.length === 0) return { text: '', encoding: 'utf-8' };
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
    } catch {
        /* 不是合法 UTF-8，继续往下试 */
    }
    try {
        return { text: new TextDecoder('gb18030').decode(buffer), encoding: 'gb18030' };
    } catch {
        /* 运行时不支持 gb18030 时用 latin1 兜底，至少不丢字节 */
    }
    return { text: buffer.toString('latin1'), encoding: 'latin1' };
}

/**
 * 把整本正文切成章节。返回的每章只记字符区间，正文仍只在 book.txt 里存一份。
 * 找不到章节标题时按固定字数切段，标题写成「第 N 段」。
 */
function splitChapters(text) {
    const lines = text.split('\n');
    const marks = [];
    let offset = 0;
    for (const line of lines) {
        if (isChapterTitle(line)) {
            marks.push({ start: offset, title: line.trim() });
        }
        offset += line.length + 1; // 保留被 split 掉的 \n
    }

    if (marks.length === 0) {
        const chapters = [];
        for (let start = 0; start < text.length; start += FALLBACK_CHUNK_CHARS) {
            const end = Math.min(text.length, start + FALLBACK_CHUNK_CHARS);
            chapters.push({ title: `第 ${chapters.length + 1} 段`, start, end });
        }
        return chapters.length > 0 ? chapters : [{ title: '正文', start: 0, end: text.length }];
    }

    // 第一个标题之前的内容（书名页、简介）单独作为「开始」
    if (marks[0].start > 0 && text.slice(0, marks[0].start).trim() !== '') {
        marks.unshift({ start: 0, title: '开始' });
    }
    const chapters = marks.map((mark, index) => ({
        title: mark.title,
        start: mark.start,
        end: index + 1 < marks.length ? marks[index + 1].start : text.length,
    }));
    return chapters;
}

/** 章节正文：去掉标题行本身，首尾空白裁掉，避免阅读区顶部出现重复标题 */
function chapterBody(text, chapter) {
    const raw = text.slice(chapter.start, chapter.end);
    const firstBreak = raw.indexOf('\n');
    const body = firstBreak >= 0 ? raw.slice(firstBreak + 1) : raw;
    return body.replace(/^\s+/, '').replace(/\s+$/, '');
}

function safeTitle(input, fallback) {
    const text = String(input ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    const clipped = text.slice(0, 120);
    return clipped === '' ? fallback : clipped;
}

function sendJson(res, status, value) {
    if (res.headersSent) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
}

async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new Error(`请求体超过 ${Math.round(limit / 1024 / 1024)} MB 上限`);
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '') return {};
    return JSON.parse(text);
}

/**
 * 本地资料库：目录布局
 *   <root>/books/<id>.json   元数据 + 章节区间
 *   <root>/books/<id>.txt    归一化后的 UTF-8 正文
 *   <root>/state.json        阅读进度与浮层状态
 */
class Library {
    constructor(root) {
        this.root = root;
        this.booksDir = path.join(root, 'books');
        this.stateFile = path.join(root, 'state.json');
        /** id → { meta, text } 的内存缓存；txt 只有第一次读章节时才载入 */
        this.cache = new Map();
        this.ready = null;
    }

    async ensureDir() {
        if (!this.ready) {
            this.ready = fs.mkdir(this.booksDir, { recursive: true });
        }
        return this.ready;
    }

    async listBooks() {
        await this.ensureDir();
        const names = await fs.readdir(this.booksDir).catch(() => []);
        const books = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            try {
                const raw = await fs.readFile(path.join(this.booksDir, name), 'utf8');
                const meta = JSON.parse(raw);
                if (meta && typeof meta.id === 'string') books.push(this.publicMeta(meta));
            } catch {
                /* 单个文件损坏不影响列表 */
            }
        }
        books.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return books;
    }

    publicMeta(meta) {
        return {
            id: meta.id,
            title: meta.title,
            chapterCount: Array.isArray(meta.chapters) ? meta.chapters.length : 0,
            bytes: meta.bytes || 0,
            encoding: meta.encoding || 'utf-8',
            createdAt: meta.createdAt || '',
            updatedAt: meta.updatedAt || '',
            // 书架卡片用：分类、封面（data URL，存在 meta 里，跟书一起走）
            category: typeof meta.category === 'string' ? meta.category : '',
            cover: typeof meta.cover === 'string' ? meta.cover : '',
            chars: meta.chars || 0,
        };
    }

    /** 改一本书的元数据（分类 / 封面 / 书名） */
    async patchMeta(id, patch) {
        const meta = await this.readMeta(id);
        if (patch && typeof patch === 'object') {
            if ('title' in patch) meta.title = safeTitle(patch.title, meta.title);
            if ('category' in patch) meta.category = safeTitle(patch.category, '');
            if ('cover' in patch) {
                const cover = String(patch.cover || '');
                // 只收 data URL 或空串，避免把任意 URL 塞进来
                meta.cover = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(cover) ? cover : '';
            }
        }
        meta.updatedAt = new Date().toISOString();
        await fs.writeFile(path.join(this.booksDir, `${id}.json`), JSON.stringify(meta), 'utf8');
        // 缓存里的 meta 同步更新，避免读到旧值
        const cached = this.cache.get(id);
        if (cached) cached.meta = meta;
        return this.publicMeta(meta);
    }

    /** 换掉一本书的正文（重新解析章节），保留 id / 分类 / 封面 / 进度 */
    async replaceBook(id, { buffer, sourceName }) {
        const meta = await this.readMeta(id);
        const { text, encoding } = decodeText(buffer);
        const normalized = text.replace(/\r\n?/g, '\n');
        meta.chapters = splitChapters(normalized);
        meta.encoding = encoding;
        meta.bytes = buffer.length;
        meta.chars = normalized.length;
        if (sourceName) meta.sourceName = safeTitle(sourceName, meta.sourceName || '');
        meta.updatedAt = new Date().toISOString();
        await fs.writeFile(path.join(this.booksDir, `${id}.txt`), normalized, 'utf8');
        await fs.writeFile(path.join(this.booksDir, `${id}.json`), JSON.stringify(meta), 'utf8');
        this.cache.set(id, { meta, text: normalized });
        return this.publicMeta(meta);
    }

    /**
     * 全书搜索：返回命中的章节下标 + 前后文片段。
     * 只在内存里扫一遍已载入的正文，最多返回 limit 条。
     */
    async searchBook(id, query, limit = 60) {
        const needle = String(query || '').trim();
        if (needle === '') return [];
        const entry = await this.loadBook(id);
        const chapters = entry.meta.chapters || [];
        const lower = needle.toLowerCase();
        const hits = [];
        for (let index = 0; index < chapters.length; index += 1) {
            const chapter = chapters[index];
            const body = entry.text.slice(chapter.start, chapter.end);
            const at = body.toLowerCase().indexOf(lower);
            if (at < 0) continue;
            const from = Math.max(0, at - 24);
            const to = Math.min(body.length, at + needle.length + 36);
            hits.push({
                index,
                title: chapter.title,
                snippet: body.slice(from, to).replace(/\s+/g, ' ').trim(),
            });
            if (hits.length >= limit) break;
        }
        return hits;
    }

    async readMeta(id) {
        await this.ensureDir();
        const file = path.join(this.booksDir, `${id}.json`);
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw);
    }

    /** 载入整本正文（带内存缓存；缓存里同时存 meta，章节请求不再读 json） */
    async loadBook(id) {
        const cached = this.cache.get(id);
        if (cached) return cached;
        const meta = await this.readMeta(id);
        const text = await fs.readFile(path.join(this.booksDir, `${id}.txt`), 'utf8');
        const entry = { meta, text };
        this.cache.set(id, entry);
        return entry;
    }

    async addBook({ title, buffer, sourceName }) {
        await this.ensureDir();
        const { text, encoding } = decodeText(buffer);
        const normalized = text.replace(/\r\n?/g, '\n');
        const chapters = splitChapters(normalized);
        const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const meta = {
            id,
            title: safeTitle(title, safeTitle(sourceName, '未命名小说')),
            sourceName: safeTitle(sourceName, ''),
            encoding,
            bytes: buffer.length,
            chars: normalized.length,
            chapters,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await fs.writeFile(path.join(this.booksDir, `${id}.txt`), normalized, 'utf8');
        await fs.writeFile(path.join(this.booksDir, `${id}.json`), JSON.stringify(meta), 'utf8');
        this.cache.set(id, { meta, text: normalized });
        return this.publicMeta(meta);
    }

    async removeBook(id) {
        await this.ensureDir();
        this.cache.delete(id);
        await fs.rm(path.join(this.booksDir, `${id}.json`), { force: true });
        await fs.rm(path.join(this.booksDir, `${id}.txt`), { force: true });
        const state = await this.readState();
        if (state.progress && state.progress[id]) {
            delete state.progress[id];
        }
        if (state.activeBookId === id) {
            state.activeBookId = '';
        }
        await this.writeState(state);
        return true;
    }

    async readState() {
        await this.ensureDir();
        try {
            const raw = await fs.readFile(this.stateFile, 'utf8');
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    async writeState(state) {
        await this.ensureDir();
        const tmp = `${this.stateFile}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state), 'utf8');
        await fs.rename(tmp, this.stateFile);
        return state;
    }

    /** 只合并调用方真正给出的字段，避免一次浅合并把进度表整个抹掉 */
    async patchState(patch) {
        const current = await this.readState();
        const next = { ...current };
        if (patch && typeof patch === 'object') {
            if ('activeBookId' in patch) next.activeBookId = String(patch.activeBookId || '');
            if (patch.progress && typeof patch.progress === 'object') {
                next.progress = { ...(current.progress || {}) };
                for (const [bookId, value] of Object.entries(patch.progress)) {
                    if (value && typeof value === 'object') {
                        next.progress[bookId] = {
                            index: Math.max(0, Number(value.index) || 0),
                            // 分页阅读的页码；ratio 只作为换字体/换窗口大小后页码失效时的兜底
                            page: Math.max(0, Number(value.page) || 0),
                            pages: Math.max(1, Number(value.pages) || 1),
                            ratio: Math.min(1, Math.max(0, Number(value.ratio) || 0)),
                        };
                    }
                }
            }
            if (patch.overlay && typeof patch.overlay === 'object') {
                next.overlay = { ...(current.overlay || {}) };
                for (const [key, value] of Object.entries(patch.overlay)) {
                    if (value === null || typeof value !== 'object') next.overlay[key] = value;
                }
            }
        }
        return this.writeState(next);
    }

    /** 删除进度：前端点「从头开始」时用 */
    async clearProgress(bookId) {
        const state = await this.readState();
        if (state.progress && state.progress[bookId]) delete state.progress[bookId];
        return this.writeState(state);
    }
}

/** 小说 id 只允许我们自己生成的形态，杜绝 ../ 之类的路径穿越 */
function isBookId(id) {
    return typeof id === 'string' && /^[a-z0-9-]{6,64}$/.test(id);
}

function makeHandler(library, getConnection) {
    return async function handle(req, res) {
        // 插件前缀路由不经宿主鉴权，这里显式套用 Connection 的 Host/Origin/凭据检查
        const connection = getConnection();
        const rejection = connection?.requestRejection?.(req);
        if (rejection !== undefined) {
            return sendJson(res, rejection, {
                ok: false,
                code: rejection === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
                message: rejection === 401 ? '需要先登录 DSH 网页端' : '请求来源不受信任',
            });
        }

        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const route = url.pathname.replace(/^\/dsh-stealthily-read\/api\/?/, '');
        const method = req.method || 'GET';

        try {
            if (route === 'state' && method === 'GET') {
                const [books, state] = await Promise.all([library.listBooks(), library.readState()]);
                return sendJson(res, 200, { ok: true, books, state });
            }

            if (route === 'state' && method === 'POST') {
                const body = await readBody(req, 256 * 1024);
                const state = await library.patchState(body.state ?? body);
                return sendJson(res, 200, { ok: true, state });
            }

            if (route === 'books' && method === 'POST') {
                const body = await readBody(req, MAX_BODY_BYTES);
                const encoded = String(body.dataBase64 || '');
                if (encoded === '') {
                    return sendJson(res, 400, { ok: false, code: 'NO_DATA', message: '没有收到文件内容' });
                }
                const buffer = Buffer.from(encoded, 'base64');
                if (buffer.length === 0) {
                    return sendJson(res, 400, { ok: false, code: 'NO_DATA', message: '文件是空的' });
                }
                if (buffer.length > MAX_UPLOAD_BYTES) {
                    return sendJson(res, 413, {
                        ok: false,
                        code: 'TOO_LARGE',
                        message: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB，请先拆分`,
                    });
                }
                const book = await library.addBook({
                    title: body.title,
                    sourceName: body.name,
                    buffer,
                });
                return sendJson(res, 200, { ok: true, book });
            }

            const bookRoute = /^books\/([^/]+)(?:\/(chapter|delete|progress|meta|replace|search|toc))?$/.exec(route);
            if (bookRoute) {
                const id = bookRoute[1];
                const action = bookRoute[2] || '';
                if (!isBookId(id)) {
                    return sendJson(res, 400, { ok: false, code: 'BAD_ID', message: '小说 id 不合法' });
                }

                // 目录：只要章节标题，给「章节列表 / 章节跳转」用
                if (action === 'toc' && method === 'GET') {
                    let entry;
                    try {
                        entry = await library.loadBook(id);
                    } catch {
                        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这本小说' });
                    }
                    const chapters = entry.meta.chapters || [];
                    return sendJson(res, 200, {
                        ok: true,
                        titles: chapters.map((item) => item.title),
                    });
                }

                // 改元数据：书名 / 分类 / 封面
                if (action === 'meta' && method === 'POST') {
                    const body = await readBody(req, 3 * 1024 * 1024);
                    try {
                        const book = await library.patchMeta(id, body);
                        return sendJson(res, 200, { ok: true, book });
                    } catch {
                        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这本小说' });
                    }
                }

                // 换本地文件：重新解析章节，保留 id / 分类 / 封面 / 进度
                if (action === 'replace' && method === 'POST') {
                    const body = await readBody(req, MAX_BODY_BYTES);
                    const encoded = String(body.dataBase64 || '');
                    if (encoded === '') {
                        return sendJson(res, 400, { ok: false, code: 'NO_DATA', message: '没有收到文件内容' });
                    }
                    const buffer = Buffer.from(encoded, 'base64');
                    if (buffer.length === 0) {
                        return sendJson(res, 400, { ok: false, code: 'NO_DATA', message: '文件是空的' });
                    }
                    if (buffer.length > MAX_UPLOAD_BYTES) {
                        return sendJson(res, 413, {
                            ok: false,
                            code: 'TOO_LARGE',
                            message: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB，请先拆分`,
                        });
                    }
                    try {
                        const book = await library.replaceBook(id, { buffer, sourceName: body.name });
                        return sendJson(res, 200, { ok: true, book });
                    } catch {
                        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这本小说' });
                    }
                }

                // 全书搜索：命中章节 + 片段
                if (action === 'search' && method === 'GET') {
                    const query = url.searchParams.get('q') || '';
                    try {
                        const hits = await library.searchBook(id, query, 80);
                        return sendJson(res, 200, { ok: true, hits });
                    } catch {
                        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这本小说' });
                    }
                }

                if (action === 'chapter' && method === 'GET') {
                    const wanted = Number(url.searchParams.get('index') || 0);
                    let entry;
                    try {
                        entry = await library.loadBook(id);
                    } catch {
                        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这本小说' });
                    }
                    const chapters = entry.meta.chapters || [];
                    if (chapters.length === 0) {
                        return sendJson(res, 404, { ok: false, code: 'NO_CHAPTER', message: '这本小说没有可读内容' });
                    }
                    const index = Math.min(chapters.length - 1, Math.max(0, Number.isFinite(wanted) ? wanted : 0));
                    const chapter = chapters[index];
                    return sendJson(res, 200, {
                        ok: true,
                        index,
                        total: chapters.length,
                        title: chapter.title,
                        text: chapterBody(entry.text, chapter),
                        titles: chapters.map((item) => item.title),
                    });
                }

                if (action === 'delete' && method === 'POST') {
                    await library.removeBook(id);
                    return sendJson(res, 200, { ok: true });
                }

                if (action === 'progress' && method === 'POST') {
                    const body = await readBody(req, 64 * 1024);
                    if (body.clear === true) {
                        await library.clearProgress(id);
                        return sendJson(res, 200, { ok: true });
                    }
                    const state = await library.patchState({
                        activeBookId: id,
                        progress: { [id]: body.progress || {} },
                    });
                    return sendJson(res, 200, { ok: true, state });
                }
            }

            return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: `未知路由 ${route}` });
        } catch (error) {
            return sendJson(res, 500, {
                ok: false,
                code: 'INTERNAL',
                message: String(error?.message || error),
            });
        }
    };
}

export function apply(ctx) {
    const log = ctx.logger ?? { info: () => {}, error: () => {} };
    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.dsh');
    const library = new Library(path.join(home, 'stealthily-read'));
    const handler = makeHandler(library, () => {
        try {
            return ctx.get('connection');
        } catch {
            return undefined;
        }
    });

    // webServer 在 inject 里；用可选链是防「服务已注册但尚未就绪」的极短窗口
    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'prefix',
                path: API_PREFIX,
                handler: async (req, res) => {
                    await handler(req, res);
                },
            }),
        'stealthily-read: http routes',
    );

    // 卸载时把内存缓存放开，别把整本书一直攥在堆里
    ctx.effect(() => () => library.cache.clear(), 'stealthily-read: cache');

    log.info?.(`[stealthily-read] 已加载（${path.join(home, 'stealthily-read')}）`);
}

// 保留一个稳定导出的指纹，便于排查「装的是哪一份」；不影响运行时。
export const fingerprint = createHash('sha256').update('dsh-stealthily-read').digest('hex').slice(0, 12);
