/**
 * Session 调试视图
 * 复用原 App.tsx 的调试界面，添加返回 Dashboard 的导航
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { sendCommand } from '../ws';
import PageMirror from '../panels/PageMirror';
import ConsolePanel from '../panels/ConsolePanel';
import NetworkPanel from '../panels/NetworkPanel';
import ElementsPanel from '../panels/ElementsPanel';
import StoragePanel from '../panels/StoragePanel';
import SourcesPanel from '../panels/SourcesPanel';
import TracePanel from '../panels/TracePanel';
import PerformancePanel from '../panels/PerformancePanel';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import { navigateToReplay } from '../router';
import { deviceDisplay } from '../ua';
import { useT, type MessageKey } from '../i18n';
import { copyToClipboard } from '../clipboard';
import { usePersistentState } from '../usePersistentState';
import type { ConsoleRecord } from '../store';

/** 「复制给 AI 修复」提示词里最多列出的错误条数（最新的在前） */
const MCP_PROMPT_MAX_ERRORS = 5;
const MCP_PROMPT_MESSAGE_MAX = 200;

/** 把一条面板错误记录压成一行：[kind] message — 首个栈帧，供 AI 对照 remotr_get_errors 的结果 */
function describeErrorRecord(r: ConsoleRecord): string {
  const kind = r.type === 'page-error' ? (r.pageError?.isPromiseRejection ? 'unhandled-rejection' : 'page-error') : 'console-error';
  const rawMessage = r.type === 'page-error' ? r.pageError?.message ?? '' : (r.entry?.args ?? []).map((a) => a.display).join(' ');
  const message = rawMessage.length > MCP_PROMPT_MESSAGE_MAX ? `${rawMessage.slice(0, MCP_PROMPT_MESSAGE_MAX)}…` : rawMessage;
  const stack = r.type === 'page-error' ? r.pageError?.stack : r.entry?.stack;
  const frame = stack
    ?.split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at '));
  return `[${kind}] ${message}${frame ? ` — ${frame}` : ''}`;
}

type Tab = 'console' | 'network' | 'elements' | 'storage' | 'sources' | 'trace' | 'performance';

const DEFAULT_TABS: Tab[] = ['elements', 'console', 'trace', 'performance', 'sources', 'network', 'storage'];

/**
 * 把持久化的标签顺序规整到当前版本的标签集合：
 * 未知/已移除的丢弃，新增的追加到末尾——升级后旧配置不会让标签消失。
 */
function normalizeTabOrder(saved: unknown): Tab[] {
  const known = new Set<string>(DEFAULT_TABS);
  const kept = Array.isArray(saved)
    ? (saved as unknown[]).filter((t): t is Tab => typeof t === 'string' && known.has(t))
    : [];
  const seen = new Set(kept);
  return [...kept, ...DEFAULT_TABS.filter((t) => !seen.has(t))];
}

/** 把 from 移到 to 当前所在的位置（其余顺延），与 DevTools / 浏览器标签拖动一致 */
function moveTab(order: Tab[], from: Tab, to: Tab): Tab[] {
  const next = order.filter((t) => t !== from);
  next.splice(order.indexOf(to), 0, from);
  return next;
}

const STATUS_COLORS: Record<string, string> = {
  connected: '#4caf50',
  connecting: '#ffcc02',
  disconnected: '#f44747',
};

interface SessionViewProps {
  room: string;
  deviceId: string;
  pageId: string;
  onBack: () => void;
}

