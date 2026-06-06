import React, { useState } from 'react';
import { useStore } from '../store';
import type { NetworkRecord } from '../store';
import { useT, type MessageKey } from '../i18n';

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
  const t = useT();
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
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {tab === 'general' && (
          <table style={{ width: '100%' }}>
            <tbody>
              <tr><td style={{ color: 'var(--text-secondary)', width: 120 }}>{t('network.url')}</td><td style={{ wordBreak: 'break-all' }}>{record.request?.url ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.method')}</td><td>{record.request?.method ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.status')}</td><td style={{ color: statusColor(record.response?.status) }}>{record.response ? `${record.response.status} ${record.response.statusText}` : record.error ? t('network.error', { error: record.error.error }) : t('network.pending')}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.type')}</td><td>{record.request?.initiator ?? '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.duration')}</td><td>{record.response ? `${record.response.duration}ms` : record.error ? `${record.error.duration}ms` : '—'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>{t('network.mime')}</td><td>{record.response?.mimeType ?? '—'}</td></tr>
            </tbody>
          </table>
        )}
        {tab === 'req-headers' && record.request?.headers && <HeadersTable headers={record.request.headers} />}
        {tab === 'res-headers' && record.response?.headers && <HeadersTable headers={record.response.headers} />}
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
        {!record.request && !record.response && <span style={{ color: 'var(--text-muted)' }}>{t('network.noData')}</span>}
      </div>
    </div>
  );
}

export default function NetworkPanel(): React.ReactElement {
  const networkMap = useStore((s) => s.networkMap);
  const clearNetwork = useStore((s) => s.clearNetwork);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const t = useT();

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
        <button onClick={clearNetwork}>{t('common.clear')}</button>
        <input
          type="text"
          placeholder={t('network.filterUrl')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('network.requests', { count: records.length })}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>{t('network.name')}</th>
              <th style={{ width: '6%' }}>{t('network.method')}</th>
              <th style={{ width: '8%' }}>{t('network.status')}</th>
              <th style={{ width: '10%' }}>{t('network.type')}</th>
              <th style={{ width: '10%' }}>{t('network.duration')}</th>
              <th>{t('network.url')}</th>
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
