/**
 * Dashboard 页面
 * 展示所有活跃的设备/页面/身份，支持分组与跳转到调试页面
 */

import React, { useEffect, useState, useMemo } from 'react';
import type { SessionSnapshot, DashboardSessionsEvent } from '@remotr/shared';
import { decodeFrame } from '@remotr/shared';
import { navigateToSession } from '../router';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import { useT, type MessageKey, type TFunc } from '../i18n';

type GroupBy = 'identity' | 'device';

interface DashboardProps {
  room: string;
}

export default function Dashboard({ room }: DashboardProps): React.ReactElement {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [groupBy, setGroupBy] = useState<GroupBy>('identity');

  useEffect(() => {
    const { protocol, host } = window.location;
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProto}//${host}/ws?room=${encodeURIComponent(room)}&role=debugger`;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      setConnStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => setConnStatus('connected');

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return;
        const frame = decodeFrame(evt.data);
        if (!frame || frame.kind !== 'msg') return;
        if (frame.envelope.method === 'dashboard.sessions') {
          const data = frame.envelope.data as DashboardSessionsEvent;
          setSessions(data.sessions);
        }
      };

      ws.onclose = () => {
        setConnStatus('disconnected');
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [room]);

  // 分组数据
  const groups = useMemo(() => {
    if (groupBy === 'identity') {
      const map = new Map<string, Map<string, SessionSnapshot[]>>();
      for (const s of sessions) {
        const id = s.identity || 'anonymous';
        const dev = s.session.deviceId;
        if (!map.has(id)) map.set(id, new Map());
        const devMap = map.get(id)!;
        if (!devMap.has(dev)) devMap.set(dev, []);
        devMap.get(dev)!.push(s);
      }
      return map;
    } else {
      const map = new Map<string, Map<string, SessionSnapshot[]>>();
      for (const s of sessions) {
        const dev = s.session.deviceId;
        const id = s.identity || 'anonymous';
        if (!map.has(dev)) map.set(dev, new Map());
        const idMap = map.get(dev)!;
        if (!idMap.has(id)) idMap.set(id, []);
        idMap.get(id)!.push(s);
      }
      return map;
    }
  }, [sessions, groupBy]);

  const totalSessions = sessions.length;
  const onlineSessions = sessions.filter((s) => s.connected).length;
  const t = useT();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 顶部状态栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>
          {t('dashboard.title')}
        </h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('dashboard.room')} <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 3 }}>{room}</code>
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--accent-green)' }}>{t('dashboard.online', { count: onlineSessions })}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('dashboard.total', { count: totalSessions })}</span>
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: connStatus === 'connected' ? '#4caf50' : connStatus === 'connecting' ? '#ffcc02' : '#f44747',
            }}
          />
          {t(`status.${connStatus}` as MessageKey)}
        </span>

        <div style={{ flex: 1 }} />

        <ThemeToggle />
        <LanguageToggle />

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setGroupBy('identity')}
            style={{
              background: groupBy === 'identity' ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
              color: groupBy === 'identity' ? '#fff' : 'var(--text-primary)',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {t('dashboard.groupByIdentity')}
          </button>
          <button
            onClick={() => setGroupBy('device')}
            style={{
              background: groupBy === 'device' ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
              color: groupBy === 'device' ? '#fff' : 'var(--text-primary)',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {t('dashboard.groupByDevice')}
          </button>
        </div>
      </div>

      {/* 主内容 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {sessions.length === 0 ? (
          <EmptyState room={room} connStatus={connStatus} />
        ) : (
          <SessionGroups groups={groups} groupBy={groupBy} room={room} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ room, connStatus }: { room: string; connStatus: string }): React.ReactElement {
  const t = useT();
  const scriptTag = `<script src="${window.location.origin}/remotr.js" data-room="${room}"></script>`;

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📡</div>
      <h2 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 12 }}>
        {connStatus === 'connected' ? t('dashboard.noSessions') : t('dashboard.connecting')}
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 13 }}>
        {t('dashboard.injectHint')}
      </p>
      <pre
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 16,
          fontSize: 12,
          color: 'var(--accent-blue)',
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          overflow: 'auto',
        }}
      >
        {scriptTag}
      </pre>
      <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 12 }}>
        {t('dashboard.supportsPrefix')} <code>data-identity-cookie="username"</code> {t('dashboard.supportsSuffix')}
      </p>
    </div>
  );
}

function SessionGroups({
  groups,
  groupBy,
  room,
}: {
  groups: Map<string, Map<string, SessionSnapshot[]>>;
  groupBy: GroupBy;
  room: string;
}): React.ReactElement {
  const t = useT();
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {Array.from(groups.entries()).map(([topKey, subMap]) => (
        <div
          key={topKey}
          style={{
            marginBottom: 24,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 16px',
              background: 'var(--bg-tertiary)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 14 }}>
              {groupBy === 'identity' ? '👤' : '💻'}
            </span>
            <strong style={{ color: 'var(--text-primary)' }}>{topKey}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              · {t('dashboard.pages', { count: Array.from(subMap.values()).reduce((sum, arr) => sum + arr.length, 0) })}
            </span>
          </div>

          {Array.from(subMap.entries()).map(([subKey, pages]) => (
            <div key={subKey} style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{groupBy === 'identity' ? '💻' : '👤'}</span>
                <code style={{ fontFamily: 'var(--font-mono)' }}>{subKey}</code>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 8,
                }}
              >
                {pages.map((page) => (
                  <SessionCard key={`${page.session.deviceId}:${page.session.pageId}`} session={page} room={room} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionCard({ session, room }: { session: SessionSnapshot; room: string }): React.ReactElement {
  const t = useT();
  const handleClick = () => {
    navigateToSession(room, session.session.deviceId, session.session.pageId);
  };

  const ua = session.systemInfo?.ua || '';
  const browser = parseBrowser(ua);
  const url = session.systemInfo?.url || '';
  const title = session.systemInfo?.title || t('dashboard.noTitle');
  const viewport = session.systemInfo?.viewport;
  const framework = session.systemInfo?.framework;

  return (
    <div
      onClick={handleClick}
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 12,
        cursor: session.connected ? 'pointer' : 'not-allowed',
        opacity: session.connected ? 1 : 0.5,
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        if (session.connected) {
          e.currentTarget.style.borderColor = 'var(--accent-blue)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: session.connected ? '#4caf50' : '#858585',
          }}
        />
        <span style={{ fontSize: 11, color: session.connected ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          {session.connected ? t('status.online') : t('status.offline')}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto' }}>
          {formatTime(session.lastActive, t)}
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 500,
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={url}
      >
        {url || '...'}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 10 }}>
        <Tag>{browser}</Tag>
        {viewport && (
          <Tag>
            {viewport.width}×{viewport.height}
          </Tag>
        )}
        {framework && <Tag color="var(--accent-purple)">{framework}</Tag>}
        <Tag color="var(--text-muted)">
          {session.session.pageId.slice(0, 10)}...
        </Tag>
      </div>
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }): React.ReactElement {
  return (
    <span
      style={{
        background: 'var(--bg-tertiary)',
        color: color || 'var(--text-secondary)',
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </span>
  );
}

function parseBrowser(ua: string): string {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Browser';
}

function formatTime(ts: number, t: TFunc): string {
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 5) return t('time.justNow');
  if (diff < 60) return t('time.secondsAgo', { n: diff });
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) });
  return new Date(ts).toLocaleString();
}
