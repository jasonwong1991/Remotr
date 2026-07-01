/**
 * MultiSelect 下拉多选组件
 * 替代 `<select multiple>` 的滚动条,使用真正的 dropdown 浮层 + 搜索框 + 勾选框。
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface MultiSelectProps {
  /** 所有可选值 */
  options: string[];
  /** 当前选中的值 */
  selected: Set<string>;
  /** 选中变化回调 */
  onChange: (selected: Set<string>) => void;
  /** 未选择时的占位文本 */
  placeholder: string;
  /** 已选计数后缀,如 "selected" */
  selectedLabel: string;
  /** 选项格式化函数(默认直接显示);也用于搜索匹配 */
  formatOption?: (value: string) => string;
  /** 搜索框占位文本 */
  searchPlaceholder?: string;
  /** 无匹配项时的文本 */
  emptyLabel?: string;
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
  searchPlaceholder,
  emptyLabel,
  minWidth = 160,
}: MultiSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  // 打开时自动聚焦搜索框;关闭时清空查询
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      setQuery('');
    }
  }, [open]);

  const label = useCallback(
    (value: string) => (formatOption ? formatOption(value) : value),
    [formatOption],
  );

  const toggleOption = useCallback(
    (value: string) => {
      const next = new Set(selected);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      onChange(next);
    },
    [selected, onChange],
  );

  // 搜索过滤:匹配格式化后的展示名(设备名可读化后即可按型号搜索)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => label(opt).toLowerCase().includes(q));
  }, [options, query, label]);

  const hasSelection = selected.size > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth, fontSize: 12 }}>
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
          height: 30,
          padding: '0 10px',
          background: 'var(--bg-primary)',
          border: `1px solid ${open || hasSelection ? 'var(--accent-blue)' : 'var(--border)'}`,
          borderRadius: 6,
          color: hasSelection ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 12,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hasSelection ? `${selected.size} ${selectedLabel}` : placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {hasSelection && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(new Set());
              }}
              title="Clear"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)',
                fontSize: 9,
                lineHeight: 1,
              }}
            >
              ✕
            </span>
          )}
          <span
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            ▾
          </span>
        </span>
      </button>

      {/* 下拉浮层 */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* 搜索框 */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? 'Search...'}
              style={{
                width: '100%',
                height: 28,
                padding: '0 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 选项列表 */}
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>
                {emptyLabel ?? '(no matches)'}
              </div>
            ) : (
              filtered.map((opt) => {
                const checked = selected.has(opt);
                return (
                  <label
                    key={opt}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                      background: checked ? 'var(--bg-selected)' : 'transparent',
                      userSelect: 'none',
                      transition: 'background 0.1s',
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
                      style={{ cursor: 'pointer', margin: 0, flexShrink: 0, accentColor: 'var(--accent-blue)' }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label(opt)}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
