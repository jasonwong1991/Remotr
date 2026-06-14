import React, { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { ConsoleRecord } from '../store';
import { SpyAtomView } from '../components/SpyAtomView';
import { sendEval } from '../ws';
import { resolveStack, type ResolvedFrame } from '../sources';
import { useT } from '../i18n';

type LevelFilter = 'all' | 'log' | 'info' | 'warn' | 'error' | 'debug';

const LEVEL_COLORS: Record<string, string> = {
  error: 'var(--accent-red)',
  warn: 'var(--accent-yellow)',
  info: 'var(--accent-blue)',
  debug: 'var(--text-muted)',
  log: 'var(--text-primary)',
  table: 'var(--text-primary)',
  dir: 'var(--text-primary)',
};

const LEVEL_BG: Record<string, string> = {
  error: 'var(--log-error-bg)',
  warn: 'var(--log-warn-bg)',
  info: 'var(--log-info-bg)',
};

export function ConsoleRow({ record }: { record: ConsoleRecord }): React.ReactElement {
  const t = useT();
  const [stackOpen, setStackOpen] = useState(false);
  const requestSourceView = useStore((s) => s.requestSourceView);
  const [resolved, setResolved] = useState<ResolvedFrame[] | null>(null);
  const [resolving, setResolving] = useState(false);

  const handleResolve = useCallback(async () => {
    const stack = record.pageError?.stack;
    if (!stack || resolving) return;
    setResolving(true);
    try {
      setResolved(await resolveStack(stack));
    } finally {
      setResolving(false);
    }
  }, [record.pageError?.stack, resolving]);

  const color = LEVEL_COLORS[record.level] ?? 'var(--text-primary)';
  const bg = LEVEL_BG[record.level] ?? 'transparent';

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: bg,
      padding: '2px 8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 28, paddingTop: 1, fontFamily: 'var(--font-mono)' }}>
          {record.level.toUpperCase().slice(0, 3)}
        </span>
        <div style={{ flex: 1, color, fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>
          {record.type === 'console' && record.entry && (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {record.entry.args.map((atom, i) => (
                <SpyAtomView key={i} atom={atom} />
              ))}
              {record.entry.stack && (
                <button onClick={() => setStackOpen((v) => !v)} style={{ marginLeft: 4, fontSize: 10 }}>
                  {t('console.stack')} {stackOpen ? '▲' : '▼'}
                </button>
              )}
            </span>
          )}
          {record.type === 'page-error' && record.pageError && (
            <span>
              <span style={{ color: 'var(--accent-red)' }}>
                {record.pageError.isPromiseRejection ? '[UnhandledRejection] ' : '[Error] '}
                {record.pageError.message}
              </span>
              {record.pageError.url && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  {record.pageError.url}:{record.pageError.line}:{record.pageError.col}
                </span>
              )}
              {record.pageError.stack && (
                <button onClick={() => setStackOpen((v) => !v)} style={{ marginLeft: 4, fontSize: 10 }}>
                  {t('console.stack')} {stackOpen ? '▲' : '▼'}
                </button>
              )}
              {record.pageError.stack && (
                <button onClick={handleResolve} disabled={resolving} style={{ marginLeft: 4, fontSize: 10 }}>
                  {resolving ? t('sources.resolving') : t('sources.resolve')}
                </button>
              )}
            </span>
          )}
          {record.type === 'eval-result' && record.evalResult && (
            <span>
              <span style={{ color: 'var(--accent-blue)' }}>{'> '}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{record.evalResult.code}</span>
              <span style={{ color: 'var(--text-muted)' }}>{' → '}</span>
              <SpyAtomView atom={record.evalResult.atom} />
            </span>
          )}
        </div>
      </div>
      {stackOpen && (
        <pre style={{
          marginTop: 4,
          marginLeft: 34,
          color: 'var(--text-muted)',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {(record.type === 'console' ? record.entry?.stack : record.pageError?.stack) ?? ''}
        </pre>
      )}
      {resolved && (
        <div style={{ marginTop: 4, marginLeft: 34, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {resolved.length === 0 && (
            <span style={{ color: 'var(--text-muted)' }}>{t('sources.noFrames')}</span>
          )}
          {resolved.map((f, i) =>
            f.original ? (
              <div
                key={i}
                onClick={() =>
                  requestSourceView({
                    scriptUrl: f.raw.url,
                    source: f.original!.source,
                    line: f.original!.line,
                  })
                }
                style={{ color: 'var(--accent-blue)', cursor: 'pointer' }}
                title={t('sources.jumpTitle')}
              >
                {f.raw.fn ? `${f.raw.fn} ` : ''}
                {f.original.source}:{f.original.line}
              </div>
            ) : (
              <div key={i} style={{ color: 'var(--text-muted)' }}>
                {f.raw.fn ? `${f.raw.fn} ` : ''}
                {f.raw.url}:{f.raw.line}:{f.raw.col}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function ConsolePanel(): React.ReactElement {
  const records = useStore((s) => s.consoleRecords);
  const clearConsole = useStore((s) => s.clearConsole);
  const addEvalResult = useStore((s) => s.addEvalResult);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [textFilter, setTextFilter] = useState('');
  const [evalInput, setEvalInput] = useState('');
  const [evalRunning, setEvalRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const filtered = records.filter((r) => {
    if (levelFilter !== 'all' && r.level !== levelFilter) return false;
    if (textFilter) {
      const text = r.entry
        ? r.entry.args.map((a) => a.display).join(' ')
        : r.pageError?.message ?? r.evalResult?.code ?? '';
      if (!text.toLowerCase().includes(textFilter.toLowerCase())) return false;
    }
    return true;
  });

  const handleEval = useCallback(async () => {
    const code = evalInput.trim();
    if (!code || evalRunning) return;
    setEvalRunning(true);
    try {
      const result = await sendEval(code);
      if (result) {
        addEvalResult(code, result, Date.now());
      }
    } finally {
      setEvalRunning(false);
      setEvalInput('');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [evalInput, evalRunning, addEvalResult]);

  const levels: LevelFilter[] = ['all', 'error', 'warn', 'info', 'log', 'debug'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={clearConsole} title={t('console.clearTitle')}>🚫</button>
        <div style={{ display: 'flex', gap: 2 }}>
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setLevelFilter(l)}
              style={{
                background: levelFilter === l ? 'var(--bg-selected)' : 'var(--bg-tertiary)',
                color: l === 'all' ? 'var(--text-primary)' : (LEVEL_COLORS[l] ?? 'var(--text-primary)'),
                border: '1px solid var(--border)',
                padding: '1px 6px',
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder={t('console.filter')}
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 200 }}
        />
      </div>

      {/* Log list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map((r) => <ConsoleRow key={r.id} record={r} />)}
        <div ref={bottomRef} />
      </div>

      {/* Eval input */}
      <div style={{
        display: 'flex', gap: 4, padding: '4px 8px',
        background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontSize: 12, paddingTop: 2 }}>{'>'}</span>
        <input
          type="text"
          value={evalInput}
          onChange={(e) => setEvalInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleEval(); }}
          placeholder={t('console.evalPlaceholder')}
          disabled={evalRunning}
          style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
        />
        <button onClick={handleEval} disabled={evalRunning}>{t('common.run')}</button>
      </div>
    </div>
  );
}
