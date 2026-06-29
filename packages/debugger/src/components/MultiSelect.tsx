/**
 * MultiSelect 下拉多选组件
 * 替代 `<select multiple>` 的滚动条，使用真正的 dropdown 浮层 + 勾选框。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface MultiSelectProps {
  /** 所有可选值 */
  options: string[];
  /** 当前选中的值 */
  selected: Set<string>;
  /** 选中变化回调 */
  onChange: (selected: Set<string>) => void;
  /** 未选择时的占位文本 */
  placeholder: string;
  /** 已选计数后缀，如 "selected" */
  selectedLabel: string;
  /** 选项格式化函数（默认直接显示） */
  formatOption?: (value: string) => string;
  /** 最小宽度 */
  minWidth?: number;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  selectedLabel,
  formatOption,
  minWidth = 140,
}: MultiSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggleOption = useCallback(
    (value: string) => {
      const next = new Set(selected);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      onChange(next);
    },
    [selected, onChange],
  );

  const hasSelection = selected.size > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth, fontSize: 11 }}>
      {/* 触发器 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          width: '100%',
          height: 28,
          padding: '0 8px',
          background: 'var(--bg-primary)',
          border: `1px solid ${hasSelection ? 'var(--accent-blue)' : 'var(--border)'}`,
          borderRadius: 3,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 11,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hasSelection
            ? `${selected.size} ${selectedLabel}`
            : <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>}
        </span>
        <span style={{
          fontSize: 8,
          color: 'var(--text-muted)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }}>
          ▾
        </span>
      </button>

      {/* 清除按钮 */}
      {hasSelection && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(new Set());
          }}
          style={{
            position: 'absolute',
            right: 20,
            top: 2,
            width: 18,
            height: 24,
            background: 'none',
            border: 'none',
            borderRadius: 2,
            cursor: 'pointer',
            fontSize: 10,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Clear"
        >
          ✕
        </button>
      )}

      {/* 下拉浮层 */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 2,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)', textAlign: 'center' }}>
              (empty)
            </div>
          ) : (
            options.map((opt) => {
              const checked = selected.has(opt);
              return (
                <label
                  key={opt}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    background: checked ? 'var(--bg-tertiary)' : 'transparent',
                    userSelect: 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!checked) e.currentTarget.style.background = 'var(--bg-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!checked) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOption(opt)}
                    style={{ cursor: 'pointer', margin: 0 }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatOption ? formatOption(opt) : opt}
                  </span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
