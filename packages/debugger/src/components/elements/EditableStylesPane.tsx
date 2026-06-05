import React, { useState } from 'react';
import type { CSSRule } from '@remotr/shared';
import type { LoadStatus } from './StylesPane';
import { sendCommand } from '../../ws';

interface EditableStylesPaneProps {
  inlineStyles: Record<string, string> | null;
  rules: CSSRule[] | null;
  nodeId: number | null;
  status?: LoadStatus;
  error?: string | null;
  onRetry?: () => void;
  onStyleSaved?: () => void;
}

function formatSource(source: string): string {
  try {
    const url = new URL(source);
    return url.pathname.split('/').pop() || source;
  } catch {
    return source;
  }
}

function specificityScore([a, b, c]: [number, number, number]): number {
  return a * 10000 + b * 100 + c;
}

function PaneState({ message, error, onRetry }: { message: string; error?: boolean; onRetry?: () => void }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, height: '100%', color: error ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: 13 }}>
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

export default function EditableStylesPane({
  inlineStyles,
  rules,
  nodeId,
  status = rules === null ? 'loading' : 'success',
  error,
  onRetry,
  onStyleSaved,
}: EditableStylesPaneProps): React.ReactElement {
  const [editedProps, setEditedProps] = useState<Set<string>>(new Set());
  const [savingProp, setSavingProp] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (status === 'idle') return <PaneState message="Select an element to inspect styles." />;
  if (status === 'loading') return <PaneState message="Loading styles..." />;
  if (status === 'error') return <PaneState message={error || 'Failed to load styles.'} error onRetry={onRetry} />;

  const sortedRules = [...(rules ?? [])].sort((a, b) => specificityScore(b.specificity) - specificityScore(a.specificity));
  const hasInline = inlineStyles && Object.keys(inlineStyles).length > 0;
  const hasRules = sortedRules.length > 0;

  if (!hasInline && !hasRules) return <PaneState message="No matched styles" />;

  const handleValueEdit = async (prop: string, newValue: string) => {
    if (nodeId === null) return;
    setSavingProp(prop);
    setSaveError(null);
    try {
      const reply = await sendCommand('elements.setStyle', { nodeId, property: prop, value: newValue });
      if (reply.error) {
        setSaveError(reply.error);
      } else {
        setEditedProps((prev) => new Set(prev).add(prop));
        onStyleSaved?.();
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to set style');
    } finally {
      setSavingProp(null);
    }
  };

  const ruleBlockStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    padding: '8px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12
  };
  const selectorLineStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4
  };
  const selectorStyle: React.CSSProperties = {
    color: 'var(--accent-blue)',
    fontWeight: 600
  };
  const sourceStyle: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: 11,
    marginLeft: 8,
    flexShrink: 0
  };
  const propLineStyle: React.CSSProperties = {
    paddingLeft: 20,
    lineHeight: '1.7',
    display: 'flex',
    alignItems: 'baseline',
    gap: 4
  };
  const propNameStyle: React.CSSProperties = {
    color: 'var(--accent-purple)',
    cursor: 'default'
  };
  const braceStyle: React.CSSProperties = {
    color: 'var(--text-secondary)'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {saveError && (
        <div style={{
       padding: '6px 10px',
        background: 'var(--log-error-bg)',
          color: 'var(--accent-red)',
          fontSize: 12,
          borderBottom: '1px solid var(--border)'
        }}>
          ⚠ {saveError}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {hasInline && (
      <div style={ruleBlockStyle}>
            <div style={selectorLineStyle}>
         <span style={selectorStyle}>element.style</span>
              <span style={sourceStyle}>inline</span>
      </div>
            <span style={braceStyle}>{'{'}</span>
         {Object.entries(inlineStyles!).map(([prop, value]) => {
              const isEdited = editedProps.has(prop);
        const isSaving = savingProp === prop;
              return (
                <div key={prop} style={propLineStyle}>
               <span style={propNameStyle}>{prop}</span>
        <span style={braceStyle}>: </span>
                  <EditableValue
                  value={isSaving ? 'Saving...' : value}
              isEdited={isEdited}
                    onSave={(newValue) => handleValueEdit(prop, newValue)}
            />
                <span style={braceStyle}>;</span>
                </div>
              );
            })}
            <span style={braceStyle}>{'}'}</span>
    </div>
    )}
        {sortedRules.map((rule, index) => (
          <div key={`${rule.selector}-${rule.styleSheetIndex}-${index}`} style={ruleBlockStyle}>
            <div style={selectorLineStyle}>
              <span style={selectorStyle}>{rule.selector}</span>
            <span style={sourceStyle}>{formatSource(rule.source)}</span>
            </div>
        <span style={braceStyle}>{'{'}</span>
            {Object.entries(rule.properties).map(([prop, value]) => {
              const isEdited = editedProps.has(prop);
          const isSaving = savingProp === prop;
              return (
                <div key={prop} style={propLineStyle}>
                  <span style={propNameStyle}>{prop}</span>
                <span style={braceStyle}>: </span>
              <EditableValue
                    value={isSaving ? 'Saving...' : value}
               isEdited={isEdited}
               onSave={(newValue) => handleValueEdit(prop, newValue)}
             />
                <span style={braceStyle}>;</span>
         </div>
              );
            })}
            <span style={braceStyle}>{'}'}</span>
          </div>
      ))}
      </div>
    </div>
  );
}

interface EditableValueProps {
  value: string;
  isEdited: boolean;
  onSave: (newValue: string) => void;
}

function EditableValue({ value, isEdited, onSave }: EditableValueProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleClose = (save: boolean) => {
    setEditing(false);
    if (save && editValue !== value) {
      onSave(editValue);
    }
  };

  if (editing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => handleClose(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
        handleClose(true);
          } else if (e.key === 'Escape') {
       handleClose(false);
          }
      }}
      autoFocus
        style={{
          flex: 1,
          border: '1px solid var(--accent-blue)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
       fontFamily: 'var(--font-mono)',
          fontSize: 12,
      padding: '2px 6px',
          borderRadius: 2,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setEditing(true);
        setEditValue(value);
      }}
      style={{
     color: isEdited ? 'var(--accent-orange)' : 'var(--text-primary)',
        fontWeight: isEdited ? 600 : 400,
        cursor: 'text',
        flex: 1,
      }}
      title="Click to edit (applies as inline style)"
    >
      {value}
    </span>
  );
}
