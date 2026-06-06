import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';

export interface HtmlEditModalProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const dialogStyle: React.CSSProperties = {
  width: 'min(640px, 90vw)',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
  overflow: 'hidden',
};

const titleStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  margin: 0,
  padding: 12,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 2,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
};

const btnBase: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 12,
  borderRadius: 4,
  cursor: 'pointer',
  border: '1px solid var(--border)',
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--text-primary)',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: 'var(--accent-blue)',
  borderColor: 'var(--accent-blue)',
  color: '#fff',
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Modal editor for an element's outerHTML — replaces the native `window.prompt`,
 * which truncates long markup and can't be styled. Save with the button or
 * ⌘/Ctrl+Enter; cancel with the button, Esc, or a click on the backdrop.
 */
export default function HtmlEditModal({
  initialValue,
  onSave,
  onCancel,
}: HtmlEditModalProps): React.ReactElement {
  const t = useT();
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSave(value);
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('htmlEdit.title')}
        style={dialogStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={titleStyle}>{t('htmlEdit.title')}</div>
        <textarea
          ref={textareaRef}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          style={textareaStyle}
        />
        <div style={footerStyle}>
          <span style={hintStyle}>{t('htmlEdit.hint')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnSecondary} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="button" style={btnPrimary} onClick={() => onSave(value)}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
