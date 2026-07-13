import React, { useState } from 'react';
import { useStore } from '../store';
import type { NetworkRecord, WsConnectionRecord, WsFrameRecord } from '../store';
import { useT, type MessageKey, type TFunc } from '../i18n';
import { copyToClipboard } from '../clipboard';
import { buildCurl } from '../curl';
import { buildHar } from '../har';

/** Resource type buckets for the HTTP type filter. */
export type ResourceType = 'xhr' | 'js' | 'css' | 'img' | 'doc' | 'other';

const RESOURCE_TYPES: ResourceType[] = ['xhr', 'js', 'css', 'img', 'doc', 'other'];

/**
 * Classify a record into a coarse resource type for filtering.
 * Prefers the initiator (JS-API vs tag-load), then response MIME, then the
 * URL extension — each source is best-effort so classification stays robust
 * when captured data is partial.
 */
export function resourceType(record: NetworkRecord): ResourceType {
  const initiator = record.request?.initiator;
  if (initiator === 'fetch' || initiator === 'xhr' || initiator === 'beacon') return 'xhr';
  if (initiator === 'script') return 'js';
  if (initiator === 'css' || initiator === 'link') return 'css';
  if (initiator === 'img') return 'img';
  if (initiator === 'iframe') return 'doc';

  const mime = record.response?.mimeType?.toLowerCase() ?? '';
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'js';
  if (mime.includes('css')) return 'css';
  if (mime.startsWith('image/')) return 'img';
  if (mime.includes('html')) return 'doc';

  const url = record.request?.url ?? '';
  const path = url.split(/[?#]/)[0];
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'css') return 'css';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp'].includes(ext)) return 'img';
  if (ext === 'html' || ext === 'htm') return 'doc';

  return 'other';
}

/** Trigger a client-side download of `text` as a named file via a temporary blob URL. */
function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function statusColor(status?: number): string {
  if (!status) return 'var(--status-pending)';
  if (status >= 200 && status < 300) return 'var(--status-2xx)';
  if (status >= 400) return 'var(--status-4xx)';
  return 'var(--text-secondary)';
}

export function urlName(url?: string): string {
  if (!url) return '(unknown)';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || u.hostname;
  } catch {
    const parts = url.split('/');
    return parts[parts.length - 1] || url;
  }
}

function tryFormatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/**
 * Format byte count as human-readable string.
 * 0 → "—" (unknown / from cache / opaque cross-origin)
 */
