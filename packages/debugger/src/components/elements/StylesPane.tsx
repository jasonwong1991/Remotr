import React, { useState } from 'react';
import { sendCommand } from '../../ws';

interface StylesPaneProps {
  styles: Record<string, string> | null;
  nodeId: number | null;
}

export default function StylesPane({ styles, nodeId }: StylesPaneProps): React.ReactElement {
  const [filter, setFilter] = useState('');
  const [editedProps, setEditedProps] = useState<Set<string>>(new Set());

  // Loading state
  if (styles === null) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      height: '100%',
      color: 'var(--text-secondary)',
     fontSize: 12,
      }}>
        Loading styles...
      </div>
    );
  }

  // Filter styles
  const entries = Object.entries(styles);
  const filtered = entries.filter(([prop, value]) => {
    if (!filter) return true;
    const searchText = filter.toLowerCase();
    return prop.toLowerCase().includes(searchText) || value.toLowerCase().includes(searchText);
  });

  // Empty state
  if (entries.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      color: 'var(--text-muted)',
      fontSize: 12,
      }}>
        No styles found
      </div>
  );
  }

  const handleValueEdit = (prop: string, newValue: string) => {
    if (nodeId === null) return;

    sendCommand('elements.setStyle', { nodeId, property: prop, value: newValue })
      .then((reply) => {
      if (reply.error) {
          console.warn('Failed to set style:', reply.error);
        } else {
        setEditedProps(prev => new Set(prev).add(prop));
        }
      })
      .catch((err) => {
        console.warn('Error setting style:', err);
      });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <input
          type="text"
          placeholder="Filter by property or value…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {filtered.length} / {entries.length} styles
        </span>
      </div>

      {/* Styles table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '12px 8px',
            color: 'var(--text-muted)',
        fontSize: 11,
            textAlign: 'center',
      }}>
            No styles match filter
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
         <thead>
          <tr style={{ background: 'var(--bg-tertiary)', position: 'sticky', top: 0 }}>
                <th style={{
                  textAlign: 'left',
             padding: '4px 8px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11,
             fontWeight: 600,
            color: 'var(--text-secondary)',
                  width: '35%',
              }}>
                Property
                </th>
              <th style={{
                  textAlign: 'left',
                  padding: '4px 8px',
                borderBottom: '1px solid var(--border)',
                fontSize: 11,
               fontWeight: 600,
                  color: 'var(--text-secondary)',
              }}>
              Value
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(([prop, value], index) => {
                const isLongValue = value.length > 100;
            const displayValue = isLongValue ? value.slice(0, 100) + '...' : value;
                const isEdited = editedProps.has(prop);

                return (
              <tr
                    key={prop}
                 style={{
                   background: index % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
              }}
                  >
                    <td
                      style={{
                      padding: '3px 8px',
                     fontSize: 11,
               fontFamily: 'var(--font-mono)',
                 color: 'var(--accent-blue)',
                        verticalAlign: 'top',
                        borderBottom: '1px solid var(--border)',
                    }}
                    >
                  {prop}
                  </td>
            <td
                      style={{
             padding: '3px 8px',
                 fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: isEdited ? 'var(--accent-orange)' : 'var(--text-primary)',
                  fontWeight: isEdited ? 600 : 400,
              wordBreak: 'break-all',
                borderBottom: '1px solid var(--border)',
                      }}
                    title={isLongValue ? value : 'Double-click to edit'}
            >
                      <EditableValue
            value={displayValue}
              fullValue={value}
                 onSave={(newValue) => handleValueEdit(prop, newValue)}
              />
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

interface EditableValueProps {
  value: string;
  fullValue: string;
  onSave: (newValue: string) => void;
}

function EditableValue({ value, fullValue, onSave }: EditableValueProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(fullValue);

  const handleDoubleClick = () => {
    setEditing(true);
    setEditValue(fullValue);
  };

  const handleBlur = () => {
    setEditing(false);
    if (editValue !== fullValue) {
      onSave(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setEditValue(fullValue);
    }
  };

  if (editing) {
    return (
    <input
        type="text"
        value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{
          width: '100%',
          border: '1px solid var(--accent-blue)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
        fontSize: 11,
          padding: '2px 4px',
        }}
      />
    );
  }

  return (
    <span onDoubleClick={handleDoubleClick} style={{ cursor: 'text' }}>
    {value}
    </span>
  );
}
