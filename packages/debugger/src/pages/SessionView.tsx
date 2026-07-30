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

type Tab = 'console' | 'network' | 'elements' | 'storage' | 'sources' | 'trace' | 'performance';

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
  const systemInfo = useStore((s) => s.systemInfo);
  const sourceView = useStore((s) => s.sourceView);
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>('elements');
  const [reloadPending, setReloadPending] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [mcpCopied, setMcpCopied] = useState(false);

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

  // 复制 MCP 对接所需内容 + 提示词，粘贴给 Claude Code 即可定位并修复本页报错
  const handleCopyMcp = useCallback(async () => {
    const server = window.location.origin;
    const url = useStore.getState().systemInfo?.url;
    const lines = [
      t('mcp.promptIntro'),
      '',
      `- server: ${server}`,
      `- room: ${room}`,
      `- deviceId: ${deviceId}`,
      `- pageId: ${pageId}`,
      ...(url ? [`- url: ${url}`] : []),
      '',
      t('mcp.promptSteps'),
      '',
      t('mcp.promptConfigNote'),
      '```json',
      `"remotr": { "type": "http", "url": "${server}/mcp?room=${encodeURIComponent(room)}" }`,
      '```',
    ];
    await copyToClipboard(lines.join('\n'));
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 1500);
  }, [room, deviceId, pageId, t]);

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

  const tabs: Tab[] = ['elements', 'console', 'trace', 'performance', 'sources', 'network', 'storage'];

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
          disabled={connStatus !== 'connected' || reloadPending}
          title={reloadPending ? t('session.reloading') : t('session.reloadTitle')}
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

        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span title={`${t('dashboard.room')} ${room}`} style={{ color: 'var(--text-muted)' }}>
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
              title={systemInfo.url}
              style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {systemInfo.url}
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
                onClick={() => setActiveTab(tab)}
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
                }}
              >
                {t(`tab.${tab}` as MessageKey)}
              </button>
            ))}
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
