import { create } from 'zustand';

export type Locale = 'en' | 'zh';

const STORAGE_KEY = 'remotr.locale';

/**
 * English source strings — the single source of truth for message keys.
 * `zh` below is typed as `Record<MessageKey, string>`, so the compiler rejects
 * any missing translation. Add a key here and TypeScript forces a zh entry.
 *
 * Placeholders use `{name}` and are filled via the `vars` argument of `t()`.
 */
const en = {
  // ── common ──────────────────────────────────────────────
  'common.retry': 'Retry',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.run': 'Run',
  'common.clear': 'Clear',
  'common.refresh': 'Refresh',
  'common.clearAll': 'Clear All',
  // ── connection / session status ─────────────────────────
  'status.connecting': 'connecting',
  'status.connected': 'connected',
  'status.disconnected': 'disconnected',
  'status.online': 'online',
  'status.offline': 'offline',
  // ── theme toggle ────────────────────────────────────────
  'theme.switchTo': 'Switch to {theme} theme',
  'theme.dark': 'dark',
  'theme.light': 'light',
  'theme.darkLabel': '☾ Dark',
  'theme.lightLabel': '☀ Light',
  // ── language toggle ─────────────────────────────────────
  'lang.toggleTitle': 'Switch to 中文',
  // ── dashboard ───────────────────────────────────────────
  'dashboard.title': '🔍 Remotr Dashboard',
  'dashboard.room': 'Room:',
  'dashboard.online': '● {count} online',
  'dashboard.total': '/ {count} total',
  'dashboard.groupByIdentity': 'Group by identity',
  'dashboard.groupByDevice': 'Group by device',
  'dashboard.pages': '{count} pages',
  'dashboard.noSessions': 'No active sessions',
  'dashboard.connecting': 'Connecting...',
  'dashboard.injectHint': 'Inject the code below into your page to view it here:',
  'dashboard.supportsPrefix': 'Supports',
  'dashboard.supportsSuffix': 'to group by user',
  'dashboard.noTitle': '(no title)',
  // ── relative time ───────────────────────────────────────
  'time.justNow': 'just now',
  'time.secondsAgo': '{n}s ago',
  'time.minutesAgo': '{n}m ago',
  'time.hoursAgo': '{n}h ago',
  // ── session view ────────────────────────────────────────
  'session.backTitle': 'Back to Dashboard',
  'session.back': '← Dashboard',
  'session.deviceLabel': 'Device:',
  'session.pageLabel': 'Page:',
  'session.reloading': 'Reloading...',
  'session.reloadTitle': 'Reload remote page (Shift+Click for hard reload)',
  'session.reload': '⟳ Reload',
  'session.pageMirror': 'Page Mirror',
  // ── main tabs (SessionView) ─────────────────────────────
  'tab.console': 'console',
  'tab.network': 'network',
  'tab.elements': 'elements',
  'tab.storage': 'storage',
  // ── elements sub-tabs (ElementsPanel) ───────────────────
  'tab.styles': 'Styles',
  'tab.computed': 'Computed',
  'tab.boxModel': 'Box Model',
  // ── console panel ───────────────────────────────────────
  'console.clearTitle': 'Clear console',
  'console.filter': 'Filter…',
  'console.evalPlaceholder': 'Evaluate JavaScript expression…',
  'console.stack': 'stack',
  // ── network panel ───────────────────────────────────────
  'network.filterUrl': 'Filter by URL…',
  'network.requests': '{count} requests',
  'network.name': 'Name',
  'network.method': 'Method',
  'network.status': 'Status',
  'network.type': 'Type',
  'network.duration': 'Duration',
  'network.url': 'URL',
  'network.mime': 'MIME',
  'network.pending': 'pending',
  'network.noBody': '(no body)',
  'network.noData': 'No data',
  'network.error': 'Error: {error}',
  'network.errorType.cors': 'CORS',
  'network.errorType.network': 'Network',
  'network.errorType.timeout': 'Timeout',
  'network.errorType.abort': 'Aborted',
  'network.errorType.unknown': 'Error',
  'network.fromCache': 'cached',
  'network.timing': 'Timing',
  'network.timing.dns': 'DNS lookup',
  'network.timing.tcp': 'TCP connect',
  'network.timing.request': 'Request sent',
  'network.timing.response': 'Response received',
  'network.timing.transferSize': 'Transfer size',
  'network.timing.encodedSize': 'Encoded size',
  'network.timing.decodedSize': 'Decoded size',
  'network.statusEstimated': '(estimated)',
  'network.tab.general': 'general',
  'network.tab.req-headers': 'req headers',
  'network.tab.res-headers': 'res headers',
  'network.tab.req-body': 'req body',
  'network.tab.res-body': 'res body',
  'network.tab.timing': 'timing',
  // ── storage panel ───────────────────────────────────────
  'storage.key': 'Key',
  'storage.value': 'Value',
  'storage.actions': 'Actions',
  'storage.empty': 'Empty',
  'storage.local': 'Local Storage',
  'storage.session': 'Session Storage',
  'storage.cookies': 'Cookies',
  // ── elements tree + context menu ────────────────────────
  'tree.waiting': 'Waiting for DOM snapshot…',
  'menu.copySelector': 'Copy selector',
  'menu.copyOuterHtml': 'Copy outerHTML',
  'menu.copyXpath': 'Copy XPath',
  'menu.copyJsPath': 'Copy JS path',
  'menu.forceState': 'Force state',
  'menu.hideElement': 'Hide element',
  'menu.editHtml': 'Edit HTML',
  'menu.deleteElement': 'Delete element',
  'menu.scrollIntoView': 'Scroll into view',
  // ── styles pane (editable) ──────────────────────────────
  'styles.selectElement': 'Select an element to inspect styles.',
  'styles.loading': 'Loading styles...',
  'styles.failed': 'Failed to load styles.',
  'styles.noMatched': 'No matched styles',
  'styles.saving': 'Saving...',
  'styles.force': 'force',
  'styles.inline': 'inline',
  'styles.clickToEdit': 'Click to edit (applies as inline style)',
  // ── computed styles pane ────────────────────────────────
  'computed.selectElement': 'Select an element to inspect computed styles.',
  'computed.noStyles': 'No styles found',
  'computed.filter': 'Filter by property or value…',
  'computed.doubleClickApply': 'Double-click value to apply as inline style',
  'computed.stylesCount': '{filtered} / {total} styles',
  'computed.noMatchFilter': 'No styles match filter',
  'computed.property': 'Property',
  'computed.value': 'Value',
  // ── rules pane ──────────────────────────────────────────
  'rules.selectElement': 'Select an element to inspect matched rules.',
  'rules.loading': 'Loading rules...',
  'rules.failed': 'Failed to load matched rules.',
  'rules.noMatched': 'No matched rules',
  // ── box model pane ──────────────────────────────────────
  'boxModel.loading': 'Loading box model...',
  // ── element picker ──────────────────────────────────────
  'picker.processing': 'Processing...',
  'picker.stop': 'Stop picking element (Esc)',
  'picker.pickTitle': 'Pick an element from the page',
  'picker.picking': 'Picking...',
  'picker.pick': 'Pick',
  // ── html edit modal ─────────────────────────────────────
  'htmlEdit.title': 'Edit HTML',
  'htmlEdit.hint': '⌘/Ctrl + Enter to save · Esc to cancel',
  // ── page mirror ─────────────────────────────────────────
  'mirror.waiting': 'Waiting for page snapshot…',
  // ── replay ──────────────────────────────────────────────
  'replay.entry': '📼 Replay',
  'replay.title': '📼 Replay',
  'replay.backTitle': 'Back to Dashboard',
  'replay.back': '← Dashboard',
  'replay.sessions': 'Recorded sessions',
  'replay.segments': 'Segments',
  'replay.noRecordings': 'No recordings for today',
  'replay.disabled': 'Recording is disabled on the server',
  'replay.selectSession': 'Select a session on the left',
  'replay.selectSegment': 'Select a segment to play',
  'replay.notPlayable': 'This segment has no full snapshot and cannot be replayed',
  'replay.loading': 'Loading…',
  'replay.play': '▶ Play',
  'replay.pause': '❚❚ Pause',
  'replay.restart': '↺ Restart',
  'replay.speed': 'Speed',
  'replay.segmentCount': '{count} segments',
  'replay.anonymous': '(anonymous)',
} as const;

