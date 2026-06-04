import React, { useState } from 'react';
import { useStore } from '../store';
import type { NetworkRecord } from '../store';

function statusColor(status?: number): string {
  if (!status) return 'var(--status-pending)';
  if (status >= 200 && status < 300) return 'var(--status-2xx)';
  if (status >= 400) return 'var(--status-4xx)';
  return 'var(--text-secondary)';
}

function urlName(url?: string): string {
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

function HeadersTable({ headers }: { headers: Record<string, string> }): React.ReactElement {
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

function DetailPanel({ record }: { record: NetworkRecord }): React.ReactElement {
  const [tab, setTab] = useState<'general' | 'req-headers' | 'res-headers' | 'req-body' | 'res-body'>('general');
  const tabs = ['general', 'req-headers', 'res-headers', 'req-body', 'res-body'] as const;

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      height: 200,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              borderRadius: 0, border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent-blue)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '4px 10px', fontSize: 11,
            }}
          >
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {tab === 'general' && (
          <table style={{ width: '100%' }}>
            <tbody>
              <tr><td style={{ color: 'var(--text-secondary)', width: 120 }}>URL</td><td style={{ wordBreak: 'break-all' }}>{record.request?.url ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>Method</td><td>{record.request?.method ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>Status</td><td style={{ color: statusColor(record.response?.status) }}>{record.response ? `${record.response.status} ${record.response.statusText}` : record.error ? `Error: ${record.error.error}` : 'pending'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>Type</td><td>{record.request?.initiator ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>Duration</td><td>{record.response ? `${record.response.duration}ms` : record.error ? `${record.error.duration}ms` : '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>MIME</td><td>{record.response?.mimeType ?? '—'}</td></tr>
            </tbody>
          </table>
        )}
        {tab === 'req-headers' && record.request?.headers && <HeadersTable headers={record.request.headers} />}
        {tab === 'res-headers' && record.response?.headers && <HeadersTable headers={record.response.headers} />}
        {tab === 'req-body' && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {record.request?.body ? tryFormatJson(record.request.body) : '(no body)'}
          </pre>
        )}
        {tab === 'res-body' && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {record.response?.body ? tryFormatJson(record.response.body) : '(no body)'}
          </pre>
        )}
        {!record.request && !record.response && <span style={{ color: 'var(--text-muted)' }}>No data</span>}
      </div>
    </div>
  );
}

export default function NetworkPanel(): React.ReactElement {
  const networkMap = useStore((s) => s.networkMap);
  const clearNetwork = useStore((s) => s.clearNetwork);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const records = Array.from(networkMap.values()).filter((r) => {
    if (!filter) return true;
    return (r.request?.url ?? '').toLowerCase().includes(filter.toLowerCase());
  });

  const selectedRecord = selected ? networkMap.get(selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={clearNetwork}>Clear</button>
        <input
          type="text"
          placeholder="Filter by URL…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{records.length} requests</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Name</th>
              <th style={{ width: '6%' }}>Method</th>
              <th style={{ width: '8%' }}>Status</th>
              <th style={{ width: '10%' }}>Type</th>
              <th style={{ width: '10%' }}>Duration</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const isSelected = selected === r.reqId;
              const status = r.response?.status;
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
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.request?.initiator ?? '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {r.response ? `${r.response.duration}ms` : r.error ? `${r.error.duration}ms` : '—'}
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