function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Pretty-print a duration in ms (handles fractional values from Performance Timeline). */
export function formatMs(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function HeadersTable({ headers }: { headers: Record<string, string> }): React.ReactElement {
  if (Object.keys(headers).length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <table style={{ width: '100%' }}>
      <tbody>
        {Object.entries(headers).map(([k, v]) => (
          <tr key={k}>
            <td style={{ color: 'var(--accent-blue)', width: '35%', verticalAlign: 'top' }}>{k}</td>
            <td style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TimingTable({ record, t }: { record: NetworkRecord; t: TFunc }): React.ReactElement {
  const timing = record.request?.timing;
  if (!timing) {
    return <span style={{ color: 'var(--text-muted)' }}>{t('network.noData')}</span>;
  }
  const dns = timing.domainLookupEnd - timing.domainLookupStart;
  const tcp = timing.connectEnd - timing.connectStart;
  const req = timing.responseStart - timing.requestStart;
  const res = timing.responseEnd - timing.responseStart;

  return (
    <table style={{ width: '100%' }}>
      <tbody>
        <tr>
          <td style={{ color: 'var(--text-secondary)', width: 160 }}>{t('network.timing.dns')}</td>
          <td>{formatMs(dns)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.tcp')}</td>
          <td>{formatMs(tcp)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.request')}</td>
          <td>{formatMs(req)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.response')}</td>
          <td>{formatMs(res)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.transferSize')}</td>
          <td>{formatBytes(timing.transferSize)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.encodedSize')}</td>
          <td>{formatBytes(timing.encodedBodySize)}</td>
        </tr>
        <tr>
          <td style={{ color: 'var(--text-secondary)' }}>{t('network.timing.decodedSize')}</td>
          <td>{formatBytes(timing.decodedBodySize)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Tag rendered next to status when error/cache occurs. */
function ErrorBadge({ errorType, t }: { errorType: NonNullable<NetworkRecord['error']>['errorType']; t: TFunc }): React.ReactElement | null {
  if (!errorType) return null;
  const colorMap: Record<string, string> = {
    cors: 'var(--accent-red)',
    network: 'var(--accent-red)',
    timeout: 'var(--accent-yellow, #ffcc02)',
    abort: 'var(--text-muted)',
    unknown: 'var(--accent-red)',
  };
  const color = colorMap[errorType] ?? 'var(--accent-red)';
  return (
    <span
      style={{
        background: color,
        color: '#fff',
        padding: '0 4px',
        borderRadius: 2,
        fontSize: 9,
        fontWeight: 600,
        marginLeft: 4,
        textTransform: 'uppercase',
      }}
    >
      {t(`network.errorType.${errorType}` as MessageKey)}
    </span>
  );
}

function CacheBadge({ t }: { t: TFunc }): React.ReactElement {
  return (
    <span
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        padding: '0 4px',
        borderRadius: 2,
        fontSize: 9,
        marginLeft: 4,
        fontStyle: 'italic',
      }}
    >
      {t('network.fromCache')}
    </span>
  );
}

export function DetailPanel({ record }: { record: NetworkRecord }): React.ReactElement {
  const t = useT();
  const [tab, setTab] = useState<'general' | 'req-headers' | 'res-headers' | 'req-body' | 'res-body' | 'timing'>('general');
  const [copied, setCopied] = useState(false);
  const tabs = ['general', 'req-headers', 'res-headers', 'req-body', 'res-body', 'timing'] as const;

  const status = record.response?.status;
  const isEstimated = !!record.request?.timing && !record.response?.headers
    || (record.response && Object.keys(record.response.headers).length === 0);

  const copyCurl = async (): Promise<void> => {
    await copyToClipboard(buildCurl(record));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      height: 240,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
        {tabs.map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            style={{
              borderRadius: 0, border: 'none',
              borderBottom: tab === tabKey ? '2px solid var(--accent-blue)' : '2px solid transparent',
              background: 'transparent',
              color: tab === tabKey ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '4px 10px', fontSize: 11,
            }}
          >
            {t(`network.tab.${tabKey}` as MessageKey)}
          </button>
        ))}
        <button
          onClick={copyCurl}
          disabled={!record.request}
          title={t('network.copyCurlTitle')}
          style={{
            marginLeft: 'auto', marginRight: 6,
            border: 'none', background: 'transparent',
            color: copied ? 'var(--status-2xx)' : 'var(--accent-blue)',
            fontSize: 11, cursor: record.request ? 'pointer' : 'default',
            opacity: record.request ? 1 : 0.5,
          }}
        >
          {copied ? t('network.copyCurlDone') : t('network.copyCurl')}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {tab === 'general' && (
          <table style={{ width: '100%' }}>
            <tbody>
              <tr><td style={{ color: 'var(--text-secondary)', width: 120 }}>{t('network.url')}</td><td style={{ wordBreak: 'break-all' }}>{record.request?.url ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.method')}</td><td>{record.request?.method ?? '—'}</td></tr>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>{t('network.status')}</td>
                <td style={{ color: statusColor(status) }}>
                  {record.response ? (
                    <>
                      {status} {record.response.statusText}
                      {isEstimated && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{t('network.statusEstimated')}</span>}
                      {record.response.fromCache && <CacheBadge t={t} />}
                    </>
                  ) : record.error ? (
                    <>
                      {t('network.error', { error: record.error.error })}
                      <ErrorBadge errorType={record.error.errorType} t={t} />
                    </>
                  ) : t('network.pending')}
                </td>
              </tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.type')}</td><td>{record.request?.initiator ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.duration')}</td><td>{record.response ? formatMs(record.response.duration) : record.error ? formatMs(record.error.duration) : '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.mime')}</td><td>{record.response?.mimeType ?? '—'}</td></tr>
            </tbody>
          </table>
        )}
        {tab === 'req-headers' && <HeadersTable headers={record.request?.headers ?? {}} />}
        {tab === 'res-headers' && <HeadersTable headers={record.response?.headers ?? {}} />}
        {tab === 'req-body' && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {record.request?.body ? tryFormatJson(record.request.body) : t('network.noBody')}
          </pre>
        )}
        {tab === 'res-body' && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {record.response?.body ? tryFormatJson(record.response.body) : t('network.noBody')}
          </pre>
        )}
        {tab === 'timing' && <TimingTable record={record} t={t} />}
        {!record.request && !record.response && <span style={{ color: 'var(--text-muted)' }}>{t('network.noData')}</span>}
      </div>
    </div>
  );
}

function HttpView(): React.ReactElement {
  const networkMap = useStore((s) => s.networkMap);
  const clearNetwork = useStore((s) => s.clearNetwork);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceType | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const t = useT();

  const allRecords = Array.from(networkMap.values());
  const records = allRecords.filter((r) => {
    if (typeFilter !== 'all' && resourceType(r) !== typeFilter) return false;
    if (!filter) return true;
    return (r.request?.url ?? '').toLowerCase().includes(filter.toLowerCase());
  });

  const selectedRecord = selected ? networkMap.get(selected) : null;

  const exportHar = (): void => {
    const har = buildHar(allRecords, '0.2.0');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(JSON.stringify(har, null, 2), `remotr-${ts}.har`, 'application/json');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={clearNetwork}>{t('common.clear')}</button>
        <input
          type="text"
          placeholder={t('network.filterUrl')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ResourceType | 'all')}
          style={{ fontSize: 11 }}
        >
          <option value="all">{t('network.filterTypeAll')}</option>
          {RESOURCE_TYPES.map((rt) => (
            <option key={rt} value={rt}>{t(`network.filterType.${rt}` as MessageKey)}</option>
          ))}
        </select>
        <button
          onClick={exportHar}
          disabled={allRecords.length === 0}
          title={t('network.exportHarTitle')}
        >
          {t('network.exportHar')}
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('network.requests', { count: records.length })}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>{t('network.name')}</th>
              <th style={{ width: '6%' }}>{t('network.method')}</th>
              <th style={{ width: '10%' }}>{t('network.status')}</th>
              <th style={{ width: '10%' }}>{t('network.type')}</th>
              <th style={{ width: '10%' }}>{t('network.duration')}</th>
              <th>{t('network.url')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const isSelected = selected === r.reqId;
              const status = r.response?.status;
              const errorType = r.error?.errorType;
              const fromCache = r.response?.fromCache;
              const hasError = !!r.error;
              return (
                <tr
                  key={r.reqId}
                  onClick={() => setSelected(isSelected ? null : r.reqId)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-selected)' : undefined,
                  }}
                >
                  <td style={{ color: hasError ? 'var(--accent-red)' : 'var(--text-primary)', maxWidth: 200 }}>
                    {urlName(r.request?.url)}
                  </td>
                  <td style={{ color: 'var(--accent-purple)' }}>{r.request?.method ?? '—'}</td>
                  <td style={{ color: statusColor(status) }}>
                    {status ?? (hasError ? 'err' : '…')}
                    {hasError && <ErrorBadge errorType={errorType} t={t} />}
                    {fromCache && !hasError && <CacheBadge t={t} />}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.request?.initiator ?? '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {r.response ? formatMs(r.response.duration) : r.error ? formatMs(r.error.duration) : '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', maxWidth: 300 }}>{r.request?.url ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selectedRecord && <DetailPanel record={selectedRecord} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// WS / SSE 子视图：连接列表 + 选中连接的帧日志
// ─────────────────────────────────────────────────────────

function wsStatusColor(status: WsConnectionRecord['status']): string {
  if (status === 'open') return 'var(--status-2xx)';
  if (status === 'error') return 'var(--status-4xx)';
  return 'var(--text-muted)';
}

function fmtFrameTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function KindBadge({ kind }: { kind: WsConnectionRecord['kind'] }): React.ReactElement {
  return (
    <span
      style={{
        background: kind === 'ws' ? 'var(--accent-purple)' : 'var(--accent-blue)',
        color: '#fff',
        padding: '0 4px',
        borderRadius: 2,
        fontSize: 9,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {kind === 'ws' ? 'WS' : 'SSE'}
    </span>
  );
}

function TruncatedBadge({ t }: { t: TFunc }): React.ReactElement {
  return (
    <span
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        padding: '0 4px',
        borderRadius: 2,
        fontSize: 9,
        marginLeft: 4,
        fontStyle: 'italic',
      }}
    >
      {t('network.ws.truncated')}
    </span>
  );
}

/** 选中连接的帧日志（结构对齐 HTTP 的 DetailPanel：底部固定高度） */
function WsFrameLog({ conn, t }: { conn: WsConnectionRecord; t: TFunc }): React.ReactElement {
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      height: 240,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)',
        fontSize: 11, flexShrink: 0,
      }}>
        <KindBadge kind={conn.kind} />
        <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{conn.url}</span>
        <span style={{ color: wsStatusColor(conn.status) }}>
          {conn.status === 'closed' && conn.closeCode != null
            ? t('network.ws.closedWith', { code: conn.closeCode })
            : t(`network.ws.status.${conn.status}` as MessageKey)}
        </span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {t('network.ws.frames', { count: conn.frames.length })}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {conn.frames.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', padding: '6px 10px', display: 'inline-block' }}>
            {t('network.ws.noFrames')}
          </span>
        ) : (
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('network.ws.colTime')}</th>
                <th style={{ width: 32 }}>{t('network.ws.colDir')}</th>
                {conn.kind === 'sse' && <th style={{ width: 90 }}>{t('network.ws.colEvent')}</th>}
                <th style={{ width: 70 }}>{t('network.ws.colSize')}</th>
                <th>{t('network.ws.colData')}</th>
              </tr>
            </thead>
            <tbody>
              {conn.frames.map((f: WsFrameRecord, i: number) => {
                const isSelected = selectedFrame === i;
                const dirColor = f.direction === 'send' ? 'var(--status-2xx)' : 'var(--accent-blue)';
                return (
                  <tr
                    key={i}
                    onClick={() => setSelectedFrame(isSelected ? null : i)}
                    style={{ cursor: 'pointer', background: isSelected ? 'var(--bg-selected)' : undefined }}
                  >
                    <td style={{ color: 'var(--text-muted)' }}>{fmtFrameTime(f.timestamp)}</td>
                    <td style={{ color: dirColor, fontWeight: 600 }}>{f.direction === 'send' ? '↑' : '↓'}</td>
                    {conn.kind === 'sse' && <td style={{ color: 'var(--accent-purple)' }}>{f.event ?? 'message'}</td>}
                    <td style={{ color: 'var(--text-secondary)' }}>{formatBytes(f.size)}</td>
                    <td style={{ color: f.binary ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {isSelected ? (
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                          {tryFormatJson(f.data)}
                        </pre>
                      ) : (
                        <span style={{
                          display: 'inline-block', maxWidth: 480, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom',
                        }}>
                          {f.data}
                        </span>
                      )}
                      {f.truncated && <TruncatedBadge t={t} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WsView(): React.ReactElement {
  const wsConnections = useStore((s) => s.wsConnections);
  const clearWs = useStore((s) => s.clearWs);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const t = useT();

  const conns = Array.from(wsConnections.values()).filter((c) => {
    if (!filter) return true;
    return c.url.toLowerCase().includes(filter.toLowerCase());
  });

  const selectedConn = selected ? wsConnections.get(selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={clearWs}>{t('common.clear')}</button>
        <input
          type="text"
          placeholder={t('network.filterUrl')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {t('network.ws.connections', { count: conns.length })}
        </span>
      </div>

      {/* Connections table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conns.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: 12, fontSize: 12 }}>
            {t('network.ws.noConnections')}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: '30%' }}>{t('network.name')}</th>
                <th style={{ width: '8%' }}>{t('network.type')}</th>
                <th style={{ width: '12%' }}>{t('network.status')}</th>
                <th style={{ width: '10%' }}>{t('network.ws.colSize')}</th>
                <th>{t('network.url')}</th>
              </tr>
            </thead>
            <tbody>
              {conns.map((c) => {
                const isSelected = selected === c.connectionId;
                return (
                  <tr
                    key={c.connectionId}
                    onClick={() => setSelected(isSelected ? null : c.connectionId)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-selected)' : undefined,
                    }}
                  >
                    <td style={{ color: c.status === 'error' ? 'var(--accent-red)' : 'var(--text-primary)', maxWidth: 200 }}>
                      {urlName(c.url)}
                    </td>
                    <td><KindBadge kind={c.kind} /></td>
                    <td style={{ color: wsStatusColor(c.status) }}>
                      {t(`network.ws.status.${c.status}` as MessageKey)}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {t('network.ws.frames', { count: c.frames.length })}
                    </td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: 300 }}>{c.url}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Frame log */}
      {selectedConn ? (
        <WsFrameLog conn={selectedConn} t={t} />
      ) : conns.length > 0 ? (
        <div style={{
          borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)',
          padding: '6px 10px', color: 'var(--text-muted)', fontSize: 11, flexShrink: 0,
        }}>
          {t('network.ws.selectConn')}
        </div>
      ) : null}
    </div>
  );
}

export default function NetworkPanel(): React.ReactElement {
  const [view, setView] = useState<'http' | 'ws'>('http');
  const t = useT();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* HTTP / WS-SSE sub-view toggle（样式对齐 DetailPanel 的 tab 行） */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)', flexShrink: 0 }}>
        {(['http', 'ws'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              borderRadius: 0, border: 'none',
              borderBottom: view === v ? '2px solid var(--accent-blue)' : '2px solid transparent',
              background: 'transparent',
              color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '4px 10px', fontSize: 11,
            }}
          >
            {t(v === 'http' ? 'network.view.http' : 'network.view.ws')}
          </button>
        ))}
      </div>
      {view === 'http' ? <HttpView /> : <WsView />}
    </div>
  );
}