export type MessageKey = keyof typeof en;

/** Chinese translations. Typed against `en`, so every key must be present. */
const zh: Record<MessageKey, string> = {
  'common.retry': '重试',
  'common.save': '保存',
  'common.cancel': '取消',
  'common.run': '运行',
  'common.clear': '清空',
  'common.refresh': '刷新',
  'common.clearAll': '全部清空',
  'status.connecting': '连接中',
  'status.connected': '已连接',
  'status.disconnected': '已断开',
  'status.online': '在线',
  'status.offline': '离线',
  'theme.switchTo': '切换到{theme}主题',
  'theme.dark': '深色',
  'theme.light': '浅色',
  'theme.darkLabel': '☾ 深色',
  'theme.lightLabel': '☀ 浅色',
  'lang.toggleTitle': 'Switch to English',
  'dashboard.title': '🔍 Remotr 控制台',
  'dashboard.room': '房间：',
  'dashboard.online': '● {count} 在线',
  'dashboard.total': '/ 共 {count}',
  'dashboard.groupByIdentity': '按身份分组',
  'dashboard.groupByDevice': '按设备分组',
  'dashboard.pages': '{count} 个页面',
  'dashboard.noSessions': '暂无活跃 Session',
  'dashboard.connecting': '正在连接...',
  'dashboard.injectHint': '在你的页面中注入下方代码，即可在此查看：',
  'dashboard.supportsPrefix': '支持',
  'dashboard.supportsSuffix': '按用户分组',
  'dashboard.noTitle': '(无标题)',
  'time.justNow': '刚刚',
  'time.secondsAgo': '{n}秒前',
  'time.minutesAgo': '{n}分钟前',
  'time.hoursAgo': '{n}小时前',
  'session.backTitle': '返回控制台',
  'session.back': '← 控制台',
  'session.deviceLabel': '设备：',
  'session.pageLabel': '页面：',
  'session.reloading': '重新加载中...',
  'session.reloadTitle': '重新加载远程页面（Shift+点击强制刷新）',
  'session.reload': '⟳ 重新加载',
  'session.pageMirror': '页面镜像',
  'tab.console': '控制台',
  'tab.network': '网络',
  'tab.elements': '元素',
  'tab.storage': '存储',
  'tab.styles': '样式',
  'tab.computed': '计算后',
  'tab.boxModel': '盒模型',
  'console.clearTitle': '清空控制台',
  'console.filter': '筛选…',
  'console.evalPlaceholder': '执行 JavaScript 表达式…',
  'console.stack': '堆栈',
  'network.filterUrl': '按 URL 筛选…',
  'network.requests': '{count} 个请求',
  'network.name': '名称',
  'network.method': '方法',
  'network.status': '状态',
  'network.type': '类型',
  'network.duration': '耗时',
  'network.url': 'URL',
  'network.mime': 'MIME',
  'network.pending': '等待中',
  'network.noBody': '(无正文)',
  'network.noData': '无数据',
  'network.error': '错误：{error}',
  'network.errorType.cors': '跨域',
  'network.errorType.network': '网络',
  'network.errorType.timeout': '超时',
  'network.errorType.abort': '已取消',
  'network.errorType.unknown': '错误',
  'network.fromCache': '缓存',
  'network.timing': '时序',
  'network.timing.dns': 'DNS 查询',
  'network.timing.tcp': 'TCP 连接',
  'network.timing.request': '请求发送',
  'network.timing.response': '响应接收',
  'network.timing.transferSize': '传输大小',
  'network.timing.encodedSize': '编码大小',
  'network.timing.decodedSize': '解码大小',
  'network.statusEstimated': '（推断）',
  'network.tab.general': '概要',
  'network.tab.req-headers': '请求头',
  'network.tab.res-headers': '响应头',
  'network.tab.req-body': '请求正文',
  'network.tab.res-body': '响应正文',
  'network.tab.timing': '时序',
  'storage.key': '键',
  'storage.value': '值',
  'storage.actions': '操作',
  'storage.empty': '空',
  'storage.local': '本地存储',
  'storage.session': '会话存储',
  'storage.cookies': 'Cookies',
  'tree.waiting': '等待 DOM 快照…',
  'menu.copySelector': '复制 selector',
  'menu.copyOuterHtml': '复制 outerHTML',
  'menu.copyXpath': '复制 XPath',
  'menu.copyJsPath': '复制 JS path',
  'menu.forceState': '强制状态',
  'menu.hideElement': '隐藏元素',
  'menu.editHtml': '编辑 HTML',
  'menu.deleteElement': '删除元素',
  'menu.scrollIntoView': '滚动到视图',
  'styles.selectElement': '选择一个元素以查看样式。',
  'styles.loading': '正在加载样式...',
  'styles.failed': '加载样式失败。',
  'styles.noMatched': '无匹配样式',
  'styles.saving': '正在保存...',
  'styles.force': '强制',
  'styles.inline': '内联',
  'styles.clickToEdit': '点击编辑（作为内联样式应用）',
  'computed.selectElement': '选择一个元素以查看计算样式。',
  'computed.noStyles': '未找到样式',
  'computed.filter': '按属性或值筛选…',
  'computed.doubleClickApply': '双击值以作为内联样式应用',
  'computed.stylesCount': '{filtered} / {total} 条样式',
  'computed.noMatchFilter': '无样式匹配筛选',
  'computed.property': '属性',
  'computed.value': '值',
  'rules.selectElement': '选择一个元素以查看匹配规则。',
  'rules.loading': '正在加载规则...',
  'rules.failed': '加载匹配规则失败。',
  'rules.noMatched': '无匹配规则',
  'boxModel.loading': '正在加载盒模型...',
  'picker.processing': '处理中...',
  'picker.stop': '停止选择元素 (Esc)',
  'picker.pickTitle': '从页面中选择元素',
  'picker.picking': '选择中...',
  'picker.pick': '选择',
  'htmlEdit.title': '编辑 HTML',
  'htmlEdit.hint': '⌘/Ctrl + Enter 保存 · Esc 取消',
  'mirror.waiting': '等待页面快照…',
  'replay.entry': '📼 回放',
  'replay.title': '📼 回放',
  'replay.backTitle': '返回控制台',
  'replay.back': '← 控制台',
  'replay.sessions': '录制会话',
  'replay.segments': '录制段',
  'replay.noRecordings': '今天暂无录制',
  'replay.disabled': '服务端未开启录制',
  'replay.selectSession': '请在左侧选择一个会话',
  'replay.selectSegment': '选择一个录制段播放',
  'replay.notPlayable': '该段缺少全量快照，无法回放',
  'replay.loading': '加载中…',
  'replay.play': '▶ 播放',
  'replay.pause': '❚❚ 暂停',
  'replay.restart': '↺ 重播',
  'replay.speed': '速度',
  'replay.segmentCount': '{count} 段',
  'replay.anonymous': '(匿名)',
};

const dict: Record<Locale, Record<MessageKey, string>> = { en, zh };

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

function getStoredLocale(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'zh' || stored === 'en' ? stored : 'en'; // default: English
}

/** Reactive locale store. Components subscribing via `useT()` re-render on change. */
export const useLocale = create<LocaleState>((set) => ({
  locale: getStoredLocale(),
  setLocale: (locale) => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    set({ locale });
  },
}));

/** Apply the persisted locale to <html lang> on startup (default English). */
export function initializeLocale(): void {
  const { locale } = useLocale.getState();
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

export type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Non-reactive translate, for use outside React render (falls back to English). */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dict[locale][key] ?? dict.en[key] ?? key;
  return interpolate(template, vars);
}

/** React hook returning a `t` bound to the current locale; re-renders on switch. */
export function useT(): TFunc {
  const locale = useLocale((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
