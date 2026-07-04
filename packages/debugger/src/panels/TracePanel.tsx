import React, { useState, useCallback } from 'react';
import { useStore } from '../store';
import { setTracepoint, removeTracepoint } from '../ws';
import { SpyAtomView } from '../components/SpyAtomView';
import { useT } from '../i18n';
import { usePersistentState } from '../usePersistentState';

let _tpId = 0;
function nextTracepointId(): string {
  return `tp-${Date.now()}-${++_tpId}`;
}

/**
 * Trace 面板:函数级追踪点(无暂停调试)。
 *
 * 上部:输入函数路径(+ 可选条件)设置追踪点;已设追踪点列表可逐个移除。
 * 下部:命中流,每条展示入参 / 返回值 / 抛出异常(复用 SpyAtomView)+ 耗时 + 调用栈。
 *
 * 追踪点列表与命中流都存活在 store,切换 Tab 不丢;切换 session / 页面刷新时随 store 重置。
 */
export default function TracePanel(): React.ReactElement {
  const t = useT();
  const tracepoints = useStore((s) => s.tracepoints);
  const traceHits = useStore((s) => s.traceHits);
  const addTracepoint = useStore((s) => s.addTracepoint);
  const removeTracepointFromStore = useStore((s) => s.removeTracepoint);
  const clearTrace = useStore((s) => s.clearTrace);

  const [path, setPath] = useState('');
  const [condition, setCondition] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 命中流筛选:按路径子串过滤,全局持久化(与 console/network 筛选同策略)
  const [filter, setFilter] = usePersistentState('trace.filter', '');

  const handleAdd = useCallback(async () => {
    const p = path.trim();
    if (!p || adding) return;
    setAdding(true);
    setError(null);
    const def = {
      id: nextTracepointId(),
      path: p,
      condition: condition.trim() || undefined,
    };
    try {
      const res = await setTracepoint(def);
      if (res.ok) {
        addTracepoint(def);
        setPath('');
        setCondition('');
      } else {
        setError(t('trace.setFailed', { error: res.error ?? '' }));
      }
    } catch (err) {
      setError(t('trace.setFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAdding(false);
    }
  }, [path, condition, adding, addTracepoint, t]);

  const handleRemove = useCallback(
    async (id: string) => {
      // 乐观移除:先更新 UI,命令失败也无妨(SDK 侧幂等)
      removeTracepointFromStore(id);
      try {
        await removeTracepoint(id);
      } catch {
        /* ignore — SDK-side removal is idempotent */
      }
    },
    [removeTracepointFromStore],
  );

  const filteredHits = filter
    ? traceHits.filter((r) => r.hit.path.toLowerCase().includes(filter.toLowerCase()))
    : traceHits;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Setup toolbar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 8px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            placeholder={t('trace.pathPlaceholder')}
            style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
          <input
            type="text"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            placeholder={t('trace.conditionPlaceholder')}
            style={{ flex: 3, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
          <button onClick={handleAdd} disabled={adding || !path.trim()}>
            {adding ? t('trace.adding') : t('trace.add')}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('trace.hint')}</div>
        {error && <div style={{ fontSize: 10, color: 'var(--accent-red)' }}>⚠ {error}</div>}
      </div>

      {/* Active tracepoints */}
      <div
        style={{
          padding: '4px 8px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          maxHeight: 96,
          overflowY: 'auto',
        }}
      >
        {tracepoints.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('trace.noTracepoints')}</div>
        ) : (
          tracepoints.map((tp) => (
            <div
              key={tp.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                padding: '1px 0',
              }}
            >
              <span style={{ color: 'var(--accent-purple)' }}>◉</span>
              <span style={{ color: 'var(--accent-blue)' }}>{tp.path}</span>
              {tp.condition && (
                <span style={{ color: 'var(--text-muted)' }}>
                  {t('trace.condition')} <span style={{ color: 'var(--accent-yellow)' }}>{tp.condition}</span>
                </span>
              )}
              <button
                onClick={() => handleRemove(tp.id)}
                style={{ marginLeft: 'auto', color: 'var(--accent-red)', fontSize: 10, padding: '0 4px' }}
                title={t('trace.remove')}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Hits toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button onClick={clearTrace} title={t('trace.clearHits')}>
          🚫
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {t('trace.hitsCount', { count: filteredHits.length })}
        </span>
        <input
          type="text"
          placeholder={t('trace.pathPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 200, fontSize: 11 }}
        />
      </div>

      {/* Hit stream */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filteredHits.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('trace.noHits')}
          </div>
        ) : (
          filteredHits.map((r) => <TraceHitRow key={r.id} record={r} />)
        )}
      </div>
    </div>
  );
}

function TraceHitRow({ record }: { record: import('../store').TraceHitRecord }): React.ReactElement {
  const t = useT();
  const [stackOpen, setStackOpen] = useState(false);
  const { hit } = record;

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{t('trace.seq', { n: hit.seq })}</span>
        <span style={{ color: 'var(--accent-blue)' }}>{hit.path}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{hit.durationMs.toFixed(1)}ms</span>
        {hit.stack && (
          <button onClick={() => setStackOpen((v) => !v)} style={{ fontSize: 10 }}>
            {stackOpen ? '▲' : '▼'}
          </button>
        )}
      </div>

      {/* args */}
      <div style={{ paddingLeft: 12, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('trace.args')}:</span>
        {hit.args.length === 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>()</span>
        ) : (
          hit.args.map((atom, i) => <SpyAtomView key={i} atom={atom} />)
        )}
      </div>

      {/* return value or thrown */}
      {hit.thrown ? (
        <div style={{ paddingLeft: 12, display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--accent-red)' }}>{t('trace.threw')}:</span>
          <SpyAtomView atom={hit.thrown} />
        </div>
      ) : hit.ret ? (
        <div style={{ paddingLeft: 12, display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('trace.returns')}:</span>
          <SpyAtomView atom={hit.ret} />
        </div>
      ) : null}

      {stackOpen && hit.stack && (
        <pre
          style={{
            marginTop: 4,
            marginLeft: 12,
            color: 'var(--text-muted)',
            fontSize: 10,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {hit.stack}
        </pre>
      )}
    </div>
  );
}
