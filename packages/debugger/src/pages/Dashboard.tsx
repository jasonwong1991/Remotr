/**
 * Dashboard 页面
 * 展示所有活跃的设备/页面/身份，支持分组与跳转到调试页面
 */

import React, { useEffect, useState, useMemo } from 'react';
import type { SessionSnapshot, DashboardSessionsEvent } from '@remotr/shared';
import { decodeFrame } from '@remotr/shared';
import { navigateToSession, navigateToReplay } from '../router';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import { parseDevice, deviceDisplay } from '../ua';
import { useT, type MessageKey, type TFunc } from '../i18n';
import MultiSelect from '../components/MultiSelect';

type GroupBy = 'identity' | 'device';

interface DashboardProps {
  room: string;
}

export default function Dashboard({ room }: DashboardProps): React.ReactElement {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [groupBy, setGroupBy] = useState<GroupBy>('identity');

  // 过滤状态
  const [filterIdentities, setFilterIdentities] = useState<Set<string>>(new Set());
  const [filterDevices, setFilterDevices] = useState<Set<string>>(new Set());
  const [filterUrl, setFilterUrl] = useState('');
  const [filterOnlineOnly, setFilterOnlineOnly] = useState(false);

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

  // 应用过滤条件
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      // 在线状态过滤
      if (filterOnlineOnly && !s.connected) return false;

      // 身份过滤（空集 = 全选）
      if (filterIdentities.size > 0) {
        const id = s.identity || s.session.deviceId; // 匿名回退用 deviceId
        if (!filterIdentities.has(id)) return false;
      }

      // 设备过滤
      if (filterDevices.size > 0) {
        if (!filterDevices.has(s.session.deviceId)) return false;
      }

      // URL/标题搜索（不区分大小写）
      if (filterUrl.trim()) {
        const needle = filterUrl.toLowerCase();
        const url = s.systemInfo?.url?.toLowerCase() || '';
        const title = s.systemInfo?.title?.toLowerCase() || '';
        if (!url.includes(needle) && !title.includes(needle)) return false;
      }

      return true;
    });
  }, [sessions, filterIdentities, filterDevices, filterUrl, filterOnlineOnly]);

  // 分组数据（基于过滤后的 sessions）
  const groups = useMemo(() => {
    if (groupBy === 'identity') {
      const map = new Map<string, Map<string, SessionSnapshot[]>>();
      for (const s of filteredSessions) {
        // identity 取不到时不再把不同设备并入同一个 'anonymous' 框——
        // 不同设备代表不同的人，应以 deviceId 各自成顶层组。
        const id = s.identity || s.session.deviceId;
        const dev = s.session.deviceId;
        if (!map.has(id)) map.set(id, new Map());
        const devMap = map.get(id)!;
        if (!devMap.has(dev)) devMap.set(dev, []);
        devMap.get(dev)!.push(s);
      }
      return map;
    } else {
      const map = new Map<string, Map<string, SessionSnapshot[]>>();
      for (const s of filteredSessions) {
        const dev = s.session.deviceId;
        const id = s.identity || 'anonymous';
        if (!map.has(dev)) map.set(dev, new Map());
        const idMap = map.get(dev)!;
        if (!idMap.has(id)) idMap.set(id, []);
        idMap.get(id)!.push(s);
      }
      return map;
    }
  }, [filteredSessions, groupBy]);

  const totalSessions = filteredSessions.length;
  const onlineSessions = filteredSessions.filter((s) => s.connected).length;

  // 提取所有唯一身份和设备（用于过滤器下拉）
  const allIdentities = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => set.add(s.identity || s.session.deviceId));
    return Array.from(set).sort();
  }, [sessions]);

  const allDevices = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => set.add(s.session.deviceId));
    return Array.from(set).sort();
  }, [sessions]);

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

        <button
          onClick={() => navigateToReplay(room)}
          title={t('replay.title')}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            padding: '4px 10px',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {t('replay.entry')}
        </button>

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

      {/* 过滤栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
          {t('dashboard.filter')}
        </span>

        {/* 身份多选 */}
        <MultiSelect
          options={allIdentities}
          selected={filterIdentities}
          onChange={setFilterIdentities}
          placeholder={t('dashboard.filterIdentityAll')}
          selectedLabel={t('dashboard.selected')}
          formatOption={(id) => (id.startsWith('dev_') ? `${id.slice(0, 10)}...` : id)}
          minWidth={140}
        />

        {/* 设备多选 */}
        <MultiSelect
          options={allDevices}
          selected={filterDevices}
          onChange={setFilterDevices}
          placeholder={t('dashboard.filterDeviceAll')}
          selectedLabel={t('dashboard.selected')}
          formatOption={(dev) => `${dev.slice(0, 12)}...`}
          minWidth={140}
        />

        {/* URL/标题搜索 */}
        <input
          type="text"
          placeholder={t('dashboard.filterUrlPlaceholder')}
          value={filterUrl}
          onChange={(e) => setFilterUrl(e.target.value)}
          style={{
            flex: 1,
            minWidth: 180,
            maxWidth: 300,
            height: 28,
            fontSize: 11,
            padding: '0 8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            color: 'var(--text-primary)',
          }}
        />

        {/* 仅在线 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={filterOnlineOnly}
            onChange={(e) => setFilterOnlineOnly(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          {t('dashboard.onlineOnly')}
        </label>

        {/* 清除所有过滤 */}
        {(filterIdentities.size > 0 || filterDevices.size > 0 || filterUrl.trim() || filterOnlineOnly) && (
          <button
            onClick={() => {
              setFilterIdentities(new Set());
              setFilterDevices(new Set());
              setFilterUrl('');
              setFilterOnlineOnly(false);
            }}
            style={{
              background: 'var(--log-warn-bg)',
              color: 'var(--log-warn-fg)',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {t('dashboard.clearAllFilters')}
          </button>
        )}
      </div>

      {/* 主内容 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {filteredSessions.length === 0 && sessions.length > 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>🔍</div>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>{t('dashboard.noMatchingSessions')}</h3>
            <p style={{ fontSize: 12 }}>{t('dashboard.adjustFilters')}</p>
          </div>
        ) : sessions.length === 0 ? (
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
      {Array.from(groups.entries()).map(([topKey, subMap]) => {
        // device 分组时 topKey 是 deviceId → 解析成真实设备名（UA 取组内首个 session）
        const topUa = Array.from(subMap.values())[0]?.[0]?.systemInfo?.ua;
        // identity 分组下，匿名 session 回退用 deviceId 作顶层 key——此时该 key 恰好
        // 等于其唯一子组的 deviceId，按设备名渲染并显示设备图标，而非 👤 + 原始 ID。
        const isDeviceFallback = groupBy === 'identity' && subMap.size === 1 && subMap.has(topKey);
        const topLabel =
          groupBy === 'device' || isDeviceFallback ? deviceDisplay(topKey, topUa) : topKey;
        const topIcon = groupBy === 'device' || isDeviceFallback ? '💻' : '👤';
        return (
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
              {topIcon}
            </span>
            <strong style={{ color: 'var(--text-primary)' }} title={topKey}>{topLabel}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              · {t('dashboard.pages', { count: Array.from(subMap.values()).reduce((sum, arr) => sum + arr.length, 0) })}
            </span>
          </div>

          {Array.from(subMap.entries()).map(([subKey, pages]) => (
            <div key={subKey} style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
              {/* 匿名回退组的顶层已是该设备名，子行会与之重复，故省略 */}
              {!isDeviceFallback && (
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
                  <code style={{ fontFamily: 'var(--font-mono)' }} title={subKey}>
                    {groupBy === 'identity' ? deviceDisplay(subKey, pages[0]?.systemInfo?.ua) : subKey}
                  </code>
                </div>
              )}
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
        );
      })}
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
        {parseDevice(ua) && <Tag color="var(--accent-blue)">{parseDevice(ua)}</Tag>}
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
