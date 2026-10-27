/**
 * Client 半边的离线自检：用最小 React / ctx 桩跑一遍 factory 与 apply，
 * 确认没有语法或运行时错误，并检查两个席位都注册到了、左栏不再挂按钮。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8');

let registered = null;
const listeners = new Set();
globalThis.window = {
    __ModuleLoader__: {
        load(spec) {
            registered = spec;
        },
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(type, fn) {
        listeners.add(`${type}:${fn.name || 'fn'}`);
    },
    removeEventListener() {},
};

const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useReducer: (reducer, initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
};

const required = [];
const requireStub = (name) => {
    required.push(name);
    if (name === 'react') return React;
    throw new Error(`unexpected require: ${name}`);
};

new Function('window', 'styles', source)(globalThis.window, undefined);
assert.ok(registered, 'bundle 应注册 factory');
assert.equal(registered.id, 'dsh-stealthily-read');

const exportsObject = registered.factory(requireStub);
assert.deepEqual(required, ['react']);
assert.deepEqual(exportsObject.inject, ['slots', 'locale']);

const registrations = [];
const slots = {
    inject(name, callback) {
        return callback();
    },
    register(options, component) {
        registrations.push({ options, component });
        return () => {};
    },
};

const ctx = {
    effect(fn) {
        const dispose = fn();
        return typeof dispose === 'function' ? dispose : () => {};
    },
    get(name) {
        if (name === 'slots') return slots;
        if (name === 'locale') {
            return {
                register(ns, dicts) {
                    assert.equal(ns, 'stealthily-read');
                    assert.ok(dicts.zh && dicts.en, '两种语言都要有');
                    return () => {};
                },
                bind: () => (key) => key,
            };
        }
        return undefined;
    },
};

exportsObject.apply(ctx);

// 只允许设置页 + 浮层；左栏按钮是暴露点，必须没有
const names = registrations.map((item) => item.options.name).sort();
assert.deepEqual(names, ['settings.section', 'shell.overlay'], '左栏不应再注册任何按钮');
assert.equal(registrations.length, 2);

// 老板键监听应挂到 window 上
assert.ok(listeners.size > 0, '应注册全局键盘监听');

// 组件能渲染：浮层关闭时返回 null 是预期
for (const item of registrations) {
    const element = item.component({ wide: true });
    if (item.options.name === 'shell.overlay') {
        assert.equal(element, null, '浮层关闭时不渲染');
    } else {
        assert.ok(element && typeof element === 'object', `${item.options.name} 应返回元素`);
    }
}

// ---- 条件式 hook 检查 ----
// React 要求同一个组件每次渲染调用的 hook 数量与顺序一致。
// 之前把 useRef 写在 `if (!open) return null` 之后，浮层一关就整棵崩掉；
// 这里数一遍：组件里所有 hook 调用都必须出现在第一个提前 return 之前。
for (const item of registrations) {
    const fnSource = (() => {
        const name = item.options.name === 'shell.overlay' ? 'ReaderOverlay' : 'SettingsPage';
        const at = source.indexOf(`function ${name}(`);
        assert.ok(at > 0, `应能找到 ${name}`);
        let depth = 0;
        let seen = false;
        for (let i = at; i < source.length; i += 1) {
            if (source[i] === '{') {
                depth += 1;
                seen = true;
            } else if (source[i] === '}') {
                depth -= 1;
                if (seen && depth === 0) return source.slice(at, i + 1);
            }
        }
        throw new Error(`没能取出 ${name}`);
    })();

    const earlyReturn = fnSource.search(/if \(![a-zA-Z]+\) return null;/);
    if (earlyReturn > 0) {
        const after = fnSource.slice(earlyReturn);
        assert.ok(!/React\.use[A-Z]/.test(after), `${item.options.name}: 提前 return 之后不能再调用 hook`);
    }
}

// 阅读偏好默认值必须包含隐私相关项，且透明度允许到 0
const tree = JSON.stringify(registrations[0].component({ wide: true }));
assert.ok(tree.includes('sr-page'), '设置页应渲染出根节点');

// ---- 无边框：静态检查样式与默认值 ----
// 阅读窗容器不能有可见轮廓：不许 border-radius、不许 box-shadow、不许 border。
const winRule = /\.sr-win \{([\s\S]*?)\}/.exec(source);
assert.ok(winRule, '.sr-win 规则应存在');
const winCss = winRule[1];
assert.ok(/border-radius:\s*0/.test(winCss), '阅读窗不应有圆角轮廓');
assert.ok(/box-shadow:\s*none/.test(winCss), '阅读窗不应有阴影轮廓');
assert.ok(/border:\s*0/.test(winCss), '阅读窗不应有边框');
// 标题栏 / 底栏不能有底色——之前的灰条就是「大边框」的来源
const barRule = /\.sr-win \.bar \{([\s\S]*?)\}/.exec(source);
assert.ok(barRule && /background:\s*transparent/.test(barRule[1]), '标题栏应无底色');
const footRule = /\.sr-win \.foot \{([\s\S]*?)\}/.exec(source);
assert.ok(footRule && /background:\s*transparent/.test(footRule[1]), '底栏应无底色');
// 默认背景不透明度必须是 0（开箱即全透明）
assert.ok(/alpha:\s*0,/.test(source), '默认背景不透明度应为 0');
// 不透明度为 0 时必须走 transparent 分支
assert.ok(/alpha <= 0\.001 \? 'transparent'/.test(source), '不透明度 0 时应完全透明');
// 两个颜色都要能取色：原生颜色盘 + 屏幕取色
assert.ok(/type: 'color'/.test(source), '应有原生颜色选择器');
assert.ok(/EyeDropper/.test(source), '应有屏幕取色器');

// ---- 分页 + 点击/滚轮翻页 + 跟随会话字体 + 续读 ----
assert.ok(/function paginate\(/.test(source), '应有自动分页实现');
assert.ok(/new ResizeObserver/.test(source), '应按容器尺寸重新分页');
assert.ok(/'wheel'/.test(source), '应支持滚轮翻页');
assert.ok(/onBodyClick/.test(source), '应支持点击翻页');
assert.ok(/--dsw-font-markdown-base-font-family/.test(source), '字体应跟随会话正文 token');
assert.ok(/--dsw-font-markdown-base-font-size/.test(source), '字号应跟随会话正文 token');
// 默认 fontSize / lineHeight / fontWeight 为 0 = 跟随会话
assert.ok(/fontSize: 0,/.test(source) && /lineHeight: 0,/.test(source) && /fontWeight: 0,/.test(source),
    '默认应跟随会话的字号/行距/字重');
// 进度必须保存页号，才能「下次接着读」
assert.ok(/page: pageIndex/.test(source) && /pages: pages.length/.test(source), '进度应保存页码与总页数');
assert.ok(/saved\.page/.test(source) && /saved\.pages/.test(source), '重新分页后应恢复到保存的页码');

// ---- 性能与拖拽 ----
// 分页必须用「实测高度 + 实测段间距」，不能混用流坐标与相对高度：
// 混用会让切段之后的段落被算成巨大高度、误判放不下而提前换页——
// 表现就是「有些页正常、有些页空很多」。
const paginateBody = /async function paginate\([\s\S]*?\n {8}\}/.exec(source);
assert.ok(paginateBody, '应能取到 paginate 函数体');
const body = paginateBody[0];

// ---- 不阻塞主线程（这是「页面卡死但 DSH 没事」的根因） ----
// 必须分批测量、每批让出主线程；整章一次性同步测量会把主线程占满。
assert.ok(/MEASURE_BATCH/.test(source), '应有每批测量段数的常量');
assert.ok(/for \(let start = 0; start < paragraphs\.length; start \+= MEASURE_BATCH\)/.test(body), '应分批测量段落');
assert.ok(/await yieldToMain\(\)/.test(body), '每批之后应让出主线程');
assert.ok(/function yieldToMain\(\)/.test(source), '应有让出主线程的实现');
// 让出必须用宏任务（setTimeout），微任务插不进渲染和输入事件
assert.ok(/setTimeout\(resolve, 0\)/.test(source), '让出主线程应用 setTimeout（微任务无效）');
assert.ok(/async function paginateCached\(/.test(source), 'paginateCached 应改为异步');
assert.ok(/alive = false/.test(source), '异步分页要有竞态保护（切章时丢弃旧结果）');

// 段间距必须读真实 computed margin，而不是 em 估算
assert.ok(/getComputedStyle\(gapProbe\)\.marginBottom/.test(body), '段间距应读真实 computed margin');
assert.ok(!/gapPx = 0\.55/.test(body), '不应再按 0.55em 公式估算段间距');
// 关键：不能再混用流坐标差（bottom - lastBottom）
assert.ok(!/lastBottom/.test(body), '不应再用 lastBottom 做流坐标差（会与相对高度混用）');
assert.ok(!/item\.bottom - /.test(body), '不应再用 bottom 差值当段高');
assert.ok(/const gap = current\.length > 0 \? gapPx : 0/.test(body), '页内第一段不应加段间距');
assert.ok(/height - used - gap/.test(body), '切段时可用空间要扣掉段间距');
// 章标题高度必须实测，且要含 margin-bottom
assert.ok(/rect\.height \+ \(parseFloat\(cs\.marginBottom\) \|\| 0\)/.test(body), '章标题高度应实测并含下边距');
// 测量容器必须挂进真实正文节点，继承链才一致
assert.ok(/mount && mount\.nodeType === 1/.test(body), '测量容器应挂进真实正文节点');
assert.ok(/anchor\.appendChild\(host\)/.test(body), '测量容器应挂在 anchor 下');
assert.ok(/guard < 10/.test(body), '切段二分要有次数上限');
// 测量容器必须用 finally 清理，异步中断时也不能留在 DOM 里
assert.ok(/finally \{[\s\S]*?host\.parentNode\.removeChild\(host\)/.test(body), '测量容器应在 finally 中清理');
// 整段比一页还高时不能整段塞进去（那会被 overflow 裁掉）
assert.ok(/窗口矮到一行都装不下/.test(body), '应保留「窗口极矮」的兜底分支');
// 分页结果要缓存
assert.ok(/PAGE_CACHE/.test(source) && /paginateCached/.test(source), '分页结果应缓存');
// 拖拽必须用指针捕获，否则指针移出窗口就断
assert.ok(/setPointerCapture/.test(source), '拖拽应使用指针捕获');
assert.ok(/releasePointerCapture/.test(source), '松手应释放指针捕获');
// 拖动过程中不能碰 React state：直接改 DOM 样式，松手才同步一次
assert.ok(/box\.style\.left = /.test(source), '拖动应直接改 DOM 样式');
const gestureBody = /const startDrag = \(event\) => \{[\s\S]*?\n {12}\};/.exec(source);
assert.ok(gestureBody, '应能取到 startDrag');
const onMoveBody = /const onMove = \(ev\) => \{[\s\S]*?\n {16}\};/.exec(gestureBody[0]);
assert.ok(onMoveBody, '应能取到 onMove');
assert.ok(!/setState/.test(onMoveBody[0]), 'pointermove 里不能 setState（那是卡顿的根源）');
// 整框可拖：pointerdown 挂在根节点上
assert.ok(/onPointerDown: beginDrag,/.test(source), '整个框都应能拖动');
// 4px 阈值：点一下仍翻页，拖动才吞掉 click
assert.ok(/gesture\.moved && Math\.abs\(dx\) < 4/.test(source), '应有 4px 拖拽阈值');
assert.ok(/suppressClickRef\.current = gesture\.moved/.test(source), '只有真拖过才吞掉点击');

// ---- 缩放已彻底移除：宽高只在设置里调 ----
// 右下角曾经有个只会「提示可拖」却拖不动的缩放把手，误导且抢指针，必须没有残留。
assert.ok(!/grip/.test(source), '不应再有 grip 缩放手柄（含 CSS 与 JSX）');
assert.ok(!/beginResize/.test(source), '不应再有 resize 手势');
assert.ok(!/nwse-resize/.test(source), '不应再有缩放光标');
assert.ok(!/box\.style\.width = /.test(source), '拖动不应再改宽度');
assert.ok(!/box\.style\.height = /.test(source), '拖动不应再改高度');
assert.ok(!/dragHint/.test(source), '不应再残留「拖动移动窗口」提示文案');
// 宽高仍然可以在设置里调
assert.ok(/label: t\('sizeW'\)/.test(source) && /label: t\('sizeH'\)/.test(source), '设置里应保留宽高调节');

// ---- 书架：卡片墙 + 右键菜单 + 章节跳转 ----
assert.ok(/className: 'sr-shelf'/.test(source), '书架应渲染成卡片墙');
assert.ok(/onContextMenu/.test(source), '卡片应支持右键菜单');
assert.ok(/sr-menu/.test(source) && /menuChapters/.test(source), '右键菜单应有章节列表');
assert.ok(/menuSearch/.test(source) && /menuReplace/.test(source), '右键菜单应有搜索跳转与更换文件');
assert.ok(/menuCategory/.test(source) && /menuCover/.test(source), '右键菜单应有分类与封面');
assert.ok(/menuDelete/.test(source), '右键菜单应有删除');
assert.ok(/jumpToChapter/.test(source), '章节应能点击跳转');
assert.ok(/function panelBody\(/.test(source), '章节/搜索面板应独立成函数');
assert.ok(/books\/\$\{[^}]+\}\/toc/.test(source), '应请求目录接口');
assert.ok(/books\/\$\{[^}]+\}\/search/.test(source), '应请求搜索接口');
assert.ok(/books\/\$\{[^}]+\}\/replace/.test(source), '应请求更换文件接口');
assert.ok(/books\/\$\{[^}]+\}\/meta/.test(source), '应请求元数据接口');

// ---- 章标题高度必须计入分页（否则第一页底部空一块） ----
// 实测 h3 高度 + 它的下边距，不再用 em 公式估算
assert.ok(/rect\.height \+ \(parseFloat\(cs\.marginBottom\) \|\| 0\)/.test(source), '章标题高度应实测并含下边距');
assert.ok(/let used = headingPx;/.test(source), '第一页应从章标题高度起算');
assert.ok(/makeProbe\('测', 'h3'\)/.test(source), '应造 h3 探针量标题高度');
assert.ok(/style\.heading \? 'h' : '-'/.test(source), '分页缓存 key 要区分有无章标题');

// ---- 工具栏隐藏后仍要能翻章 ----
// chrome: 'never' 会把 bar/foot 一起 display:none，按钮全没了。
// 所以必须有不依赖工具栏的翻章入口，否则用户只能卡在某一章。
assert.ok(/chrome-never \.bar, \.sr-win\.chrome-never \.foot \{ display: none; \}/.test(source), '隐藏工具栏应真的隐藏');
// 1) 滚轮跨章：turn 到本章尽头会自动进下一章
assert.ok(/next >= pages\.length[\s\S]{0,120}goToChapter\(chapter\.index \+ 1, 'first'\)/.test(source), '滚到本章尽头应自动进下一章');
assert.ok(/next < 0[\s\S]{0,120}goToChapter\(chapter\.index - 1, 'last'\)/.test(source), '回退到本章开头应进上一章末页');
// 2) Alt / Shift + 滚轮直接跳章
assert.ok(/event\.altKey \|\| event\.shiftKey/.test(source), 'Alt/Shift + 滚轮应直接翻章');
// 3) 右键菜单：上一章 / 下一章 / 目录 / 隐藏
assert.ok(/onContextMenu/.test(source), '阅读窗应支持右键菜单');
assert.ok(/menuPrevChapter/.test(source) && /menuNextChapter/.test(source), '右键菜单应有上一章/下一章');
assert.ok(/menuToc/.test(source) && /menuHideWindow/.test(source), '右键菜单应有目录与隐藏');
assert.ok(/sr-rmenu/.test(source), '右键菜单应有独立样式');
// 4) 全局 PgUp/PgDn 兜底
assert.ok(/goChapterBy\(1\)/.test(source) && /goChapterBy\(-1\)/.test(source), '全局 PgUp/PgDn 应能翻章');

console.log('client 自检通过 ✓', registrations.map((item) => `${item.options.name}#${item.options.id}`).join(' | '));
