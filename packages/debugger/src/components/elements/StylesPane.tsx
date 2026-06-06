import React, { useState } from 'react';
import { useT } from '../../i18n';

export type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

interface StylesPaneProps {
  styles: Record<string, string> | null;
  nodeId: number | null;
  status?: LoadStatus;
  error?: string | null;
  onRetry?: () => void;
  onStyleSaved?: (property: string, value: string) => void;
  onStyleError?: (error: string) => void;
}

export default function StylesPane({
  styles,
  nodeId,
  status = styles === null ? 'loading' : 'success',
  error,
  onRetry,
  onStyleSaved,
  onStyleError,
}: StylesPaneProps): React.ReactElement {
  const t = useT();
  const [filter, setFilter] = useState('');
  const [editedProps, setEditedProps] = useState<Set<string>>(new Set());
  const [savingProp, setSavingProp] = useState<string | null>(null);

  if (status === 'idle') return <PaneState message={t('computed.selectElement')} />;
  if (status === 'loading') return <PaneState message={t('styles.loading')} />;
  if (status === 'error') return <PaneState message={error || t('styles.failed')} error onRetry={onRetry} />;

  const entries = Object.entries(styles ?? {});
  const filtered = entries.filter(([prop, value]) => {
    if (!filter) return true;
    const searchText = filter.toLowerCase();
    return prop.toLowerCase().includes(searchText) || value.toLowerCase().includes(searchText);
  });

  if (entries.length === 0) return <PaneState message={t('computed.noStyles')} />;

  const handleValueEdit = async (prop: string, newValue: string) => {
    if (nodeId === null) return;
    setSavingProp(prop);
    try {
      const { sendCommand } = await import('../../ws');
      const reply = await sendCommand('elements.setStyle', { nodeId, property: prop, value: newValue });
      if (reply.error) {
        onStyleError?.(reply.error);
      } else {
        setEditedProps((prev) => new Set(prev).add(prop));
        onStyleSaved?.(prop, newValue);
      }
    } catch (err) {
      onStyleError?.(err instanceof Error ? err.message : 'Failed to set style');
    } finally {
      setSavingProp(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input type="text" placeholder={t('computed.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, maxWidth: 300 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('computed.doubleClickApply')}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{t('computed.stylesCount', { filtered: filtered.length, total: entries.length })}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>{t('computed.noMatchFilter')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>{t('computed.property')}</th><th>{t('computed.value')}</th></tr></thead>
            <tbody>
              {filtered.map(([prop, value], index) => {
                const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
                const isEdited = editedProps.has(prop);
                return (
                  <tr key={prop} style={{ background: index % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    <td style={{ padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{prop}</td>
                    <td title={value.length > 100 ? value : t('computed.doubleClickApply')} style={{ padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: isEdited ? 'var(--accent-orange)' : 'var(--text-primary)', fontWeight: isEdited ? 600 : 400, wordBreak: 'break-all', borderBottom: '1px solid var(--border)' }}>
                      <EditableValue value={savingProp === prop ? t('styles.saving') : displayValue} fullValue={value} onSave={(newValue) => handleValueEdit(prop, newValue)} />
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

function PaneState({ message, error, onRetry }: { message: string; error?: boolean; onRetry?: () => void }): React.ReactElement {
  const t = useT();
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, height: '100%', color: error ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: 12 }}><span>{message}</span>{onRetry && <button onClick={onRetry}>{t('common.retry')}</button>}</div>;
}

interface EditableValueProps { value: string; fullValue: string; onSave: (newValue: string) => void; }
function EditableValue({ value, fullValue, onSave }: EditableValueProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(fullValue);
  const close = (save: boolean) => { setEditing(false); if (save && editValue !== fullValue) onSave(editValue); };
  if (editing) return <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => close(true)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } else if (e.key === 'Escape') close(false); }} autoFocus style={{ width: '100%', border: '1px solid var(--accent-blue)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 4px' }} />;
  return <span onDoubleClick={() => { setEditing(true); setEditValue(fullValue); }} style={{ cursor: 'text' }}>{value}</span>;
}
