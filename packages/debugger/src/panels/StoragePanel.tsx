import React, { useState, useCallback } from 'react';
import { useStore } from '../store';
import { sendCommand } from '../ws';
import type { StorageType } from '@remotr/shared';

type StorageTab = 'local' | 'session' | 'cookie';

function StorageTable({
  data,
  storageType,
}: {
  data: Record<string, string>;
  storageType: StorageType;
}): React.ReactElement {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const entries = Object.entries(data);

  const startEdit = (key: string, val: string) => {
    setEditingKey(key);
    setEditValue(val);
  };

  const commitEdit = useCallback(
    async (key: string) => {
      try {
        await sendCommand('storage.set', { storageType, key, value: editValue });
      } catch {
        // ignore — server may not be connected
      }
      setEditingKey(null);
    },
    [storageType, editValue],
  );

  const handleDelete = useCallback(
    async (key: string) => {
      try {
        await sendCommand('storage.delete', { storageType, key });
      } catch { /* ignore */ }
    },
    [storageType],
  );

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '35%' }}>Key</th>
          <th>Value</th>
          <th style={{ width: 60 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 && (
          <tr><td colSpan={3} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Empty</td></tr>
        )}
        {entries.map(([key, val]) => (
          <tr key={key}>
            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }}>{key}</td>
            <td
              onDoubleClick={() => startEdit(key, val)}
              style={{ maxWidth: 400, cursor: 'text' }}
            >
              {editingKey === key ? (
                <input
                  type="text"
                  value={editValue}
                  autoFocus
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(key);
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
              ) : (
                <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{val}</span>
              )}
            </td>
            <td>
              <button
                onClick={() => handleDelete(key)}
                style={{ color: 'var(--accent-red)', fontSize: 10, padding: '1px 4px' }}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StoragePanel(): React.ReactElement {
  const storage = useStore((s) => s.storage);
  const [activeTab, setActiveTab] = useState<StorageTab>('local');

  const handleRefresh = useCallback(async () => {
    const type = activeTab === 'cookie' ? 'cookie' : activeTab === 'session' ? 'session' : 'local';
    try {
      await sendCommand('storage.getAll', { storageType: type });
    } catch { /* ignore */ }
  }, [activeTab]);

  const handleClear = useCallback(async () => {
    const type = activeTab === 'cookie' ? 'cookie' : activeTab === 'session' ? 'session' : 'local';
    try {
      await sendCommand('storage.clear', { storageType: type });
    } catch { /* ignore */ }
  }, [activeTab]);

  const tabs: StorageTab[] = ['local', 'session', 'cookie'];
  const tabLabels: Record<StorageTab, string> = {
    local: 'Local Storage',
    session: 'Session Storage',
    cookie: 'Cookies',
  };

  const currentData = storage[activeTab];
  const storageType: StorageType = activeTab === 'cookie' ? 'cookie' : activeTab === 'session' ? 'session' : 'local';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              background: activeTab === t ? 'var(--bg-selected)' : 'var(--bg-tertiary)',
              color: activeTab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {tabLabels[t]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleRefresh}>Refresh</button>
        <button onClick={handleClear} style={{ color: 'var(--accent-red)' }}>Clear All</button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <StorageTable data={currentData} storageType={storageType} />
      </div>
    </div>
  );
}
