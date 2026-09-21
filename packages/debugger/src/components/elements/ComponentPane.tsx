import React, { useCallback, useEffect, useRef, useState } from 'react';
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
 * 组件 props/state 的刷新间隔。框架没有可供旁听的"状态变更"事件（React 的
 * commit 钩子只对 DevTools 后端开放），只能在面板打开期间按周期重新 inspect；
 * 结果按 JSON 比对，不变则不触发重渲染，展开状态得以保留。
 */
const REFRESH_MS = 1000;

/**
 * Component 子页:展示选中元素所属的框架组件(React / Vue3 / Vue2)。
 * 自含数据获取:selectedNodeId 变化时发送 framework.inspect,之后在面板可见期间
 * 持续轮询保持 props/state 与页面同步;与 Styles/Computed/BoxModel 的 fetch 解耦(单一职责)。
 */
export default function ComponentPane({ nodeId }: { nodeId: number | null }): React.ReactElement {
  const t = useT();
  const [result, setResult] = useState<FrameworkInspectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const requestIdRef = useRef(0);
  /** 上一次结果的序列化形式，用于比对跳过无变化的更新 */
  const lastJsonRef = useRef<string | null>(null);

  const inspect = useCallback(
    async (target: number, initial: boolean): Promise<void> => {
      // 只有选中节点变化（initial）才推进请求代号；轮询沿用当前代号，
      // 这样节点切换后迟到的旧结果一律丢弃，而轮询不会把首次加载的收尾判成过期。
      const reqId = initial ? ++requestIdRef.current : requestIdRef.current;
      if (initial) {
        setLoading(true);
        setError(null);
        lastJsonRef.current = null;
      }
      try {
        const reply = await sendCommand('framework.inspect', { nodeId: target });
        if (reqId !== requestIdRef.current) return;
        if (reply.error) {
          // 轮询期间的瞬时失败（目标短暂离线等）不抹掉已展示的数据
          if (initial) {
            setError(reply.error);
            setResult(null);
          }
        } else {
          const next = reply.result as FrameworkInspectResult;
          const json = JSON.stringify(next);
          if (json !== lastJsonRef.current) {
            lastJsonRef.current = json;
            setResult(next);
          }
          setError(null);
        }
      } catch (err) {
        if (reqId !== requestIdRef.current) return;
        if (initial) {
          setError(err instanceof Error ? err.message : 'Failed to inspect component');
          setResult(null);
        }
      } finally {
        if (initial && reqId === requestIdRef.current) setLoading(false);
      }
    },
    [],
  );

  // 选中节点变化：立即取一次
  useEffect(() => {
    if (nodeId === null) {
      requestIdRef.current++;
      setResult(null);
      setError(null);
      setLoading(false);
      lastJsonRef.current = null;
      return;
    }
    void inspect(nodeId, true);
  }, [nodeId, inspect]);

  // 面板打开且 live 开启期间轮询；标签页不可见时跳过，避免后台白耗
  useEffect(() => {
    if (nodeId === null || !live) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void inspect(nodeId, false);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [nodeId, live, inspect]);

  if (nodeId === null) return <Msg text={t('component.selectElement')} />;
  if (loading) return <Msg text={t('component.loading')} />;
  if (error) return <Msg text={error} error />;
  if (!result) return <Msg text={t('component.selectElement')} />;
  if (!result.framework) return <Msg text={t('component.notComponent')} />;

  const badge = FRAMEWORK_BADGE[result.framework] ?? { label: result.framework, color: 'var(--text-muted)' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '6px 8px', fontSize: 11 }}>
      {/* 组件名 + 框架徽标 + 实时开关 */}
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
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setLive((v) => !v)}
          title={live ? t('component.liveOnTitle') : t('component.liveOffTitle')}
          style={{
            fontSize: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: live ? 'var(--accent-green)' : 'var(--text-muted)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: live ? 'var(--accent-green)' : 'var(--text-muted)',
              display: 'inline-block',
            }}
          />
          {t('component.live')}
        </button>
        {!live && (
          <button onClick={() => void inspect(nodeId, false)} title={t('common.refresh')} style={{ fontSize: 10 }}>
            ↻
          </button>
        )}
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
