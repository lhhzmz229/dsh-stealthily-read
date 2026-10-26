/**
 * dsh-stealthily-read — Client half（浏览器侧）。
 *
 * 经典脚本形态：client-modules 注入 window.__ModuleLoader__，我们把 factory 注册进去。
 * 导出 inject / apply，与 Host half 的 ESM 形态不同。
 *
 * 两个席位：
 *   settings.section  设置页「阅读」：书架 + 全部参数
 *   shell.overlay     帧级浮层：无边框、只有文字的分页阅读窗
 *
 * 本版重点：
 *   · 自动分页：按当前窗口的宽高、字号、字体、行距、内边距把正文切成页；
 *   · 点击 / 滚轮 / 方向键翻页，不再靠滚动条；
 *   · 字体默认跟随会话正文（--dsw-font-markdown-base-font-family），不再是自己一套；
 *   · 进度按「第几章 + 第几页」保存，下次打开接着读；字号或窗口变了导致页数不同时，
 *     按比例折算到相近的位置，不会跳回开头。
 *
 * 无边框：容器没有 border / 圆角 / 阴影，标题栏和底栏都没有底色，
 * 默认背景不透明度为 0，窗口在视觉上只剩文字。
 */
window.__ModuleLoader__.load({
    id: 'dsh-stealthily-read',
    factory(require) {
        var module = { exports: {} };
        var exports = module.exports;

        const React = require('react');
        const h = React.createElement;

        const API = '/dsh-stealthily-read/api';
        const NS = 'stealthily-read';
        const MAX_BYTES = 20 * 1024 * 1024;
        const DEFAULT_BOSS_KEY = 'Alt+`';
        /** 会话正文的字体族 / 字号 token；取不到时退回界面字体 */
        const FONT_TOKEN = 'var(--dsw-font-markdown-base-font-family, var(--dsw-font-family, inherit))';
        const SIZE_TOKEN = 'var(--dsw-font-markdown-base-font-size, 16px)';
        const LINE_TOKEN = 'var(--dsw-font-markdown-base-line-height, 1.75)';

        // ---------------------------------------------------------------- 字典
        const zh = {
            nav: '阅读',
            title: '阅读',
            description: '上传 txt 文本，用无边框的浮层在页面上分页阅读。',
            upload: '上传 txt',
            uploading: '正在解析…',
            dropHint: '把 .txt 拖到这里，或点「上传 txt」选择文件',
            dropActive: '松手即上传',
            library: '书架',
            empty: '书架还是空的，先上传一本 txt。',
            read: '阅读',
            reading: '正在读',
            restart: '从头开始',
            remove: '删除',
            removeConfirm: '删除《{title}》？文件会从本机删除。',
            chapters: '{count} 章',
            chapter: '第 {index} / {total} 章',
            page: '第 {index} / {total} 页',
            progressAt: '读到第 {index} 章 第 {page} 页',
            notStarted: '还没开始',
            encoding: '编码',
            size: '大小',
            prev: '上一页',
            next: '下一页',
            toc: '目录',
            close: '关闭',
            hide: '隐藏',
            show: '显示阅读窗',
            hideWindow: '隐藏阅读窗',
            noBook: '还没有文本。到 设置 → 阅读 上传一个 txt。',
            loading: '加载中…',
            uploadFailed: '上传失败',
            tooLarge: '文件超过 20 MB，请先拆分',
            notTxt: '只支持 .txt 文件',
            uploaded: '已加入书架：{title}',
            deleted: '已删除',
            moved: '已重置进度',
            emptyChapter: '（这一章没有正文）',
            groupWindow: '阅读窗',
            groupText: '文字',
            groupBackdrop: '背景',
            groupBehavior: '行为',
            groupPrivacy: '隐私',
            bgColor: '背景颜色',
            bgColorHint: '背景色只在你调高不透明度时可见；不透明度为 0 时完全透明。',
            bgAlpha: '背景不透明度',
            bgAlphaHint: '0 = 完全透明，只剩文字浮在页面上；100 = 实心底色。',
            textColor: '文字颜色',
            textColorHint: '关掉「跟随界面」后用这个颜色；点取色器可以直接从屏幕上吸色。',
            textAuto: '跟随界面',
            textAutoHint: '开：用主题的文字色，深浅色切换自动适配。关：用下面选的颜色。',
            pick: '取色器',
            colorValue: '色值',
            fontFamily: '字体',
            fontFamilyHint: '默认跟随会话正文的字体；也可以选本机字体或直接填字体名。',
            fontPresetFollow: '跟随会话',
            fontPresetSong: '宋体',
            fontPresetHei: '雅黑',
            fontPresetKai: '楷体',
            fontPresetMono: '等宽',
            fontSize: '字号',
            fontSizeHint: '默认跟随会话正文的字号；拖动滑块后改用固定像素。',
            fontWeight: '字重',
            letterSpacing: '字距',
            lineHeight: '行距',
            padding: '内边距',
            indent: '首行缩进',
            textShadow: '文字描边',
            textShadowHint: '透明背景下加一层极淡描边，压在任意页面上都看得清。',
            autoTurn: '自动翻页',
            autoTurnHint: '每隔这么多秒自动翻一页；0 表示关闭。',
            autoTurnOff: '关',
            chrome: '工具栏',
            chromeAuto: '悬停显示',
            chromeAlways: '常显',
            chromeNever: '隐藏',
            chromeHint: '标题栏和翻页条。选「隐藏」后只剩正文，用点击或滚轮翻页。',
            showTitle: '标题栏显示书名',
            showTitleHint: '关掉更安全：别人扫一眼只看得到「阅读」。',
            bossKey: '老板键',
            bossKeyHint: '按一次藏起来，再按一次回来。点右边的按钮再按键即可修改。',
            bossKeyRecording: '请按新的组合键…',
            bossKeyReset: '恢复默认',
            hideOnLeave: '鼠标移出窗口自动隐藏',
            hideOnLeaveHint: '藏起来之后按老板键才会重新出现，避免误触。',
            resetAppearance: '恢复默认外观',
            sizeW: '宽度',
            sizeH: '高度',
            readingHint: '点击右半边 / 滚轮向下翻页，左半边 / 滚轮向上回退；← → 翻章，Esc 隐藏。',
            settingsHint: '阅读窗只在设置里开启，界面上没有任何「阅读」按钮。',
            turnMode: '翻页方式',
            turnModeHint: '默认「点击 + 滚轮」。选「仅滚轮」可以避免误点。',
            turnBoth: '点击 + 滚轮',
            turnWheel: '仅滚轮',
            booksUnit: '本',
            allCategories: '全部',
            emptyCategory: '这个分类下还没有书。',
            menuSearch: '搜索跳转',
            menuChapters: '章节列表',
            menuReplace: '更换本地文件',
            menuCategory: '设置分类',
            menuCover: '设置封面',
            menuDelete: '删除书籍',
            categoryPrompt: '输入分类名（留空 = 不分类）',
            categorySaved: '分类已保存',
            coverSaved: '封面已更新',
            replaced: '已更换文件并重新分章',
            searchPlaceholder: '搜索书名内的文字…',
            searchGo: '搜索',
            searchHint: '输入关键词后回车，会列出命中的章节。',
            noHits: '没有找到匹配的内容。',
        };
        const en = {
            nav: 'Reading',
            title: 'Reading',
            description: 'Upload a .txt novel and page through it in a borderless overlay.',
            upload: 'Upload txt',
            uploading: 'Parsing…',
            dropHint: 'Drop a .txt here, or click “Upload txt”',
            dropActive: 'Drop to upload',
            library: 'Library',
            empty: 'The library is empty. Upload a .txt first.',
            read: 'Read',
            reading: 'Reading',
            restart: 'Start over',
            remove: 'Delete',
            removeConfirm: 'Delete “{title}”? The file is removed from this machine.',
            chapters: '{count} chapters',
            chapter: 'Chapter {index} / {total}',
            page: 'Page {index} / {total}',
            progressAt: 'Chapter {index}, page {page}',
            notStarted: 'Not started',
            encoding: 'Encoding',
            size: 'Size',
            prev: 'Previous page',
            next: 'Next page',
            toc: 'Contents',
            close: 'Close',
            hide: 'Hide',
            show: 'Show reader',
            hideWindow: 'Hide reader',
            noBook: 'No novel yet. Upload a .txt in Settings → Reading.',
            loading: 'Loading…',
            uploadFailed: 'Upload failed',
            tooLarge: 'File is larger than 20 MB; split it first',
            notTxt: 'Only .txt files are supported',
            uploaded: 'Added to library: {title}',
            deleted: 'Deleted',
            moved: 'Progress reset',
            emptyChapter: '(This chapter has no text)',
            groupWindow: 'Reader window',
            groupText: 'Text',
            groupBackdrop: 'Background',
            groupBehavior: 'Behaviour',
            groupPrivacy: 'Privacy',
            bgColor: 'Background colour',
            bgColorHint: 'Only visible while opacity is above 0; at 0 the background disappears.',
            bgAlpha: 'Background opacity',
            bgAlphaHint: '0 = fully transparent, only text over the page; 100 = solid.',
            textColor: 'Text colour',
            textColorHint: 'Used when “Follow UI” is off. The eyedropper picks a colour from the screen.',
            textAuto: 'Follow UI',
            textAutoHint: 'On: the theme’s text colour adapts to light and dark. Off: use the colour below.',
            pick: 'Eyedropper',
            colorValue: 'Value',
            fontFamily: 'Font',
            fontFamilyHint: 'Follows the conversation font by default; any installed font also works.',
            fontPresetFollow: 'Follow chat',
            fontPresetSong: 'Songti',
            fontPresetHei: 'YaHei',
            fontPresetKai: 'Kaiti',
            fontPresetMono: 'Mono',
            fontSize: 'Size',
            fontSizeHint: 'Follows the conversation size by default; the slider switches to fixed pixels.',
            fontWeight: 'Weight',
            letterSpacing: 'Letter spacing',
            lineHeight: 'Line height',
            padding: 'Padding',
            indent: 'First-line indent',
            textShadow: 'Text outline',
            textShadowHint: 'A faint outline keeps the text readable on any page at zero background.',
            autoTurn: 'Auto page turn',
            autoTurnHint: 'Seconds between automatic page turns; 0 is off.',
            autoTurnOff: 'Off',
            chrome: 'Toolbars',
            chromeAuto: 'On hover',
            chromeAlways: 'Always',
            chromeNever: 'Hidden',
            chromeHint: 'Title bar and page bar. Hidden leaves only the text; click or wheel to turn.',
            showTitle: 'Show the book title in the bar',
            showTitleHint: 'Off is safer: a glance only shows “Reading”.',
            bossKey: 'Boss key',
            bossKeyHint: 'Press once to hide, again to bring it back. Click the button and press a combo to change it.',
            bossKeyRecording: 'Press a new combo…',
            bossKeyReset: 'Reset',
            hideOnLeave: 'Hide when the pointer leaves',
            hideOnLeaveHint: 'After hiding, the boss key brings it back — no accidental reveals.',
            resetAppearance: 'Reset appearance',
            sizeW: 'Width',
            sizeH: 'Height',
            readingHint: 'Click the right half or scroll down for the next page; left half or scroll up goes back. ← → change chapters, Esc hides.',
            settingsHint: 'The reader opens only from Settings; no “Reading” button exists anywhere in the UI.',
            turnMode: 'Page turning',
            turnModeHint: '“Click + wheel” by default; “Wheel only” avoids stray clicks.',
            turnBoth: 'Click + wheel',
            turnWheel: 'Wheel only',
            booksUnit: 'books',
            allCategories: 'All',
            emptyCategory: 'No books in this category.',
            menuSearch: 'Search & jump',
            menuChapters: 'Chapter list',
            menuReplace: 'Replace local file',
            menuCategory: 'Set category',
            menuCover: 'Set cover',
            menuDelete: 'Delete book',
            categoryPrompt: 'Category name (blank = none)',
            categorySaved: 'Category saved',
            coverSaved: 'Cover updated',
            replaced: 'File replaced and re-split into chapters',
            searchPlaceholder: 'Search inside the book…',
            searchGo: 'Search',
            searchHint: 'Type a keyword and press Enter to list matching chapters.',
            noHits: 'No matches found.',
        };

        let tr = null;
        let localeService = null;

        function t(key, vars) {
            let text = key;
            if (tr) {
                const value = tr(key);
                if (typeof value === 'string' && value !== '') text = value;
            }
            if (vars) {
                for (const [name, value] of Object.entries(vars)) {
                    text = text.replaceAll(`{${name}}`, String(value));
                }
            }
            return text;
        }

        // ---------------------------------------------------------------- 样式
        const CSS = `
.sr-page { display: flex; flex-direction: column; gap: 12px; padding: 2px 2px 28px;
  font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased;
  --sr-film: rgba(120, 120, 128, .12);
  --sr-film-strong: rgba(120, 120, 128, .18);
  --sr-line: rgba(120, 120, 128, .22);
  --sr-accent: var(--dsw-alias-brand-primary, #0a84ff);
  --sr-danger: var(--dsw-alias-state-error-primary, #ff453a);
  --sr-ok: var(--dsw-alias-state-success-primary, #30d158);
  --sr-radius: 12px;
  --sr-radius-sm: 8px;
  --sr-ease: cubic-bezier(.25, .1, .25, 1);
}
@media (prefers-color-scheme: light) {
  .sr-page { --sr-film: rgba(120, 120, 128, .09); --sr-film-strong: rgba(120, 120, 128, .15);
    --sr-line: rgba(60, 60, 67, .16); --sr-danger: var(--dsw-alias-state-error-primary, #ff3b30);
    --sr-ok: var(--dsw-alias-state-success-primary, #34c759); }
}
.sr-head { display: flex; flex-direction: column; gap: 3px; }
.sr-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.sr-head p { margin: 0; font-size: 12.5px; opacity: .6; }

.sr-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 20px 16px; border-radius: var(--sr-radius); cursor: pointer;
  background: var(--sr-film); border: 1px dashed var(--sr-line);
  transition: background-color .18s var(--sr-ease), border-color .18s var(--sr-ease); }
.sr-drop:hover { background: var(--sr-film-strong); }
.sr-drop.on { border-color: var(--sr-accent); background: var(--sr-film-strong); }
.sr-drop .big { font-size: 22px; line-height: 1; opacity: .45; }
.sr-drop .txt { font-size: 12.5px; opacity: .68; text-align: center; }
.sr-drop .sub { font-size: 11.5px; opacity: .45; }

.sr-sec { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.sr-sec .t { font-size: 12.5px; font-weight: 600; opacity: .72; white-space: nowrap; }
.sr-sec::after { content: ''; flex: 1 1 auto; height: 1px; background: var(--sr-line); }

.sr-group { display: flex; flex-direction: column; background: var(--sr-film); border-radius: var(--sr-radius); overflow: hidden; }
.sr-item { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; }
.sr-item + .sr-item { border-top: 1px solid var(--sr-line); }
.sr-item.active { background: var(--sr-film-strong); }
.sr-item .main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sr-item .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-item .meta { font-size: 11.5px; opacity: .55; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.sr-item .acts { display: flex; align-items: center; gap: 4px; flex: none; }

.sr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: 0; border-radius: var(--sr-radius-sm); padding: 5px 11px; font: inherit; font-size: 12.5px;
  font-weight: 500; cursor: pointer; white-space: nowrap; color: inherit; background: var(--sr-film-strong);
  transition: background-color .18s var(--sr-ease), filter .18s var(--sr-ease), opacity .18s var(--sr-ease); }
.sr-btn:active:not(:disabled) { transform: scale(.98); }
.sr-btn:disabled { opacity: .4; cursor: default; }
.sr-btn.primary { background: var(--sr-accent); color: #fff; }
.sr-btn.ghost { background: transparent; opacity: .62; padding: 5px 8px; }
.sr-btn.danger { color: var(--sr-danger); }
@media (hover: hover) and (pointer: fine) {
  .sr-btn:hover:not(:disabled) { background: var(--sr-film-strong); filter: brightness(1.05); }
  .sr-btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--sr-accent); }
  .sr-btn.ghost:hover:not(:disabled) { background: var(--sr-film); opacity: .95; }
}

.sr-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 6px;
  font-size: 11px; line-height: 1; background: var(--sr-film-strong); opacity: .85; white-space: nowrap; }
.sr-badge.brand { color: var(--sr-accent); background: rgba(10, 132, 255, .14); opacity: 1; }

.sr-banner { display: flex; align-items: flex-start; gap: 8px; padding: 8px 11px;
  border-radius: var(--sr-radius-sm); font-size: 12.5px; background: var(--sr-film); }
.sr-banner > span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.sr-banner.err { color: var(--sr-danger); background: rgba(255, 69, 58, .12); }
.sr-banner.ok { color: var(--sr-ok); background: rgba(52, 199, 89, .12); }
.sr-banner .x { border: 0; background: none; color: inherit; cursor: pointer; font-size: 15px;
  line-height: 1; padding: 0 1px; opacity: .55; }
.sr-banner .x:hover { opacity: .95; }

.sr-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 16px;
  text-align: center; background: var(--sr-film); border-radius: var(--sr-radius); }
.sr-empty .big { font-size: 22px; opacity: .3; line-height: 1; }
.sr-empty .txt { font-size: 12.5px; opacity: .6; }

/* ---- 书架卡片墙 ---- */
.sr-shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 14px 12px; }
.sr-card { display: flex; flex-direction: column; gap: 7px; cursor: pointer; min-width: 0; }
.sr-card .cover { position: relative; aspect-ratio: 3 / 4; border-radius: 10px; overflow: hidden;
  display: flex; align-items: center; justify-content: center; padding: 10px;
  background: var(--sr-film-strong); box-shadow: inset 0 0 0 1px var(--sr-line);
  transition: transform .16s var(--sr-ease), box-shadow .16s var(--sr-ease); }
.sr-card:hover .cover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px var(--sr-line), 0 6px 16px rgba(0, 0, 0, .18); }
.sr-card .cover img { width: 100%; height: 100%; object-fit: cover; }
.sr-card .cover-text { font-size: 12px; font-weight: 600; text-align: center; line-height: 1.45;
  opacity: .82; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.sr-card .tag { position: absolute; top: 6px; right: 6px; font-size: 10px; line-height: 1;
  padding: 3px 5px; border-radius: 5px; background: var(--sr-accent); color: #fff; }
.sr-card .tag.reading { right: auto; left: 6px; background: var(--sr-ok); }
.sr-card .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(128, 128, 128, .25); }
.sr-card .bar > i { display: block; height: 100%; background: var(--sr-accent); }
.sr-card .caption { font-size: 11.5px; line-height: 1.4; opacity: .72; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-card.active .caption { opacity: 1; font-weight: 600; }

/* ---- 右键菜单 ---- */
.sr-menu { position: fixed; z-index: 50; min-width: 178px; padding: 5px;
  border-radius: 10px; background: var(--dsw-alias-bg-overlay, #1c1c1e);
  color: var(--dsw-alias-label-primary, #f2f2f7);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .32), 0 0 0 1px rgba(128, 128, 128, .22);
  display: flex; flex-direction: column; }
.sr-menu .item { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  border: 0; background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  padding: 7px 9px; border-radius: 7px; cursor: pointer; }
.sr-menu .item:hover { background: rgba(128, 128, 128, .26); }
.sr-menu .item.danger { color: var(--sr-danger); }
.sr-menu .item .ic { width: 16px; text-align: center; opacity: .75; font-size: 13px; }
.sr-menu .sep { height: 1px; margin: 4px 6px; background: rgba(128, 128, 128, .26); }

/* ---- 章节 / 搜索面板 ---- */
.sr-panel { display: flex; flex-direction: column; max-height: 340px; overflow: hidden;
  border-radius: var(--sr-radius); background: var(--sr-film); }
.sr-panel .top { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex: none;
  border-bottom: 1px solid var(--sr-line); }
.sr-panel .top .t { flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-panel .searchbar { display: flex; gap: 6px; padding: 8px 10px; flex: none; }
.sr-panel .searchbar .sr-in { flex: 1 1 auto; }
.sr-panel .list { flex: 1 1 auto; overflow-y: auto; padding: 4px 6px 8px; }
.sr-panel .row { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  border: 0; background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  padding: 6px 9px; border-radius: 6px; cursor: pointer; }
.sr-panel .row:hover { background: var(--sr-film-strong); }
.sr-panel .row.on { background: var(--sr-film-strong); font-weight: 600; }
.sr-panel .row .sn { font-size: 11px; opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-panel .hint { padding: 12px 10px; font-size: 12px; opacity: .55; }

/* ---- 设置行 ---- */
.sr-row { display: flex; flex-direction: column; gap: 6px; padding: 11px 12px; }
.sr-row + .sr-row { border-top: 1px solid var(--sr-line); }
.sr-row .top { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.sr-row .label { flex: 1 1 auto; min-width: 0; font-size: 13px; }
.sr-row .val { flex: none; font-size: 12px; opacity: .55; font-variant-numeric: tabular-nums; }
.sr-row .hint { font-size: 11.5px; opacity: .5; line-height: 1.55; }
.sr-row input[type=range] { width: 100%; accent-color: var(--sr-accent); cursor: pointer; margin: 0; }
.sr-switch { position: relative; flex: none; width: 36px; height: 20px; border-radius: 10px; border: 0;
  padding: 0; cursor: pointer; background: var(--sr-film-strong); transition: background-color .18s var(--sr-ease); }
.sr-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .28);
  transition: transform .18s var(--sr-ease); }
.sr-switch.on { background: var(--sr-accent); }
.sr-switch.on::after { transform: translateX(16px); }
.sr-seg { display: flex; gap: 2px; padding: 2px; background: var(--sr-film); border-radius: 8px; flex-wrap: wrap; }
.sr-seg button { flex: 1 1 auto; border: 0; background: transparent; color: inherit; font: inherit;
  font-size: 12px; padding: 4px 8px; border-radius: 6px; cursor: pointer; opacity: .62; white-space: nowrap; }
.sr-seg button.on { background: var(--sr-film-strong); opacity: 1; font-weight: 600; }
.sr-key { display: inline-flex; align-items: center; justify-content: center; min-width: 92px;
  border: 0; border-radius: 7px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer;
  color: inherit; background: var(--sr-film-strong); font-family: ui-monospace, Menlo, Consolas, monospace; }
.sr-key.rec { background: var(--sr-accent); color: #fff; }
.sr-in { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; color: inherit;
  background: var(--sr-film-strong); border: 0; border-radius: var(--sr-radius-sm); padding: 5px 9px;
  outline: 2px solid transparent; outline-offset: -1px; }
.sr-in:focus { outline-color: var(--sr-accent); }
.sr-in.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }

/* ---- 取色器 ---- */
.sr-color { display: flex; align-items: center; gap: 6px; }
.sr-color .swatch { position: relative; width: 30px; height: 26px; border-radius: 7px; flex: none;
  overflow: hidden; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(128, 128, 128, .4); }
.sr-color .swatch input { position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px);
  border: 0; padding: 0; cursor: pointer; background: none; }
.sr-color .hex { width: 92px; flex: none; text-align: center; }
.sr-color .pick { flex: none; }

/* ---------------- 浮层阅读窗：无边框、无底色 ---------------- */
.sr-win { position: fixed; display: flex; flex-direction: column; box-sizing: border-box;
  border: 0; outline: 0; margin: 0; overflow: hidden; pointer-events: auto;
  border-radius: 0; box-shadow: none; cursor: grab; }
.sr-win:active { cursor: grabbing; }
/* 文字本身可选中，但指针仍是「可拖」的手型，跟摸鱼阅读一致 */
.sr-win .body, .sr-win .bar, .sr-win .strip { cursor: grab; }
.sr-win .strip { flex: none; height: 16px; cursor: grab; touch-action: none; user-select: none;
  background: transparent; position: relative; }
.sr-win .strip:active { cursor: grabbing; }
.sr-win .strip::after { content: '⋯'; position: absolute; left: 50%; top: -1px; transform: translateX(-50%);
  font-size: 11px; line-height: 1; opacity: 0; transition: opacity .16s var(--sr-ease);
  color: inherit; pointer-events: none; }
.sr-win:hover .strip::after { opacity: .35; }

.sr-win .bar { flex: none; display: flex; align-items: center; gap: 3px; padding: 1px 4px 2px;
  background: transparent; cursor: grab; touch-action: none; user-select: none;
  transition: opacity .16s var(--sr-ease); }
.sr-win .bar:active { cursor: grabbing; }
.sr-win .bar .name { flex: 1 1 auto; min-width: 0; font-size: 11px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .55; }
.sr-win .bar .pos { flex: none; font-size: 10.5px; opacity: .45; font-variant-numeric: tabular-nums; }
.sr-win .bar button { border: 0; background: transparent; color: inherit; cursor: pointer;
  font: inherit; font-size: 11.5px; line-height: 1; padding: 3px 4px; border-radius: 4px; opacity: .5; }
.sr-win .bar button:hover { opacity: 1; background: rgba(128, 128, 128, .3); }

/* body 只负责裁切；内边距在 .page 上，分页测量用的就是 .page 的内容盒 */
.sr-win .body { flex: 1 1 auto; min-height: 0; overflow: hidden; position: relative; }
.sr-win .body:active { cursor: grabbing; }
/* .page 不再裁切：分页已经保证内容放得下，留 overflow:hidden 只会在
   极少数亚像素误差时把最后半行切掉。改成 visible 后，宁可露出半行也不丢字。 */
.sr-win .page { position: absolute; inset: 0; box-sizing: border-box; overflow: visible; }
.sr-win .page h3 { margin: 0 0 .6em; font-weight: 600; opacity: .85; }
.sr-win .page p { margin: 0 0 .55em; overflow-wrap: anywhere; }
.sr-win .page .ph { opacity: .5; text-indent: 0 !important; }

.sr-win .foot { flex: none; display: flex; align-items: center; gap: 3px; padding: 1px 4px 2px;
  background: transparent; transition: opacity .16s var(--sr-ease); }
.sr-win .foot button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit;
  font-size: 11.5px; padding: 2px 5px; border-radius: 4px; opacity: .5; }
.sr-win .foot button:hover:not(:disabled) { opacity: 1; background: rgba(128, 128, 128, .3); }
.sr-win .foot button:disabled { opacity: .18; cursor: default; }
.sr-win .foot .pos { font-size: 10.5px; opacity: .45; }

.sr-win.chrome-never .bar, .sr-win.chrome-never .foot { display: none; }
.sr-win.chrome-auto .bar, .sr-win.chrome-auto .foot { opacity: 0; pointer-events: none; }
.sr-win.chrome-auto:hover .bar, .sr-win.chrome-auto:hover .foot { opacity: 1; pointer-events: auto; }

/* 没有缩放手柄：宽高统一在设置里调，框内任意位置都能拖动 */
.sr-win .body { touch-action: none; }

.sr-win .toc { position: absolute; inset: 0; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, #1c1c1e); color: var(--dsw-alias-label-primary, #f2f2f7);
  z-index: 2; }
.sr-win .toc .list { flex: 1 1 auto; overflow-y: auto; padding: 4px 6px 10px; }
.sr-win .toc .row { display: block; width: 100%; text-align: left; border: 0; background: transparent;
  color: inherit; font: inherit; font-size: 12px; padding: 5px 9px; border-radius: 5px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
.sr-win .toc .row:hover { background: rgba(128, 128, 128, .2); opacity: 1; }
.sr-win .toc .row.on { background: rgba(128, 128, 128, .28); opacity: 1; font-weight: 600; }
.sr-win .toc .top { display: flex; align-items: center; gap: 6px; padding: 5px 9px; flex: none;
  border-bottom: 1px solid rgba(128, 128, 128, .2); }
.sr-win .toc .top .t { flex: 1 1 auto; font-size: 12px; font-weight: 600; opacity: .8; }

@media (prefers-reduced-motion: reduce) {
  .sr-page *, .sr-win * { transition: none !important; animation: none !important; }
}
`;

        function installStyles(ctx) {
            let api;
            if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') api = styles;
            else if (ctx && typeof ctx.get === 'function') api = ctx.get('styles');
            if (api && typeof api.insert === 'function') return api.insert(CSS);
            if (typeof document === 'undefined') return () => {};
            if (document.getElementById('sr-style')) return () => {};
            const el = document.createElement('style');
            el.id = 'sr-style';
            el.textContent = CSS;
            (document.head || document.documentElement).appendChild(el);
            return () => {
                if (el.parentNode) el.parentNode.removeChild(el);
            };
        }

        // ---------------------------------------------------------------- 工具
        async function call(path, init) {
            const res = await fetch(`${API}/${path}`, init);
            let data;
            try {
                data = await res.json();
            } catch {
                data = undefined;
            }
            if (res.status === 401) throw new Error('需要先登录 DSH 网页端（请求未通过鉴权）');
            if (!data) throw new Error(`接口无 JSON 响应（HTTP ${res.status}）`);
            if (data.ok === false) throw new Error(data.message || `请求失败（HTTP ${res.status}）`);
            return data;
        }

        function postJson(path, body) {
            return call(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            });
        }

        function formatBytes(bytes) {
            const value = Number(bytes) || 0;
            if (value < 1024) return `${value} B`;
            if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
            return `${(value / 1024 / 1024).toFixed(2)} MB`;
        }

        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function normalizeHex(input) {
            const text = String(input || '').trim().replace(/^#/, '');
            if (/^[0-9a-f]{3}$/i.test(text)) {
                return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`.toLowerCase();
            }
            if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
            return '';
        }

        function hexToRgb(hex) {
            const value = normalizeHex(hex) || '#808080';
            return {
                r: parseInt(value.slice(1, 3), 16),
                g: parseInt(value.slice(3, 5), 16),
                b: parseInt(value.slice(5, 7), 16),
            };
        }

        function readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
                reader.readAsDataURL(file);
            });
        }

        // ---------------------------------------------------------------- 偏好
        function defaultPrefs() {
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 800;
            const w = clamp(Math.round(vw * 0.34), 300, 560);
            const hgt = clamp(Math.round(vh * 0.6), 240, 720);
            return {
                open: false,
                x: clamp(vw - w - 26, 12, Math.max(12, vw - w - 12)),
                y: clamp(Math.round(vh * 0.16), 12, Math.max(12, vh - hgt - 12)),
                w,
                h: hgt,
                alpha: 0,
                bgColor: '#808080',
                textAuto: true,
                textColor: '#e9e9ec',
                /** '' = 跟随会话正文字体 */
                fontFamily: '',
                /** 0 = 跟随会话正文字号；>0 用固定像素 */
                fontSize: 0,
                fontWeight: 0,
                letterSpacing: 0,
                lineHeight: 0,
                padding: 10,
                indent: 2,
                textShadow: true,
                autoTurn: 0,
                turnMode: 'both',
                chrome: 'auto',
                showTitle: false,
                bossKey: DEFAULT_BOSS_KEY,
                hideOnLeave: false,
            };
        }

        function normalizePrefs(raw) {
            const prefs = defaultPrefs();
            if (raw && typeof raw === 'object') {
                for (const key of ['x', 'y', 'w', 'h', 'alpha', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'padding', 'indent', 'autoTurn']) {
                    const value = Number(raw[key]);
                    if (Number.isFinite(value)) prefs[key] = value;
                }
                if (typeof raw.open === 'boolean') prefs.open = raw.open;
                if (normalizeHex(raw.bgColor)) prefs.bgColor = normalizeHex(raw.bgColor);
                if (normalizeHex(raw.textColor)) prefs.textColor = normalizeHex(raw.textColor);
                if (typeof raw.fontFamily === 'string') prefs.fontFamily = raw.fontFamily.slice(0, 120);
                if (['auto', 'always', 'never'].includes(raw.chrome)) prefs.chrome = raw.chrome;
                if (['both', 'wheel'].includes(raw.turnMode)) prefs.turnMode = raw.turnMode;
                if (typeof raw.bossKey === 'string' && raw.bossKey.trim() !== '') prefs.bossKey = raw.bossKey;
                for (const key of ['textAuto', 'textShadow', 'showTitle', 'hideOnLeave']) {
                    if (typeof raw[key] === 'boolean') prefs[key] = raw[key];
                }
                if (typeof raw.theme === 'string' && !normalizeHex(raw.bgColor)) {
                    const legacy = { light: '#ffffff', dark: '#1a1b1f', paper: '#f4ecd8' }[raw.theme];
                    if (legacy) prefs.bgColor = legacy;
                }
            }
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 800;
            prefs.w = clamp(Math.round(prefs.w), 200, Math.max(200, vw - 8));
            prefs.h = clamp(Math.round(prefs.h), 100, Math.max(100, vh - 8));
            prefs.x = clamp(Math.round(prefs.x), 0, Math.max(0, vw - 60));
            prefs.y = clamp(Math.round(prefs.y), 0, Math.max(0, vh - 30));
            prefs.alpha = clamp(prefs.alpha, 0, 1);
            prefs.fontSize = clamp(Math.round(prefs.fontSize), 0, 40);
            prefs.fontWeight = clamp(Math.round(prefs.fontWeight / 100) * 100, 0, 800);
            prefs.letterSpacing = clamp(prefs.letterSpacing, -1, 4);
            prefs.lineHeight = clamp(prefs.lineHeight, 0, 2.6);
            prefs.padding = clamp(Math.round(prefs.padding), 0, 48);
            prefs.indent = clamp(prefs.indent, 0, 3);
            prefs.autoTurn = clamp(Math.round(prefs.autoTurn), 0, 30);
            return prefs;
        }

        function persisted(prefs) {
            const out = {};
            for (const [key, value] of Object.entries(prefs)) {
                if (key === 'hidden') continue;
                out[key] = value;
            }
            return out;
        }

        /**
         * 实际生效的文字样式：0 表示跟随会话 token。
         *
         * `heading` 表示第一页会渲染章标题（h3）；它的高度由分页实测，
         * 不再靠 em 公式估算——公式和真实排版差一点，底部就会空出成片空白。
         */
        function textStyle(prefs) {
            return {
                fontFamily: prefs.fontFamily || FONT_TOKEN,
                fontSize: prefs.fontSize > 0 ? `${prefs.fontSize}px` : SIZE_TOKEN,
                fontWeight: prefs.fontWeight > 0 ? String(prefs.fontWeight) : 'inherit',
                letterSpacing: prefs.letterSpacing ? `${prefs.letterSpacing}px` : 'normal',
                lineHeight: prefs.lineHeight > 0 ? String(prefs.lineHeight) : LINE_TOKEN,
                indent: prefs.indent,
                padding: prefs.padding,
                heading: true,
            };
        }

        // ---------------------------------------------------------------- 分页
        /**
         * 判断一个码点是不是「全角」。
         * 分页按「视觉宽度」算：全角算 1 个字宽，半角算 0.5，这样中英混排也能估准。
         */
        function isWideCode(code) {
            return (
                code >= 0x1100 &&
                (code <= 0x115f ||
                    code === 0x2329 ||
                    code === 0x232a ||
                    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
                    (code >= 0xac00 && code <= 0xd7a3) ||
                    (code >= 0xf900 && code <= 0xfaff) ||
                    (code >= 0xfe30 && code <= 0xfe6f) ||
                    (code >= 0xff00 && code <= 0xff60) ||
                    (code >= 0xffe0 && code <= 0xffe6) ||
                    (code >= 0x20000 && code <= 0x3fffd))
            );
        }

        /** 一段文字的视觉宽度（以「一个汉字」为单位） */
        function unitsOf(text) {
            let units = 0;
            for (let i = 0; i < text.length; i += 1) {
                units += isWideCode(text.charCodeAt(i)) ? 1 : 0.5;
            }
            return units;
        }

        /** 在单位预算内能放下多少个字符（返回字符下标） */
        function indexForUnits(text, budget) {
            let used = 0;
            for (let i = 0; i < text.length; i += 1) {
                const w = isWideCode(text.charCodeAt(i)) ? 1 : 0.5;
                if (used + w > budget) return i;
                used += w;
            }
            return text.length;
        }

        /**
         * 分页结果缓存。
         *
         * 之前每翻一页、每拖一次窗口都会重排整章，几百次同步布局直接把主线程堵死，
         * 表现就是「翻页特别卡、窗口拖不动」。现在按「章 + 尺寸 + 字体样式」缓存，
         * 同一组参数只算一次；翻回去、改回来都直接命中。
         */
        const PAGE_CACHE = new Map();
        const PAGE_CACHE_MAX = 12;

        function cacheKey(chapterKey, width, height, style) {
            return `${chapterKey}|${Math.round(width)}x${Math.round(height)}|${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.letterSpacing}|${style.lineHeight}|${style.indent}|${style.heading ? 'h' : '-'}`;
        }

        /**
         * 按**实测流坐标**把段落切成页。
         *
         * 为什么不再用「逐段量高度再相加」：
         *   · 段间距靠 `0.55em` 公式估算，真实 margin 一有偏差就累积成底部空白；
         *   · 章标题高度靠公式估算，量不到真实值；
         *   · 测量容器一旦不在渲染侧的同一条继承链上，字号行高就可能取到 fallback 值。
         *
         * 现在的做法：把整章所有段落**一次性**排进测量容器（与正文同继承链、同宽度），
         * 一次布局后读每段的 offsetTop/offsetHeight。段落位置由浏览器真实排版决定，
         * 段间距、折行、章标题全都自动正确。切页只需要按「下一段起点 - 本页起点」
         * 和可用高度比较，完全是算术。
         */
        function paginate(paragraphs, width, height, style, mount) {
            if (typeof document === 'undefined') return [paragraphs];
            if (width < 40 || height < 30) return [paragraphs];

            // 测量容器与渲染侧共享 CSS 继承链（挂进 .page 里），
            // 这样 --dsw-font-markdown-base-* 等变量取到的值与正文完全一致。
            const anchor = mount && mount.nodeType === 1 ? mount : document.body;
            const host = document.createElement('div');
            host.style.cssText =
                'position:absolute;left:0;top:0;overflow:visible;visibility:hidden;' +
                'pointer-events:none;z-index:-1;contain:layout;';
            host.style.width = `${width}px`;
            host.style.fontFamily = style.fontFamily;
            host.style.fontSize = style.fontSize;
            host.style.fontWeight = style.fontWeight;
            host.style.letterSpacing = style.letterSpacing;
            host.style.lineHeight = style.lineHeight;
            host.style.wordBreak = 'break-word';
            host.style.overflowWrap = 'anywhere';
            anchor.appendChild(host);

            // 段间距：读真实 computed margin，而不是按 0.55em 估算
            const makeProbe = (text, tag = 'p') => {
                const node = document.createElement(tag);
                if (tag === 'p') {
                    node.style.cssText = `margin:0 0 .55em;padding:0;text-indent:${style.indent}em;white-space:normal;`;
                } else {
                    node.style.cssText = 'margin:0 0 .6em;font-size:.92em;font-weight:600;line-height:1.2;';
                }
                node.textContent = text;
                host.appendChild(node);
                return node;
            };

            // 段间距：读**真实** computed margin-bottom，不用 em 公式估算。
            // 之前混用「流坐标差」和「相对坐标」，切段后两套坐标一混，
            // 后面的段落就被算成一个巨大的高度、误判放不下而提前换页——
            // 表现就是「含切段的页面大片留白，别的页面正常」。
            // 现在统一成「自身高度 + 实测间距」，不再有任何坐标运算。
            const gapProbe = makeProbe('测');
            let gapPx = 0;
            try {
                gapPx = parseFloat(window.getComputedStyle(gapProbe).marginBottom) || 0;
            } catch {
                gapPx = 0;
            }
            host.removeChild(gapProbe);

            // 章标题：高度要含 margin-bottom（getBoundingClientRect 不含 margin，
            // 只取 height 会少算一个间距，第一页最后一行就被切掉半行）
            let headingPx = 0;
            if (style.heading) {
                const h3 = makeProbe('测', 'h3');
                try {
                    const rect = h3.getBoundingClientRect();
                    const cs = window.getComputedStyle(h3);
                    headingPx = rect.height + (parseFloat(cs.marginBottom) || 0);
                } catch {
                    headingPx = 0;
                }
                host.removeChild(h3);
            }

            // 一次性排好整章：只触发一次布局，读每段的真实高度（不含 margin）
            const nodes = paragraphs.map((text) => makeProbe(text));
            const heights = nodes.map((node) => {
                try {
                    return node.getBoundingClientRect().height;
                } catch {
                    return 0;
                }
            });
            for (const node of nodes) host.removeChild(node);

            // 跨页切段时才需要的探针
            const probe = makeProbe('');
            const measure = (text) => {
                probe.textContent = text;
                try {
                    return probe.getBoundingClientRect().height;
                } catch {
                    return 0;
                }
            };

            /** 在 room 像素内最多能放下多少个字符（实测二分，最多 10 次） */
            const fitChars = (text, room) => {
                if (room <= 0) return 0;
                let lo = 0;
                let hi = text.length;
                let best = 0;
                let guard = 0;
                while (lo <= hi && guard < 10) {
                    guard += 1;
                    const mid = (lo + hi) >> 1;
                    if (measure(text.slice(0, mid)) <= room + 0.5) {
                        best = mid;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                }
                return best;
            };

            const pages = [];
            let current = [];
            // 当前页已用像素；第一页先扣掉章标题（含它的下边距）
            let used = headingPx;

            for (let index = 0; index < paragraphs.length; index += 1) {
                let text = paragraphs[index];
                let ownHeight = heights[index];
                if (text === '') continue;

                // 一段可能跨多页，循环到它被放完为止
                while (text.length > 0) {
                    // 段与段之间要加间距；页内第一段不加（否则页首多一条空白）
                    const gap = current.length > 0 ? gapPx : 0;
                    const needed = gap + ownHeight;

                    if (used + needed <= height + 0.5) {
                        current.push(text);
                        used += needed;
                        text = '';
                        break;
                    }

                    // 放不下：这一页还剩多少像素可以给这段用（已扣掉间距）
                    const room = height - used - gap;
                    const fit = room > 0 ? fitChars(text, room) : 0;
                    if (fit > 0) {
                        // 切一段填满本页，剩余部分排到下一页
                        current.push(text.slice(0, fit));
                        pages.push(current);
                        current = [];
                        used = 0;
                        text = text.slice(fit).replace(/^[\s\u3000]+/, '');
                        ownHeight = measure(text);
                        continue;
                    }

                    if (current.length > 0) {
                        // 一个字都放不下：本页收尾，换页重新处理这一段
                        pages.push(current);
                        current = [];
                        used = 0;
                        continue;
                    }

                    // 当前页是空的、连一个字都放不下：窗口矮到一行都装不下，
                    // 整段单独成页保证有进展（唯一允许溢出的情况）
                    pages.push([text]);
                    text = '';
                    used = 0;
                }
            }

            host.removeChild(probe);
            if (host.parentNode) host.parentNode.removeChild(host);

            if (current.length > 0) pages.push(current);
            if (pages.length === 0) pages.push([]);
            return pages;
        }

        /** 带缓存的入口：同一组参数不重复计算 */
        function paginateCached(chapterKey, paragraphs, width, height, style, mount) {
            const key = cacheKey(chapterKey, width, height, style);
            const hit = PAGE_CACHE.get(key);
            if (hit) {
                // 命中后挪到末尾，维持 LRU 顺序
                PAGE_CACHE.delete(key);
                PAGE_CACHE.set(key, hit);
                return hit;
            }
            const pages = paginate(paragraphs, width, height, style, mount);
            PAGE_CACHE.set(key, pages);
            if (PAGE_CACHE.size > PAGE_CACHE_MAX) {
                const oldest = PAGE_CACHE.keys().next().value;
                PAGE_CACHE.delete(oldest);
            }
            return pages;
        }

        // ---------------------------------------------------------------- 老板键
        function parseCombo(text) {
            const combo = { alt: false, ctrl: false, shift: false, meta: false, key: '' };
            for (const part of String(text || '').split('+').map((item) => item.trim()).filter(Boolean)) {
                const low = part.toLowerCase();
                if (low === 'alt' || low === 'option') combo.alt = true;
                else if (low === 'ctrl' || low === 'control') combo.ctrl = true;
                else if (low === 'shift') combo.shift = true;
                else if (low === 'meta' || low === 'cmd' || low === 'command' || low === 'win') combo.meta = true;
                else combo.key = part;
            }
            return combo;
        }

        function normalizeKey(key) {
            const text = String(key || '');
            if (text === '`' || text === '~' || text === 'Backquote') return '`';
            if (text === ' ') return 'Space';
            return text.length === 1 ? text.toLowerCase() : text;
        }

        function comboMatches(combo, event) {
            if (!combo.key) return false;
            if (combo.alt !== Boolean(event.altKey)) return false;
            if (combo.ctrl !== Boolean(event.ctrlKey)) return false;
            if (combo.shift !== Boolean(event.shiftKey)) return false;
            if (combo.meta !== Boolean(event.metaKey)) return false;
            return normalizeKey(event.key) === normalizeKey(combo.key);
        }

        function comboFromEvent(event) {
            const parts = [];
            if (event.altKey) parts.push('Alt');
            if (event.ctrlKey) parts.push('Ctrl');
            if (event.shiftKey) parts.push('Shift');
            if (event.metaKey) parts.push('Meta');
            const key = normalizeKey(event.key);
            if (['alt', 'control', 'shift', 'meta', 'dead'].includes(key)) return '';
            parts.push(key === ' ' ? 'Space' : key);
            return parts.join('+');
        }

        function comboLabel(text) {
            return String(text || '').split('+').map((part) => part.trim()).join(' + ');
        }

        function isEditable(target) {
            if (!target || typeof target !== 'object') return false;
            const tag = String(target.tagName || '').toUpperCase();
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
        }

        // ---------------------------------------------------------------- 状态
        const initialState = {
            ready: false,
            books: [],
            activeBookId: '',
            progress: {},
            prefs: defaultPrefs(),
            hidden: false,
            chapter: null,
            toc: false,
            busy: false,
            error: '',
            notice: '',
        };

        let state = initialState;
        const listeners = new Set();

        function setState(patch) {
            state = typeof patch === 'function' ? { ...state, ...patch(state) } : { ...state, ...patch };
            for (const fn of listeners) fn();
        }

        function subscribe(fn) {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        }

        let prefsTimer = 0;
        function persistPrefs(patch) {
            if (patch) setState({ prefs: { ...state.prefs, ...patch } });
            clearTimeout(prefsTimer);
            prefsTimer = setTimeout(() => {
                postJson('state', { state: { overlay: persisted(state.prefs) } }).catch(() => {});
            }, 350);
        }

        let progressTimer = 0;
        let pendingProgress = null;
        /** 进度：章号 + 页号 + 总页数；页数变了就用 ratio 折算 */
        function persistProgress(bookId, payload) {
            if (!bookId) return;
            pendingProgress = { bookId, payload };
            clearTimeout(progressTimer);
            progressTimer = setTimeout(() => {
                const pending = pendingProgress;
                if (!pending) return;
                setState((s) => ({ progress: { ...s.progress, [pending.bookId]: pending.payload } }));
                postJson(`books/${pending.bookId}/progress`, { progress: pending.payload }).catch(() => {});
            }, 500);
        }

        let refreshPromise = null;
        async function refresh() {
            if (refreshPromise) return refreshPromise;
            refreshPromise = (async () => {
                try {
                    const data = await call('state');
                    const saved = data.state || {};
                    const prefs = normalizePrefs(saved.overlay);
                    const books = Array.isArray(data.books) ? data.books : [];
                    const activeBookId = books.some((book) => book.id === saved.activeBookId) ? saved.activeBookId : '';
                    setState({
                        ready: true,
                        books,
                        progress: saved.progress && typeof saved.progress === 'object' ? saved.progress : {},
                        activeBookId,
                        prefs,
                        error: '',
                    });
                    if (activeBookId && prefs.open) {
                        const savedIndex = Number((state.progress[activeBookId] || {}).index) || 0;
                        loadChapter(activeBookId, savedIndex);
                    }
                } catch (error) {
                    setState({ ready: true, error: String(error?.message || error) });
                } finally {
                    refreshPromise = null;
                }
            })();
            return refreshPromise;
        }

        async function loadChapter(bookId, index) {
            if (!bookId) {
                setState({ chapter: null });
                return;
            }
            setState({ busy: true });
            try {
                const data = await call(`books/${encodeURIComponent(bookId)}/chapter?index=${encodeURIComponent(index)}`);
                setState({
                    busy: false,
                    error: '',
                    chapter: {
                        bookId,
                        index: data.index,
                        total: data.total,
                        title: data.title,
                        text: data.text,
                        titles: Array.isArray(data.titles) ? data.titles : [],
                    },
                });
            } catch (error) {
                setState({ busy: false, error: String(error?.message || error) });
            }
        }

        function openReader(bookId) {
            const id = bookId || state.activeBookId || (state.books[0] && state.books[0].id) || '';
            const savedIndex = id ? Number((state.progress[id] || {}).index) || 0 : 0;
            if (id) setState({ activeBookId: id });
            setState({ hidden: false });
            persistPrefs({ open: true });
            if (id && (!state.chapter || state.chapter.bookId !== id || state.chapter.index !== savedIndex)) {
                loadChapter(id, savedIndex);
            }
        }

        function hideReader() {
            setState({ hidden: true, toc: false });
        }

        function toggleHidden() {
            if (!state.prefs.open) {
                openReader();
                return;
            }
            setState({ hidden: !state.hidden });
        }

        function closeReader() {
            persistPrefs({ open: false });
            setState({ hidden: false, toc: false });
        }

        async function uploadFile(file) {
            if (!file) return;
            if (!/\.txt$/i.test(file.name || '')) throw new Error(t('notTxt'));
            if (file.size > MAX_BYTES) throw new Error(t('tooLarge'));
            const dataUrl = await readFileAsDataUrl(file);
            const comma = dataUrl.indexOf(',');
            if (comma < 0) throw new Error(t('uploadFailed'));
            const data = await postJson('books', {
                name: file.name,
                title: String(file.name).replace(/\.txt$/i, ''),
                dataBase64: dataUrl.slice(comma + 1),
            });
            return data.book;
        }

        async function removeBook(book) {
            await postJson(`books/${encodeURIComponent(book.id)}/delete`, {});
            const books = state.books.filter((item) => item.id !== book.id);
            const progress = { ...state.progress };
            delete progress[book.id];
            const activeBookId = state.activeBookId === book.id ? '' : state.activeBookId;
            setState({
                books,
                progress,
                activeBookId,
                chapter: state.chapter && state.chapter.bookId === book.id ? null : state.chapter,
                notice: t('deleted'),
                error: '',
            });
        }

        async function resetProgress(book) {
            await postJson(`books/${encodeURIComponent(book.id)}/progress`, { clear: true });
            const progress = { ...state.progress };
            delete progress[book.id];
            setState({ progress, notice: t('moved'), error: '' });
            if (state.chapter && state.chapter.bookId === book.id) loadChapter(book.id, 0);
        }

        // ---------------------------------------------------------------- 钩子
        function useStore() {
            const [value, setValue] = React.useState(state);
            React.useEffect(() => {
                const off = subscribe(() => setValue(state));
                setValue(state);
                return () => off();
            }, []);
            return value;
        }

        function useLocaleTick() {
            const [, force] = React.useReducer((count) => count + 1, 0);
            React.useEffect(() => {
                if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
                const off = localeService.subscribe(force);
                return () => {
                    if (typeof off === 'function') off();
                };
            }, []);
        }

        // ---------------------------------------------------------------- 控件
        function Switch(props) {
            return h('button', {
                type: 'button',
                role: 'switch',
                'aria-checked': props.on ? 'true' : 'false',
                className: props.on ? 'sr-switch on' : 'sr-switch',
                title: props.title || '',
                onClick: props.onChange,
            });
        }

        function Row(props) {
            return h('div', { className: 'sr-row' },
                h('div', { className: 'top' },
                    h('span', { className: 'label' }, props.label),
                    props.value !== undefined ? h('span', { className: 'val' }, props.value) : null,
                    props.control || null),
                props.hint ? h('div', { className: 'hint' }, props.hint) : null,
                props.children || null);
        }

        function Slider(props) {
            return h('input', {
                type: 'range',
                min: props.min,
                max: props.max,
                step: props.step,
                value: props.value,
                onChange: (e) => props.onChange(Number(e.target.value)),
            });
        }

        function ColorField(props) {
            const { label, hint, value, onChange } = props;
            const [text, setText] = React.useState(value);
            React.useEffect(() => {
                setText(value);
            }, [value]);
            const canPick = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

            const commit = (next) => {
                const hex = normalizeHex(next);
                if (hex) onChange(hex);
                else setText(value);
            };

            const pickFromScreen = async () => {
                try {
                    const result = await new window.EyeDropper().open();
                    if (result && normalizeHex(result.sRGBHex)) onChange(normalizeHex(result.sRGBHex));
                } catch {
                    /* 用户取消 */
                }
            };

            return h(Row, { label, hint },
                h('div', { className: 'sr-color' },
                    h('span', { className: 'swatch', style: { background: value } },
                        h('input', {
                            type: 'color',
                            value: normalizeHex(value) || '#808080',
                            onChange: (e) => onChange(normalizeHex(e.target.value) || value),
                            title: label,
                        })),
                    h('input', {
                        className: 'sr-in mono hex',
                        value: text,
                        spellCheck: false,
                        onChange: (e) => setText(e.target.value),
                        onBlur: () => commit(text),
                        onKeyDown: (e) => {
                            if (e.key === 'Enter') commit(text);
                        },
                    }),
                    canPick
                        ? h('button', {
                            className: 'sr-btn ghost pick',
                            title: t('pick'),
                            onClick: pickFromScreen,
                        }, '🖉')
                        : null));
        }

        // ---------------------------------------------------------------- 设置页
        /**
         * 章节列表 / 搜索结果的正文。
         * 单独抽出来是为了让设置页的 JSX 保持扁平——内联三层三元表达式太容易数错括号。
         */
        function panelBody(panel, s, jump, t) {
            if (panel.loading) return h('div', { className: 'hint' }, t('loading'));

            if (panel.mode === 'search') {
                if (panel.hits.length === 0) {
                    return h('div', { className: 'hint' }, panel.query ? t('noHits') : t('searchHint'));
                }
                return h('div', { className: 'list' },
                    panel.hits.map((hit) => h('button', {
                        key: `${hit.index}-${hit.snippet}`,
                        className: 'row',
                        onClick: () => jump(panel.book, hit.index),
                    },
                        h('span', { className: 'tt' }, `${hit.index + 1}. ${hit.title}`),
                        h('span', { className: 'sn' }, hit.snippet))));
            }

            const current = Number((s.progress[panel.book.id] || {}).index) || 0;
            return h('div', { className: 'list' },
                panel.titles.map((title, index) => h('button', {
                    key: index,
                    className: index === current ? 'row on' : 'row',
                    onClick: () => jump(panel.book, index),
                }, `${index + 1}. ${title}`)));
        }

        function SettingsPage() {
            useLocaleTick();
            const s = useStore();
            const [busy, setBusy] = React.useState(false);
            const [dragging, setDragging] = React.useState(false);
            const [error, setError] = React.useState('');
            const [notice, setNotice] = React.useState('');
            const [recording, setRecording] = React.useState(false);
            const inputRef = React.useRef(null);

            // ---- 书架交互：右键菜单、分类筛选、章节列表、搜索跳转 ----
            const [menu, setMenu] = React.useState(null);
            const [filterCategory, setFilterCategory] = React.useState('');
            const [panel, setPanel] = React.useState(null);
            const replaceRef = React.useRef(null);
            const coverRef = React.useRef(null);
            const pendingReplace = React.useRef(null);

            React.useEffect(() => {
                if (!state.ready) refresh();
            }, []);

            // 点空白处关掉右键菜单
            React.useEffect(() => {
                if (!menu) return undefined;
                const close = () => setMenu(null);
                window.addEventListener('pointerdown', close);
                window.addEventListener('keydown', close);
                return () => {
                    window.removeEventListener('pointerdown', close);
                    window.removeEventListener('keydown', close);
                };
            }, [menu]);

            const categories = React.useMemo(() => {
                const set = new Set();
                for (const book of s.books) {
                    if (book.category) set.add(book.category);
                }
                return [...set].sort();
            }, [s.books]);

            const visibleBooks = filterCategory
                ? s.books.filter((book) => book.category === filterCategory)
                : s.books;

            const runUpload = async (files) => {
                const list = Array.from(files || []).filter(Boolean);
                if (list.length === 0) return;
                setBusy(true);
                setError('');
                setNotice('');
                try {
                    const added = [];
                    for (const file of list) added.push(await uploadFile(file));
                    const fresh = await call('state');
                    setState({ books: Array.isArray(fresh.books) ? fresh.books : state.books });
                    setNotice(t('uploaded', { title: added.map((book) => book.title).join('、') }));
                } catch (e) {
                    setError(String(e?.message || e));
                } finally {
                    setBusy(false);
                }
            };

            const onPick = (event) => {
                runUpload(event.target.files);
                event.target.value = '';
            };

            const onDrop = (event) => {
                event.preventDefault();
                setDragging(false);
                runUpload(event.dataTransfer && event.dataTransfer.files);
            };

            const confirmRemove = (book) => {
                if (!window.confirm(t('removeConfirm', { title: book.title }))) return;
                removeBook(book).catch((e) => setError(String(e?.message || e)));
            };

            const prefs = s.prefs;
            const setPrefs = (patch) => persistPrefs(patch);

            const onRecordKey = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                    setRecording(false);
                    return;
                }
                const combo = comboFromEvent(event);
                if (!combo || combo.split('+').length < 2) return;
                setRecording(false);
                setPrefs({ bossKey: combo });
            };

            const FONTS = [
                ['', t('fontPresetFollow')],
                ['SimSun, 宋体, serif', t('fontPresetSong')],
                ['"Microsoft YaHei", 微软雅黑, sans-serif', t('fontPresetHei')],
                ['KaiTi, 楷体, serif', t('fontPresetKai')],
                ['ui-monospace, Menlo, Consolas, monospace', t('fontPresetMono')],
            ];

            /** 用最新的书架数据刷新界面 */
            const reload = async () => {
                const fresh = await call('state');
                setState({ books: Array.isArray(fresh.books) ? fresh.books : state.books });
            };

            /** 改书名 / 分类 / 封面 */
            const patchBook = async (book, patch, message) => {
                setError('');
                try {
                    await postJson(`books/${encodeURIComponent(book.id)}/meta`, patch);
                    await reload();
                    if (message) setNotice(message);
                } catch (e) {
                    setError(String(e?.message || e));
                }
            };

            const setCategory = (book) => {
                const current = book.category || '';
                const next = window.prompt(t('categoryPrompt'), current);
                if (next === null) return;
                patchBook(book, { category: next.trim() }, t('categorySaved')).catch(() => {});
            };

            const setCover = (book) => {
                pendingReplace.current = { kind: 'cover', book };
                if (coverRef.current) coverRef.current.click();
            };

            const setLocalFile = (book) => {
                pendingReplace.current = { kind: 'replace', book };
                if (replaceRef.current) replaceRef.current.click();
            };

            const onCoverPicked = async (event) => {
                const file = event.target.files && event.target.files[0];
                event.target.value = '';
                const pending = pendingReplace.current;
                pendingReplace.current = null;
                if (!file || !pending || pending.kind !== 'cover') return;
                try {
                    const dataUrl = await readFileAsDataUrl(file);
                    await patchBook(pending.book, { cover: dataUrl }, t('coverSaved'));
                } catch (e) {
                    setError(String(e?.message || e));
                }
            };

            const onReplacePicked = async (event) => {
                const file = event.target.files && event.target.files[0];
                event.target.value = '';
                const pending = pendingReplace.current;
                pendingReplace.current = null;
                if (!file || !pending || pending.kind !== 'replace') return;
                if (!/\.txt$/i.test(file.name || '')) {
                    setError(t('notTxt'));
                    return;
                }
                try {
                    const dataUrl = await readFileAsDataUrl(file);
                    const comma = dataUrl.indexOf(',');
                    await postJson(`books/${encodeURIComponent(pending.book.id)}/replace`, {
                        name: file.name,
                        dataBase64: dataUrl.slice(comma + 1),
                    });
                    await reload();
                    setNotice(t('replaced'));
                } catch (e) {
                    setError(String(e?.message || e));
                }
            };

            /** 打开「章节列表 / 搜索」面板，并顺带取回目录 */
            const openPanel = async (book, mode) => {
                setMenu(null);
                setPanel({ book, mode, titles: [], hits: [], query: '', loading: true });
                try {
                    const data = await call(`books/${encodeURIComponent(book.id)}/toc`);
                    setPanel((prev) => (prev && prev.book.id === book.id ? { ...prev, titles: data.titles || [], loading: false } : prev));
                } catch (e) {
                    setError(String(e?.message || e));
                    setPanel(null);
                }
            };

            /** 章节跳转：设定进度并打开阅读窗，落到指定章 */
            const jumpToChapter = (book, index) => {
                setPanel(null);
                setState((prev) => ({
                    progress: { ...prev.progress, [book.id]: { index, page: 0, pages: 1, ratio: 0 } },
                    activeBookId: book.id,
                    hidden: false,
                }));
                postJson(`books/${encodeURIComponent(book.id)}/progress`, {
                    progress: { index, page: 0, pages: 1, ratio: 0 },
                }).catch(() => {});
                persistPrefs({ open: true });
                loadChapter(book.id, index);
            };

            const runSearch = async () => {
                const current = panel;
                if (!current || !current.query.trim()) return;
                try {
                    const data = await call(`books/${encodeURIComponent(current.book.id)}/search?q=${encodeURIComponent(current.query.trim())}`);
                    setPanel((prev) => (prev ? { ...prev, hits: data.hits || [], loading: false } : prev));
                } catch (e) {
                    setError(String(e?.message || e));
                }
            };

            return h('div', { className: 'sr-page' },
                h('div', { className: 'sr-head' },
                    h('h2', {}, t('title')),
                    h('p', {}, t('description'))),

                h('div', { className: 'sr-group' },
                    h(Row, {
                        label: prefs.open && !s.hidden ? t('hideWindow') : t('show'),
                        hint: t('settingsHint'),
                        control: h('button', {
                            className: 'sr-btn primary',
                            onClick: () => (prefs.open && !s.hidden ? hideReader() : openReader()),
                        }, prefs.open && !s.hidden ? t('hide') : t('show')),
                    })),

                h('div', {
                    className: dragging ? 'sr-drop on' : 'sr-drop',
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => inputRef.current && inputRef.current.click(),
                    onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (inputRef.current) inputRef.current.click();
                        }
                    },
                    onDragOver: (e) => {
                        e.preventDefault();
                        if (!dragging) setDragging(true);
                    },
                    onDragLeave: () => setDragging(false),
                    onDrop,
                },
                    h('div', { className: 'big' }, busy ? '⏳' : '📄'),
                    h('div', { className: 'txt' }, busy ? t('uploading') : dragging ? t('dropActive') : t('dropHint')),
                    h('div', { className: 'sub' }, 'txt · ≤ 20 MB · UTF-8 / GBK / UTF-16'),
                    h('input', {
                        ref: inputRef,
                        type: 'file',
                        accept: '.txt,text/plain',
                        multiple: true,
                        style: { display: 'none' },
                        onChange: onPick,
                    })),

                error ? h('div', { className: 'sr-banner err' },
                    h('span', {}, error),
                    h('button', { className: 'x', onClick: () => setError(''), title: t('close') }, '×')) : null,
                notice ? h('div', { className: 'sr-banner ok' },
                    h('span', {}, notice),
                    h('button', { className: 'x', onClick: () => setNotice(''), title: t('close') }, '×')) : null,
                s.error ? h('div', { className: 'sr-banner err' },
                    h('span', {}, s.error),
                    h('button', { className: 'x', onClick: () => setState({ error: '' }), title: t('close') }, '×')) : null,

                h('div', { className: 'sr-sec' },
                    h('span', { className: 't' }, t('library')),
                    h('span', { style: { flex: '0 0 auto', fontSize: '11.5px', opacity: .45 } },
                        `${s.books.length} ${t('booksUnit')}`)),

                // ---- 分类筛选 ----
                categories.length > 0
                    ? h('div', { className: 'sr-seg' },
                        [['', t('allCategories')], ...categories.map((c) => [c, c])].map(([value, label]) => h('button', {
                            key: value || 'all',
                            className: filterCategory === value ? 'on' : '',
                            onClick: () => setFilterCategory(value),
                        }, label)))
                    : null,

                visibleBooks.length === 0
                    ? h('div', { className: 'sr-empty' },
                        h('div', { className: 'big' }, '📚'),
                        h('div', { className: 'txt' }, s.books.length === 0 ? t('empty') : t('emptyCategory')))
                    : h('div', { className: 'sr-shelf' },
                        visibleBooks.map((book) => {
                            const active = book.id === s.activeBookId;
                            const progress = s.progress[book.id];
                            const percent = progress && book.chapterCount > 0
                                ? Math.round((((Number(progress.index) || 0) + 1) / book.chapterCount) * 100)
                                : 0;
                            return h('div', {
                                key: book.id,
                                className: active ? 'sr-card active' : 'sr-card',
                                title: book.title,
                                onClick: () => openReader(book.id),
                                onContextMenu: (event) => {
                                    event.preventDefault();
                                    setMenu({
                                        book,
                                        x: Math.min(event.clientX, (window.innerWidth || 1280) - 190),
                                        y: Math.min(event.clientY, (window.innerHeight || 800) - 230),
                                    });
                                },
                            },
                                h('div', { className: 'cover' },
                                    book.cover
                                        ? h('img', { src: book.cover, alt: '', draggable: false })
                                        : h('div', { className: 'cover-text' }, book.title),
                                    h('span', { className: 'tag' }, 'txt'),
                                    active ? h('span', { className: 'tag reading' }, t('reading')) : null,
                                    percent > 0 ? h('div', { className: 'bar' }, h('i', { style: { width: `${percent}%` } })) : null),
                                h('div', { className: 'caption' }, book.title));
                        })),

                // ---- 右键菜单 ----
                menu ? h('div', {
                    className: 'sr-menu',
                    style: { left: `${menu.x}px`, top: `${menu.y}px` },
                    onPointerDown: (event) => event.stopPropagation(),
                },
                    h('button', {
                        className: 'item',
                        onClick: () => openPanel(menu.book, 'search'),
                    }, h('span', { className: 'ic' }, '🔍'), t('menuSearch')),
                    h('button', {
                        className: 'item',
                        onClick: () => openPanel(menu.book, 'toc'),
                    }, h('span', { className: 'ic' }, '☰'), t('menuChapters')),
                    h('button', {
                        className: 'item',
                        onClick: () => { setMenu(null); setLocalFile(menu.book); },
                    }, h('span', { className: 'ic' }, '📁'), t('menuReplace')),
                    h('div', { className: 'sep' }),
                    h('button', {
                        className: 'item',
                        onClick: () => { setMenu(null); setCategory(menu.book); },
                    }, h('span', { className: 'ic' }, '🏷'), t('menuCategory')),
                    h('button', {
                        className: 'item',
                        onClick: () => { setMenu(null); setCover(menu.book); },
                    }, h('span', { className: 'ic' }, '🖼'), t('menuCover')),
                    h('div', { className: 'sep' }),
                    h('button', {
                        className: 'item danger',
                        onClick: () => { setMenu(null); confirmRemove(menu.book); },
                    }, h('span', { className: 'ic' }, '🗑'), t('menuDelete')))
                    : null,

                // ---- 章节列表 / 搜索跳转 ----
                panel ? h('div', { className: 'sr-panel' },
                    h('div', { className: 'top' },
                        h('span', { className: 't' },
                            `${panel.book.title} · ${panel.mode === 'toc' ? t('menuChapters') : t('menuSearch')}`),
                        h('button', { className: 'sr-btn ghost', onClick: () => setPanel(null) }, t('close'))),
                    panel.mode === 'search'
                        ? h('div', { className: 'searchbar' },
                            h('input', {
                                className: 'sr-in',
                                value: panel.query,
                                placeholder: t('searchPlaceholder'),
                                autoFocus: true,
                                onChange: (e) => setPanel((prev) => (prev ? { ...prev, query: e.target.value } : prev)),
                                onKeyDown: (e) => {
                                    if (e.key === 'Enter') runSearch();
                                },
                            }),
                            h('button', { className: 'sr-btn primary', onClick: runSearch }, t('searchGo')))
                        : null,
                    panelBody(panel, s, jumpToChapter, t))
                    : null,

                // 隐藏的文件选择器：换封面 / 换本地文件
                h('input', {
                    ref: coverRef,
                    type: 'file',
                    accept: 'image/*',
                    style: { display: 'none' },
                    onChange: onCoverPicked,
                }),
                h('input', {
                    ref: replaceRef,
                    type: 'file',
                    accept: '.txt,text/plain',
                    style: { display: 'none' },
                    onChange: onReplacePicked,
                }),

                h('div', { className: 'sr-sec' }, h('span', { className: 't' }, t('groupText'))),
                h('div', { className: 'sr-group' },
                    h(Row, {
                        label: t('fontFamily'),
                        hint: t('fontFamilyHint'),
                        control: h('div', { className: 'sr-seg' },
                            FONTS.map(([value, label]) => h('button', {
                                key: value || 'follow',
                                className: prefs.fontFamily === value ? 'on' : '',
                                onClick: () => setPrefs({ fontFamily: value }),
                            }, label))),
                    },
                        h('input', {
                            className: 'sr-in',
                            value: prefs.fontFamily,
                            placeholder: 'ui-serif, Georgia, serif',
                            spellCheck: false,
                            onChange: (e) => setPrefs({ fontFamily: e.target.value.slice(0, 120) }),
                        })),
                    h(Row, {
                        label: t('fontSize'),
                        value: prefs.fontSize > 0 ? `${prefs.fontSize}px` : t('fontPresetFollow'),
                        hint: t('fontSizeHint'),
                    }, h(Slider, {
                        min: 0, max: 40, step: 1, value: prefs.fontSize,
                        onChange: (value) => setPrefs({ fontSize: clamp(Math.round(value), 0, 40) }),
                    })),
                    h(Row, {
                        label: t('lineHeight'),
                        value: prefs.lineHeight > 0 ? prefs.lineHeight.toFixed(2) : t('fontPresetFollow'),
                    }, h(Slider, {
                        min: 0, max: 2.6, step: 0.05, value: prefs.lineHeight,
                        onChange: (value) => setPrefs({ lineHeight: clamp(value, 0, 2.6) }),
                    })),
                    h(Row, { label: t('fontWeight'), value: prefs.fontWeight > 0 ? String(prefs.fontWeight) : t('fontPresetFollow') },
                        h(Slider, {
                            min: 0, max: 800, step: 100, value: prefs.fontWeight,
                            onChange: (value) => setPrefs({ fontWeight: clamp(Math.round(value / 100) * 100, 0, 800) }),
                        })),
                    h(Row, { label: t('letterSpacing'), value: `${prefs.letterSpacing.toFixed(1)}px` },
                        h(Slider, {
                            min: -1, max: 4, step: 0.1, value: prefs.letterSpacing,
                            onChange: (value) => setPrefs({ letterSpacing: clamp(value, -1, 4) }),
                        })),
                    h(Row, { label: t('padding'), value: `${prefs.padding}px` },
                        h(Slider, {
                            min: 0, max: 48, step: 2, value: prefs.padding,
                            onChange: (value) => setPrefs({ padding: clamp(Math.round(value), 0, 48) }),
                        })),
                    h(Row, { label: t('indent'), value: `${prefs.indent.toFixed(1)}em` },
                        h(Slider, {
                            min: 0, max: 3, step: 0.1, value: prefs.indent,
                            onChange: (value) => setPrefs({ indent: clamp(value, 0, 3) }),
                        })),
                    h(Row, {
                        label: t('textAuto'),
                        hint: t('textAutoHint'),
                        control: h(Switch, { on: prefs.textAuto, onChange: () => setPrefs({ textAuto: !prefs.textAuto }) }),
                    }),
                    prefs.textAuto ? null : h(ColorField, {
                        label: t('textColor'),
                        hint: t('textColorHint'),
                        value: prefs.textColor,
                        onChange: (hex) => setPrefs({ textColor: hex }),
                    }),
                    h(Row, {
                        label: t('textShadow'),
                        hint: t('textShadowHint'),
                        control: h(Switch, { on: prefs.textShadow, onChange: () => setPrefs({ textShadow: !prefs.textShadow }) }),
                    })),

                h('div', { className: 'sr-sec' }, h('span', { className: 't' }, t('groupBackdrop'))),
                h('div', { className: 'sr-group' },
                    h(Row, { label: t('bgAlpha'), value: `${Math.round(prefs.alpha * 100)}%`, hint: t('bgAlphaHint') },
                        h(Slider, {
                            min: 0, max: 1, step: 0.01, value: prefs.alpha,
                            onChange: (value) => setPrefs({ alpha: clamp(value, 0, 1) }),
                        })),
                    h(ColorField, {
                        label: t('bgColor'),
                        hint: t('bgColorHint'),
                        value: prefs.bgColor,
                        onChange: (hex) => setPrefs({ bgColor: hex }),
                    })),

                h('div', { className: 'sr-sec' }, h('span', { className: 't' }, t('groupBehavior'))),
                h('div', { className: 'sr-group' },
                    h(Row, {
                        label: t('turnMode'),
                        hint: t('turnModeHint'),
                        control: h('div', { className: 'sr-seg' },
                            [['both', t('turnBoth')], ['wheel', t('turnWheel')]]
                                .map(([value, label]) => h('button', {
                                    key: value,
                                    className: prefs.turnMode === value ? 'on' : '',
                                    onClick: () => setPrefs({ turnMode: value }),
                                }, label))),
                    }),
                    h(Row, {
                        label: t('chrome'),
                        hint: t('chromeHint'),
                        control: h('div', { className: 'sr-seg' },
                            [['auto', t('chromeAuto')], ['always', t('chromeAlways')], ['never', t('chromeNever')]]
                                .map(([value, label]) => h('button', {
                                    key: value,
                                    className: prefs.chrome === value ? 'on' : '',
                                    onClick: () => setPrefs({ chrome: value }),
                                }, label))),
                    }),
                    h(Row, {
                        label: t('showTitle'),
                        hint: t('showTitleHint'),
                        control: h(Switch, { on: prefs.showTitle, onChange: () => setPrefs({ showTitle: !prefs.showTitle }) }),
                    }),
                    h(Row, {
                        label: t('autoTurn'),
                        value: prefs.autoTurn === 0 ? t('autoTurnOff') : `${prefs.autoTurn}s`,
                        hint: t('autoTurnHint'),
                    }, h(Slider, {
                        min: 0, max: 30, step: 1, value: prefs.autoTurn,
                        onChange: (value) => setPrefs({ autoTurn: clamp(Math.round(value), 0, 30) }),
                    })),
                    h(Row, { label: t('sizeW'), value: `${Math.round(prefs.w)}px` },
                        h(Slider, {
                            min: 200, max: 1200, step: 10, value: prefs.w,
                            onChange: (value) => setPrefs({ w: clamp(Math.round(value), 200, 1200) }),
                        })),
                    h(Row, { label: t('sizeH'), value: `${Math.round(prefs.h)}px` },
                        h(Slider, {
                            min: 100, max: 1000, step: 10, value: prefs.h,
                            onChange: (value) => setPrefs({ h: clamp(Math.round(value), 100, 1000) }),
                        }))),

                h('div', { className: 'sr-sec' }, h('span', { className: 't' }, t('privacy'))),
                h('div', { className: 'sr-group' },
                    h(Row, {
                        label: t('bossKey'),
                        hint: recording ? t('bossKeyRecording') : t('bossKeyHint'),
                        control: h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
                            h('button', {
                                type: 'button',
                                className: recording ? 'sr-key rec' : 'sr-key',
                                onClick: () => setRecording(true),
                                onKeyDown: recording ? onRecordKey : undefined,
                                onBlur: () => setRecording(false),
                                ref: (node) => {
                                    if (recording && node) node.focus();
                                },
                            }, recording ? t('bossKeyRecording') : comboLabel(prefs.bossKey)),
                            prefs.bossKey !== DEFAULT_BOSS_KEY
                                ? h('button', {
                                    className: 'sr-btn ghost',
                                    title: t('bossKeyReset'),
                                    onClick: () => setPrefs({ bossKey: DEFAULT_BOSS_KEY }),
                                }, '↺')
                                : null),
                    }),
                    h(Row, {
                        label: t('hideOnLeave'),
                        hint: t('hideOnLeaveHint'),
                        control: h(Switch, { on: prefs.hideOnLeave, onChange: () => setPrefs({ hideOnLeave: !prefs.hideOnLeave }) }),
                    }),
                    h(Row, {
                        label: t('resetAppearance'),
                        control: h('button', {
                            className: 'sr-btn ghost',
                            onClick: () => {
                                const base = defaultPrefs();
                                setPrefs({
                                    alpha: base.alpha,
                                    bgColor: base.bgColor,
                                    textAuto: base.textAuto,
                                    textColor: base.textColor,
                                    fontFamily: base.fontFamily,
                                    fontSize: base.fontSize,
                                    fontWeight: base.fontWeight,
                                    letterSpacing: base.letterSpacing,
                                    lineHeight: base.lineHeight,
                                    padding: base.padding,
                                    indent: base.indent,
                                    textShadow: base.textShadow,
                                    chrome: base.chrome,
                                });
                            },
                        }, '↺'),
                    })),
                h('div', { className: 'sr-head', style: { marginTop: '4px' } },
                    h('p', {}, t('readingHint'))));
        }

        // ---------------------------------------------------------------- 阅读浮层
        function ReaderOverlay() {
            useLocaleTick();
            const s = useStore();
            const pageRef = React.useRef(null);
            const prefs = s.prefs;
            const open = Boolean(prefs.open) && !s.hidden;
            const chapter = s.chapter;
            const book = s.books.find((item) => item.id === (s.activeBookId || (chapter && chapter.bookId))) || null;
            const chapterKey = chapter ? `${chapter.bookId}:${chapter.index}` : '';

            const [pages, setPages] = React.useState([]);
            const [pageIndex, setPageIndex] = React.useState(0);
            const [box, setBox] = React.useState({ w: 0, h: 0 });
            /** 换章时用来判断「这次分页后该落到第几页」 */
            const restoreRef = React.useRef(null);

            React.useEffect(() => {
                if (!state.ready) refresh();
            }, []);

            // 测量正文区域：窗口大小、工具栏显隐都会改变可用宽高。
            // 这里只在尺寸真的变了才 setState，避免拖拽时每一帧都触发重排。
            React.useEffect(() => {
                if (!open) return undefined;
                const node = pageRef.current;
                if (!node) return undefined;
                let frame = 0;
                const measure = () => {
                    if (frame) return;
                    frame = requestAnimationFrame(() => {
                        frame = 0;
                        const current = pageRef.current;
                        if (!current) return;
                        const cs = window.getComputedStyle(current);
                        const w = current.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
                        const hgt = current.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
                        setBox((prev) => (Math.abs(prev.w - w) < 2 && Math.abs(prev.h - hgt) < 2 ? prev : { w, h: hgt }));
                    });
                };
                measure();
                const observer = new ResizeObserver(measure);
                observer.observe(node);
                return () => {
                    if (frame) cancelAnimationFrame(frame);
                    observer.disconnect();
                };
            }, [open, prefs.w, prefs.h, prefs.chrome, prefs.padding]);

            const style = textStyle(prefs);
            const styleKey = [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing, style.lineHeight, style.indent].join('|');

            // 分页：章、尺寸或文字样式一变就重排（带缓存，同参数只算一次）
            React.useEffect(() => {
                if (!chapter || box.w <= 0 || box.h <= 0) {
                    setPages([]);
                    return;
                }
                const paragraphs = chapter.text.split(/\n+/).map((line) => line.trim()).filter((line) => line !== '');
                // 把真实的 .page 节点传进去：测量容器挂在它下面，
                // 才能继承到和渲染完全一致的 CSS 变量 / 字号 / 行高。
                const next = paginateCached(chapterKey, paragraphs, box.w, box.h, style, pageRef.current);
                setPages(next);

                // 落到哪一页：同一章就按保存的页码，否则按比例折算
                const saved = state.progress[chapter.bookId] || {};
                let target = 0;
                if (Number(saved.index) === chapter.index) {
                    if (Number(saved.pages) === next.length && Number.isFinite(Number(saved.page))) {
                        target = Number(saved.page);
                    } else if (Number.isFinite(Number(saved.ratio))) {
                        target = Math.round(Number(saved.ratio) * Math.max(0, next.length - 1));
                    }
                }
                target = clamp(target, 0, Math.max(0, next.length - 1));
                setPageIndex(target);
                restoreRef.current = { chapterKey, pages: next.length, page: target };
            }, [chapterKey, box.w, box.h, styleKey]);

            // 页数或页码确定后落一次进度（保证「下次接着读」拿到的是页号）
            React.useEffect(() => {
                if (!chapter || pages.length === 0) return;
                persistProgress(chapter.bookId, {
                    index: chapter.index,
                    page: pageIndex,
                    pages: pages.length,
                    ratio: pages.length > 1 ? pageIndex / (pages.length - 1) : 0,
                });
            }, [chapterKey, pages.length, pageIndex]);

            const turn = React.useCallback((delta) => {
                if (!chapter) return;
                const next = pageIndex + delta;
                if (next < 0) {
                    if (chapter.index > 0) goToChapter(chapter.index - 1, 'last');
                    return;
                }
                if (pages.length > 0 && next >= pages.length) {
                    if (chapter.index < chapter.total - 1) goToChapter(chapter.index + 1, 'first');
                    return;
                }
                setPageIndex(clamp(next, 0, Math.max(0, pages.length - 1)));
            }, [chapter, pages.length, pageIndex]);

            /** 翻章：目标页由分页完成后决定（first / last） */
            const pendingEdge = React.useRef(null);
            function goToChapter(index, edge) {
                pendingEdge.current = edge;
                loadChapter(state.activeBookId || (chapter && chapter.bookId), index);
            }

            // 翻章后如果要求落到末页，分页完成时补一次
            React.useEffect(() => {
                if (!pages.length || !pendingEdge.current) return;
                if (pendingEdge.current === 'last') setPageIndex(pages.length - 1);
                else if (pendingEdge.current === 'first') setPageIndex(0);
                pendingEdge.current = null;
            }, [pages]);

            // 自动翻页
            React.useEffect(() => {
                if (!open || prefs.autoTurn <= 0 || !chapter) return undefined;
                const timer = setInterval(() => turn(1), prefs.autoTurn * 1000);
                return () => clearInterval(timer);
            }, [open, prefs.autoTurn, chapterKey, pages.length, turn]);

            // 滚轮翻页：原生监听才能 preventDefault
            React.useEffect(() => {
                if (!open) return undefined;
                const node = pageRef.current;
                if (!node) return undefined;
                let acc = 0;
                let locked = 0;
                const onWheel = (event) => {
                    if (state.toc) return;
                    event.preventDefault();
                    const now = Date.now();
                    if (now < locked) return;
                    acc += event.deltaY;
                    if (Math.abs(acc) < 30) return;
                    const dir = acc > 0 ? 1 : -1;
                    acc = 0;
                    locked = now + 160;
                    turn(dir);
                };
                node.addEventListener('wheel', onWheel, { passive: false });
                return () => node.removeEventListener('wheel', onWheel);
            }, [open, turn]);

            const leaveTimer = React.useRef(0);
            React.useEffect(() => () => clearTimeout(leaveTimer.current), []);

            // 所有 hook 必须在提前 return 之前调用完，否则 React 会因为
            // 「条件式 hook」整棵组件树崩掉（上次就是这么把 slot entry 弄挂的）。
            /** 拖动松手不能顺带翻页，用这个标记兜住随后的 click */
            const suppressClickRef = React.useRef(false);
            const dragRef = React.useRef(null);
            /** 整个框的 DOM 节点：拖动时直接改它的样式，不经过 React */
            const rootRef = React.useRef(null);

            if (!open) return null;

            const onBodyClick = (event) => {
                if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                }
                if (prefs.turnMode !== 'both') return;
                if (state.toc) return;
                const target = event.target;
                if (target && typeof target.closest === 'function' && target.closest('button, input')) return;
                // 正在选字时不翻页
                if (typeof window.getSelection === 'function' && String(window.getSelection() || '') !== '') return;
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
                turn(ratio < 0.35 ? -1 : 1);
            };

            /**
             * 拖拽 / 缩放：**拖动过程中完全不碰 React state**。
             *
             * 之前每一帧都 setState，等于让整棵组件树（含分页、样式计算）每帧重渲染一次，
             * 拖动自然又卡又粘手。现在拖动时只改元素自身的 left/top/width/height，
             * 松手时写一次 state 落盘——浏览器只需要重新合成一层，跟手。
             *
             * 指针捕获保证甩出窗口也不断；整块框都能拖，不只是标题栏。
             */
            /**
             * 拖动窗口：**拖动过程中完全不碰 React state**。
             *
             * 之前每一帧都 setState，等于让整棵组件树（含分页、样式计算）每帧重渲染一次，
             * 拖动自然又卡又粘手。现在拖动时只改元素自身的 left/top，
             * 松手时写一次 state 落盘——浏览器只需要重新合成一层，跟手。
             *
             * 指针捕获保证甩出窗口也不断；整块框都能拖，不只是标题栏。
             *
             * 只做「移动」，不做「缩放」：宽高统一在设置里调。
             * （右下角曾经有个缩放把手，但它和整框拖动抢指针，实际拖不动还带个误导的提示，已去掉。）
             */
            const startDrag = (event) => {
                if (event.button !== 0 && event.pointerType === 'mouse') return;
                const target = event.target;
                // 按钮、输入框、目录不参与拖动
                if (target && typeof target.closest === 'function' && target.closest('button, input, .toc')) return;
                const box = rootRef.current;
                if (!box) return;
                event.preventDefault();
                event.stopPropagation();

                const node = event.currentTarget;
                const gesture = {
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: state.prefs.x,
                    originY: state.prefs.y,
                    pointerId: event.pointerId,
                    latest: null,
                    moved: false,
                };
                dragRef.current = gesture;
                try {
                    node.setPointerCapture(event.pointerId);
                } catch {
                    /* 不支持捕获时用 window 监听兜底 */
                }

                const onMove = (ev) => {
                    if (ev.pointerId !== gesture.pointerId) return;
                    const dx = ev.clientX - gesture.startX;
                    const dy = ev.clientY - gesture.startY;
                    // 4px 以内当作「点一下」，不算拖拽——这样整框可拖也不会误伤翻页
                    if (!gesture.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                    gesture.moved = true;
                    ev.preventDefault();
                    const vw = window.innerWidth || 1280;
                    const vh = window.innerHeight || 800;
                    const x = clamp(gesture.originX + dx, 0, Math.max(0, vw - 60));
                    const y = clamp(gesture.originY + dy, 0, Math.max(0, vh - 30));
                    gesture.latest = { x, y };
                    // 直接改样式：不经过 React，不需要等待重渲染
                    box.style.left = `${x}px`;
                    box.style.top = `${y}px`;
                };

                const finish = () => {
                    if (gesture.latest) {
                        // 松手才同步一次 state，让 React 认领最终位置
                        setState({ prefs: { ...state.prefs, ...gesture.latest } });
                    }
                    // 只有真的拖过才吞掉随后的 click；点一下仍然翻页
                    suppressClickRef.current = gesture.moved;
                    dragRef.current = null;
                    try {
                        node.releasePointerCapture(gesture.pointerId);
                    } catch {
                        /* 已释放 */
                    }
                    node.removeEventListener('pointermove', onMove);
                    node.removeEventListener('pointerup', finish);
                    node.removeEventListener('pointercancel', finish);
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', finish);
                    window.removeEventListener('pointercancel', finish);
                    persistPrefs();
                };

                node.addEventListener('pointermove', onMove);
                node.addEventListener('pointerup', finish);
                node.addEventListener('pointercancel', finish);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', finish);
                window.addEventListener('pointercancel', finish);
            };

            const beginDrag = startDrag;

            const onKeyDown = (event) => {
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    turn(-1);
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    turn(1);
                } else if (event.key === 'PageUp') {
                    event.preventDefault();
                    if (chapter) goToChapter(chapter.index - 1, 'first');
                } else if (event.key === 'PageDown') {
                    event.preventDefault();
                    if (chapter) goToChapter(chapter.index + 1, 'first');
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    hideReader();
                }
            };

            const onPointerEnter = () => clearTimeout(leaveTimer.current);
            const onPointerLeave = () => {
                if (!prefs.hideOnLeave) return;
                clearTimeout(leaveTimer.current);
                leaveTimer.current = setTimeout(() => hideReader(), 320);
            };

            const surface = surfaceStyle(prefs);
            const chromeClass = prefs.chrome === 'never' ? 'chrome-never' : prefs.chrome === 'always' ? 'chrome-always' : 'chrome-auto';
            const current = pages[pageIndex] || [];
            const totalPages = pages.length;

            return h('div', {
                ref: rootRef,
                className: `sr-win ${chromeClass}`,
                tabIndex: 0,
                onKeyDown,
                onPointerEnter,
                onPointerLeave,
                // 整个框都能拖：跟 uTools 摸鱼阅读一样，不用先找到标题栏
                onPointerDown: beginDrag,
                style: {
                    left: `${prefs.x}px`,
                    top: `${prefs.y}px`,
                    width: `${prefs.w}px`,
                    height: `${prefs.h}px`,
                    background: surface.background,
                    color: surface.color,
                    backdropFilter: surface.blur,
                    WebkitBackdropFilter: surface.blur,
                    fontFamily: prefs.fontFamily || FONT_TOKEN,
                },
            },
                h('div', { className: 'strip' }),

                h('div', { className: 'bar' },
                    h('span', { className: 'name' }, prefs.showTitle && book ? book.title : t('title')),
                    chapter ? h('span', { className: 'pos' },
                        totalPages > 0 ? `${pageIndex + 1}/${totalPages}` : `${chapter.index + 1}/${chapter.total}`) : null,
                    h('button', { title: t('toc'), onClick: () => setState({ toc: !state.toc }) }, '☰'),
                    h('button', { title: t('hide'), onClick: hideReader }, '×')),

                h('div', { className: 'body', onClick: onBodyClick },
                    h('div', {
                        className: 'page',
                        ref: pageRef,
                        style: {
                            fontSize: style.fontSize,
                            fontWeight: style.fontWeight,
                            letterSpacing: style.letterSpacing,
                            lineHeight: style.lineHeight,
                            padding: `${prefs.padding}px ${prefs.padding + 6}px`,
                            textShadow: surface.textShadow,
                        },
                    },
                        s.busy ? h('p', { className: 'ph' }, t('loading')) : null,
                        !chapter && !s.busy
                            ? h('p', { className: 'ph' }, s.books.length === 0 ? t('noBook') : t('loading'))
                            : null,
                        chapter && pageIndex === 0 ? h('h3', { style: { fontSize: '0.92em' } }, chapter.title) : null,
                        chapter && totalPages === 0 ? h('p', { className: 'ph' }, t('emptyChapter')) : null,
                        current.map((line, index) => h('p', {
                            key: index,
                            style: { textIndent: `${prefs.indent}em` },
                        }, line)))),

                s.toc && chapter
                    ? h('div', { className: 'toc' },
                        h('div', { className: 'top' },
                            h('span', { className: 't' }, t('toc')),
                            h('button', { className: 'sr-btn ghost', onClick: () => setState({ toc: false }) }, t('close'))),
                        h('div', { className: 'list' },
                            chapter.titles.map((title, index) => h('button', {
                                key: index,
                                className: index === chapter.index ? 'row on' : 'row',
                                title,
                                onClick: () => {
                                    setState({ toc: false });
                                    goToChapter(index, 'first');
                                },
                            }, `${index + 1}. ${title}`))))
                    : null,

                h('div', { className: 'foot' },
                    h('button', { title: t('prev'), onClick: () => turn(-1) }, '‹'),
                    h('button', { title: t('next'), onClick: () => turn(1) }, '›'),
                    chapter ? h('span', { className: 'pos' },
                        `${t('chapter', { index: chapter.index + 1, total: chapter.total })}${
                            totalPages > 0 ? ` · ${t('page', { index: pageIndex + 1, total: totalPages })}` : ''}`) : null));
        }

        function surfaceStyle(prefs) {
            const alpha = clamp(prefs.alpha, 0, 1);
            const { r, g, b } = hexToRgb(prefs.bgColor);
            const color = prefs.textAuto ? 'var(--dsw-alias-label-primary, inherit)' : prefs.textColor;
            const solid = alpha >= 0.5;
            let textShadow = 'none';
            if (prefs.textShadow) {
                textShadow = solid
                    ? '0 1px 1px rgba(0, 0, 0, .18)'
                    : '0 1px 2px rgba(0, 0, 0, .55), 0 0 5px rgba(255, 255, 255, .35)';
            }
            return {
                background: alpha <= 0.001 ? 'transparent' : `rgba(${r}, ${g}, ${b}, ${alpha})`,
                color,
                textShadow,
                blur: alpha > 0.12 ? 'blur(5px)' : 'none',
            };
        }

        // ---------------------------------------------------------------- 注册
        function apply(ctx) {
            ctx.effect(() => installStyles(ctx), 'stealthily-read: styles');

            const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
            if (!slots || typeof slots.register !== 'function') return;

            const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
            if (locale && typeof locale.register === 'function') {
                localeService = locale;
                ctx.effect(() => locale.register(NS, { zh, en }), 'stealthily-read: dictionaries');
                if (typeof locale.bind === 'function') tr = locale.bind(NS);
            }

            const wait = (name, register) => {
                if (typeof slots.inject !== 'function') return register();
                const dispose = slots.inject(name, register);
                return typeof dispose === 'function' ? dispose : () => {};
            };

            ctx.effect(() => wait('settings.section', () => slots.register({
                name: 'settings.section',
                id: NS,
                order: 62,
                label: () => t('nav'),
                locale: NS,
            }, SettingsPage)), 'stealthily-read: settings page');

            ctx.effect(() => wait('shell.overlay', () => slots.register({
                name: 'shell.overlay',
                id: NS,
                order: 30,
                locale: NS,
            }, ReaderOverlay)), 'stealthily-read: reader overlay');

            ctx.effect(() => {
                const onKey = (event) => {
                    if (comboMatches(parseCombo(state.prefs.bossKey), event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleHidden();
                        return;
                    }
                    if (!state.prefs.open || state.hidden || isEditable(event.target)) return;
                    if (event.key === 'PageDown') {
                        event.preventDefault();
                        goChapterBy(1);
                    } else if (event.key === 'PageUp') {
                        event.preventDefault();
                        goChapterBy(-1);
                    }
                };
                window.addEventListener('keydown', onKey, true);
                return () => window.removeEventListener('keydown', onKey, true);
            }, 'stealthily-read: hotkeys');
        }

        /** 全局快捷键翻章（阅读窗没聚焦时也能用） */
        function goChapterBy(delta) {
            const chapter = state.chapter;
            if (!chapter) return;
            const target = clamp(chapter.index + delta, 0, chapter.total - 1);
            if (target !== chapter.index) loadChapter(chapter.bookId, target);
        }

        exports.inject = ['slots', 'locale'];
        exports.apply = apply;
        return module.exports;
    },
});
