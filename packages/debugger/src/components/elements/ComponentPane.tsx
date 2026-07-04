import React, { useEffect, useRef, useState } from 'react';
import type { FrameworkInspectResult } from '@remotr/shared';
import { sendCommand } from '../../ws';
import { SpyAtomView } from '../SpyAtomView';
import { useT } from '../../i18n';

/** 框架名徽标的展示文案与配色 */
const FRAMEWORK_BADGE: Record<string, { label: string; color: string }> = {
  react: { label: 'React', color: '#61dafb' },
  vue3: { label: 'Vue 3', color: '#42b883' },
  vue2: { label: 'Vue 2', color: '#42b883' },
};

/**
 * Component 子页:展示选中元素所属的框架组件(React / Vue3 / Vue2)。
 * 自含数据获取:selectedNodeId 变化时发送 framework.inspect,
 * 与 Styles/Computed/BoxModel 的 fetch 解耦(单一职责)。
 */
export default function ComponentPane({ nodeId }: { nodeId: number | null }): React.ReactElement {
  const t = useT();
  const [result, setResult] = useState<FrameworkInspectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (nodeId === null) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    sendCommand('framework.inspect', { nodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
        if (reply.error) {
          setError(reply.error);
          setResult(null);
        } else {
          setResult(reply.result as FrameworkInspectResult);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (reqId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to inspect component');
        setResult(null);
        setLoading(false);
      });
  }, [nodeId]);

  if (nodeId === null) return <Msg text={t('component.selectElement')} />;
  if (loading) return <Msg text={t('component.loading')} />;
  if (error) return <Msg text={error} error />;
  if (!result) return <Msg text={t('component.selectElement')} />;
  if (!result.framework) return <Msg text={t('component.notComponent')} />;

  const badge = FRAMEWORK_BADGE[result.framework] ?? { label: result.framework, color: 'var(--text-muted)' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '6px 8px', fontSize: 11 }}>
      {/* 组件名 + 框架徽标 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--accent-purple)',
          }}
        >
          {'<'}{result.componentName ?? 'Anonymous'}{'>'}
        </span>
        <span
          style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 8,
            border: `1px solid ${badge.color}`,
            color: badge.color,
          }}
        >
          {badge.label}
        </span>
      </div>

      {/* 祖先链面包屑(靠近自身的在前 → 反转为根在前的阅读顺序) */}
      {result.ancestors && result.ancestors.length > 0 && (
        <div
          style={{
            marginBottom: 8,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            wordBreak: 'break-all',
          }}
        >
          {[...result.ancestors].reverse().map((a, i) => (
            <span key={i}>
              {a.name}
              {i < result.ancestors!.length - 1 && <span style={{ opacity: 0.5 }}>{' > '}</span>}
            </span>
          ))}
          <span style={{ opacity: 0.5 }}>{' > '}</span>
          <span style={{ color: 'var(--accent-purple)' }}>{result.componentName}</span>
        </div>
      )}

      {/* Props */}
      <Section title="Props">
        {result.props ? <SpyAtomView atom={result.props} /> : <Empty t={t} />}
      </Section>

      {/* State */}
      <Section title={stateTitle(result.framework)}>
        {result.state ? <SpyAtomView atom={result.state} /> : <Empty t={t} />}
      </Section>
    </div>
  );
}

/** state 区块标题按框架微调,让用户知道数据来源 */
function stateTitle(framework: string): string {
  if (framework === 'react') return 'State (hooks / this.state)';
  if (framework === 'vue3') return 'State (setup / data)';
  return 'State ($data)';
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border)',
          paddingBottom: 2,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ t }: { t: ReturnType<typeof useT> }): React.ReactElement {
  return <span style={{ color: 'var(--text-muted)' }}>{t('component.empty')}</span>;
}

function Msg({ text, error }: { text: string; error?: boolean }): React.ReactElement {
  return (
    <div
      style={{
        padding: '12px 8px',
        color: error ? 'var(--accent-red)' : 'var(--text-muted)',
        fontSize: 11,
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  );
}