export default function SessionView({ room, deviceId, pageId, onBack }: SessionViewProps): React.ReactElement {
  const connStatus = useStore((s) => s.connStatus);
  const targetOnline = useStore((s) => s.targetOnline);
  const systemInfo = useStore((s) => s.systemInfo);
  const sourceView = useStore((s) => s.sourceView);
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>('elements');
  const [savedTabOrder, setSavedTabOrder] = usePersistentState<Tab[]>('session.tabOrder', DEFAULT_TABS);
  const tabs = normalizeTabOrder(savedTabOrder);
  /** 正在拖动的标签；用 ref 而非 state——拖动过程不需要触发渲染 */
  const dragTabRef = useRef<Tab | null>(null);
  /** 当前悬停的放置目标，用于高亮 */
  const [dropTarget, setDropTarget] = useState<Tab | null>(null);
  const [reloadPending, setReloadPending] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const [leftWidth, setLeftWidth] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleReload = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    const hard = event.shiftKey;
    setReloadPending(true);
    setReloadError(null);
    useStore.getState().resetSessionDataPreserveConnection();

    try {
      const reply = await sendCommand('page.reload', { hard });
      if (reply.error) {
        setReloadError(reply.error);
      }
    } catch (err) {
      setReloadError(err instanceof Error ? err.message : 'Reload failed');
    } finally {
      setReloadPending(false);
    }
  }, []);

  // 复制 MCP 对接所需内容 + 提示词，粘贴给 Claude Code 即可定位并修复本页报错。
  // 配置片段刻意不带 ?room=：房间名作为工具入参逐次传入，换房间不必再改 mcp.json。
  // 面板对外叫 project（MCP 工具同时接受 project/room）。
  // since = 面板当前可见记录的起点：页面刷新/清空控制台之后的第一条。AI 侧按 since 过滤，
  // 上一轮已修好的旧错误（仍留在服务端 backlog 里）就不会在新会话里被再"修"一遍。
  const handleCopyMcp = useCallback(async () => {
    const server = window.location.origin;
    const { systemInfo, consoleRecords } = useStore.getState();
    const url = systemInfo?.url;
    const since = consoleRecords.length > 0 ? consoleRecords[0].timestamp : Date.now();
    const errors = consoleRecords.filter((r) => r.type === 'page-error' || (r.type === 'console' && r.level === 'error'));
    const shown = errors.slice(-MCP_PROMPT_MAX_ERRORS).reverse();
    const lines = [
      t('mcp.promptIntro'),
      '',
      `- server: ${server}`,
      `- project: ${room}`,
      `- deviceId: ${deviceId}`,
      `- pageId: ${pageId}`,
      ...(url ? [`- url: ${url}`] : []),
      `- since: ${since} (${new Date(since).toISOString()})`,
      '',
      ...(shown.length > 0
        ? [
            t('mcp.promptErrors', { shown: shown.length, total: errors.length }),
            ...shown.map((r, i) => `${i + 1}. ${describeErrorRecord(r)}`),
          ]
        : [t('mcp.promptNoErrors')]),
      '',
      t('mcp.promptSteps'),
      '',
      t('mcp.promptConfigNote'),
      '```json',
      `"remotr": { "type": "http", "url": "${server}/mcp" }`,
      '```',
      t('mcp.promptConfigStable'),
    ];
    await copyToClipboard(lines.join('\n'));
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 1500);
  }, [room, deviceId, pageId, t]);

  // 顶栏 URL 因空间被截断，hover 只能看不能选；点击直接复制完整值
  const handleCopyUrl = useCallback(async () => {
    const url = useStore.getState().systemInfo?.url;
    if (!url) return;
    await copyToClipboard(url);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1500);
  }, []);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.max(20, Math.min(80, pct)));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Console 还原后点击源码位置 → 自动切到 Sources 标签
  useEffect(() => {
    if (sourceView) setActiveTab('sources');
  }, [sourceView]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <button onClick={onBack} title={t('session.backTitle')}>
          {t('session.back')}
        </button>

        <button
          onClick={handleReload}
          disabled={connStatus !== 'connected' || reloadPending || targetOnline === false}
          title={
            targetOnline === false
              ? t('session.reloadOfflineTitle')
              : reloadPending
                ? t('session.reloading')
                : t('session.reloadTitle')
          }
        >
          {reloadPending ? '⟳...' : t('session.reload')}
        </button>

        <button onClick={() => navigateToReplay(room, deviceId, pageId)} title={t('replay.title')}>
          {t('replay.entry')}
        </button>

        <button onClick={handleCopyMcp} title={t('mcp.copyTitle')}>
          {mcpCopied ? t('mcp.copied') : t('mcp.copy')}
        </button>

        <ThemeToggle />
        <LanguageToggle />

        {reloadError && <span style={{ color: 'var(--accent-red)' }}>⚠ {reloadError}</span>}

        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: STATUS_COLORS[connStatus] ?? '#858585',
              display: 'inline-block',
            }}
          />
          {t(`status.${connStatus}` as MessageKey)}
        </span>

        {/* 目标设备真实在线状态（与上面的面板自身连接状态是两回事） */}
        {targetOnline !== null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: targetOnline ? '#4caf50' : '#f44747',
                display: 'inline-block',
              }}
            />
            <span style={{ color: targetOnline ? undefined : 'var(--accent-red)' }}>
              {targetOnline ? t('session.targetOnline') : t('session.targetOffline')}
            </span>
          </span>
        )}

        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span title={`${t('dashboard.project')} ${room}`} style={{ color: 'var(--text-muted)' }}>
          {room}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span title={`${t('session.deviceLabel')} ${deviceId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          📱 {deviceDisplay(deviceId, systemInfo?.ua)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span title={`${t('session.pageLabel')} ${pageId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          📄 {pageId.slice(0, 12)}
        </span>

        {systemInfo && (
          <>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span
              onClick={handleCopyUrl}
              title={`${systemInfo.url}\n\n${t('session.copyUrlTitle')}`}
              style={{
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                color: urlCopied ? 'var(--accent-green)' : undefined,
              }}
            >
              {urlCopied ? t('session.urlCopied') : systemInfo.url}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span>
              {systemInfo.viewport.width}×{systemInfo.viewport.height}
            </span>
            {systemInfo.framework && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                <span style={{ color: 'var(--accent-purple)' }}>{systemInfo.framework}</span>
              </>
            )}
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span
              title={systemInfo.ua}
              style={{
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-muted)',
              }}
            >
              {systemInfo.ua}
            </span>
          </>
        )}
      </div>

      {/* 目标离线时，所有命令类操作（eval / storage / elements / trace / reload）都会被
          服务端以 "Target session … is offline" 拒掉。这里用一条横幅统一说明，
          比在每个面板各自置灰更诚实——面板里的数据来自 backlog 回放，看着是活的。 */}
      {targetOnline === false && (
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--accent-red)',
            color: 'var(--accent-red)',
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          ⚠ {t('session.offlineBanner')}
        </div>
      )}

      <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            width: `${leftWidth}%`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-tertiary)',
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              flexShrink: 0,
            }}
          >
            {t('session.pageMirror')}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <PageMirror key={`${deviceId}:${pageId}`} />
          </div>
        </div>

        <div
          onMouseDown={onMouseDown}
          style={{
            width: 4,
            background: 'var(--border)',
            cursor: 'col-resize',
            flexShrink: 0,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border)')}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab}
                draggable
                onClick={() => setActiveTab(tab)}
                onDragStart={(e) => {
                  dragTabRef.current = tab;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tab);
                }}
                onDragOver={(e) => {
                  const from = dragTabRef.current;
                  if (!from || from === tab) return;
                  e.preventDefault(); // 允许放置
                  e.dataTransfer.dropEffect = 'move';
                  if (dropTarget !== tab) setDropTarget(tab);
                }}
                onDragLeave={() => {
                  if (dropTarget === tab) setDropTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragTabRef.current;
                  dragTabRef.current = null;
                  setDropTarget(null);
                  if (from && from !== tab) setSavedTabOrder(moveTab(tabs, from, tab));
                }}
                onDragEnd={() => {
                  dragTabRef.current = null;
                  setDropTarget(null);
                }}
                title={t('session.tabDragHint')}
                style={{
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  borderRadius: 0,
                  background: activeTab === tab ? 'var(--bg-primary)' : 'transparent',
                  color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                  padding: '6px 14px',
                  cursor: 'pointer',
                  fontSize: 12,
                  textTransform: 'capitalize',
                  // 放置目标：左侧竖线提示落点
                  boxShadow: dropTarget === tab ? 'inset 2px 0 0 var(--accent-blue)' : undefined,
                }}
              >
                {t(`tab.${tab}` as MessageKey)}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {tabs.some((tab, i) => tab !== DEFAULT_TABS[i]) && (
              <button
                onClick={() => setSavedTabOrder(DEFAULT_TABS)}
                title={t('session.tabResetOrder')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                ↺
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'console' && <ConsolePanel />}
            {activeTab === 'trace' && <TracePanel />}
            {activeTab === 'performance' && <PerformancePanel />}
            {activeTab === 'sources' && <SourcesPanel />}
            {activeTab === 'network' && <NetworkPanel />}
            {activeTab === 'elements' && <ElementsPanel />}
            {activeTab === 'storage' && <StoragePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
