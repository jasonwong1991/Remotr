/**
 * Session 调试视图
 * 复用原 App.tsx 的调试界面，添加返回 Dashboard 的导航
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { reconnect, setTargetSession } from '../ws';
import PageMirror from '../panels/PageMirror';
import ConsolePanel from '../panels/ConsolePanel';
import NetworkPanel from '../panels/NetworkPanel';
import ElementsPanel from '../panels/ElementsPanel';
import StoragePanel from '../panels/StoragePanel';

type Tab = 'console' | 'network' | 'elements' | 'storage';

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
  const [activeTab, setActiveTab] = useState<Tab>('console');

  const [leftWidth, setLeftWidth] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTargetSession({ deviceId, pageId });
    reconnect();
    return () => {
      setTargetSession(null);
    };
  }, [deviceId, pageId]);

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

  const tabs: Tab[] = ['console', 'network', 'elements', 'storage'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* Top status bar */}
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
        <button
          onClick={onBack}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            padding: '2px 8px',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
          }}
          title="返回 Dashboard"
        >
          ← Dashboard
        </button>

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
          {connStatus}
        </span>

        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span title={`Room: ${room}`} style={{ color: 'var(--text-muted)' }}>
          {room}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span title={`Device: ${deviceId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          📱 {deviceId.slice(0, 12)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span title={`Page: ${pageId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
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

      {/* Main split layout */}
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
            Page Mirror
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <PageMirror />
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
                {tab}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'console' && <ConsolePanel />}
            {activeTab === 'network' && <NetworkPanel />}
            {activeTab === 'elements' && <ElementsPanel />}
            {activeTab === 'storage' && <StoragePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
