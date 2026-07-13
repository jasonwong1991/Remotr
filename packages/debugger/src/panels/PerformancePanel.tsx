import React from 'react';
import { useStore } from '../store';
import { useT, type MessageKey, type TFunc } from '../i18n';
import type { WebVitalName, WebVitalRating, PerfMemoryEvent, PerfFpsEvent } from '@remotr/shared';

/**
 * Performance 面板:展示 SDK 采样上报的 Web Vitals / 长任务 / JS 堆 / FPS。
 *
 * - Web Vitals:FCP/LCP/CLS/TTFB 四张卡片,按 Google 阈值分级着色(good/ni/poor)。
 * - FPS + JS 堆:轻量 SVG sparkline 时间线(不引入图表库),配当前值。
 * - 长任务:阻塞主线程 ≥50ms 的任务列表。
 *
 * 所有数据存活在 store,切 Tab 不丢;切 session / 刷新时随 store 重置。
 */

const RATING_COLOR: Record<WebVitalRating, string> = {
  good: 'var(--accent-green)',
  'needs-improvement': 'var(--accent-orange)',
  poor: 'var(--accent-red)',
};

const VITAL_ORDER: WebVitalName[] = ['FCP', 'LCP', 'CLS', 'TTFB'];
const VITAL_DESC: Record<WebVitalName, MessageKey> = {
  FCP: 'perf.fcpDesc',
  LCP: 'perf.lcpDesc',
  CLS: 'perf.clsDesc',
  TTFB: 'perf.ttfbDesc',
};

/** CLS 无量纲(3 位小数);其余毫秒(整数) */
function formatVital(name: WebVitalName, value: number): string {
  return name === 'CLS' ? value.toFixed(3) : `${Math.round(value)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export default function PerformancePanel(): React.ReactElement {
  const t = useT();
  const perfVitals = useStore((s) => s.perfVitals);
  const perfLongtasks = useStore((s) => s.perfLongtasks);
  const perfMemory = useStore((s) => s.perfMemory);
  const perfFps = useStore((s) => s.perfFps);
  const clearPerf = useStore((s) => s.clearPerf);

  const hasAny =
    Object.keys(perfVitals).length > 0 ||
    perfLongtasks.length > 0 ||
    perfMemory.length > 0 ||
    perfFps.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* toolbar */}
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
        <button onClick={clearPerf} title={t('perf.clearTitle')}>
          🚫
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {!hasAny && (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('perf.waiting')}
          </div>
        )}

        {/* Web Vitals */}
        <Section title={t('perf.vitalsTitle')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {VITAL_ORDER.map((name) => {
              const v = perfVitals[name];
              return (
                <div
                  key={name}
                  style={{
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${v?.rating ? RATING_COLOR[v.rating] : 'var(--border)'}`,
                    borderRadius: 4,
                    padding: '6px 8px',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{name}</span>
                    {v?.rating && (
                      <span style={{ fontSize: 9, color: RATING_COLOR[v.rating] }}>
                        {t(`perf.rating.${v.rating}` as MessageKey)}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 16,
                      color: v ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {v ? formatVital(name, v.value) : '—'}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {v ? t(VITAL_DESC[name]) : t('perf.vitalPending')}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* FPS */}
        <Section title={t('perf.fpsTitle')}>
          <FpsView samples={perfFps} t={t} />
        </Section>

        {/* JS Heap */}
        <Section title={t('perf.memoryTitle')}>
          <MemoryView samples={perfMemory} t={t} />
        </Section>

        {/* Long tasks */}
        <Section title={`${t('perf.longtasksTitle')} · ${t('perf.longtasksCount', { count: perfLongtasks.length })}`}>
          {perfLongtasks.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('perf.noLongtasks')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* 最新在上 */}
              {perfLongtasks
                .slice()
                .reverse()
                .map((lt) => (
                  <div
                    key={lt.seq}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      padding: '2px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        color: lt.duration >= 100 ? 'var(--accent-red)' : 'var(--accent-orange)',
                        fontWeight: 600,
                      }}
                    >
                      {t('perf.ltDuration', { ms: Math.round(lt.duration) })}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t('perf.ltStart', { ms: Math.round(lt.startTime) })}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** 轻量 SVG sparkline —— 不引图表库。values 为空时渲染占位。 */
function Sparkline({
  values,
  color,
  height = 32,
  min,
  max,
}: {
  values: number[];
  color: string;
  height?: number;
  min?: number;
  max?: number;
}): React.ReactElement {
  const width = 240;
  if (values.length < 2) {
    return <div style={{ height, fontSize: 10, color: 'var(--text-muted)' }}>·</div>;
  }
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - lo) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', maxWidth: '100%' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function FpsView({ samples, t }: { samples: PerfFpsEvent[]; t: TFunc }): React.ReactElement {
  if (samples.length === 0) {
    return <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('perf.noFps')}</div>;
  }
  const latest = samples[samples.length - 1].value;
  // 60fps 为绿,30 以下为红,中间橙
  const color = latest >= 50 ? 'var(--accent-green)' : latest >= 30 ? 'var(--accent-orange)' : 'var(--accent-red)';
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color }}>
        {t('perf.fpsCurrent', { value: latest })}
      </div>
      <Sparkline values={samples.map((s) => s.value)} color={color} min={0} max={60} />
    </div>
  );
}

function MemoryView({ samples, t }: { samples: PerfMemoryEvent[]; t: TFunc }): React.ReactElement {
  if (samples.length === 0) {
    return <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('perf.noMemory')}</div>;
  }
  const latest = samples[samples.length - 1];
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 4 }}>
        <span>
          <span style={{ color: 'var(--text-muted)' }}>{t('perf.memoryUsed')} </span>
          <span style={{ color: 'var(--accent-blue)' }}>{formatBytes(latest.usedJSHeapSize)}</span>
        </span>
        <span>
          <span style={{ color: 'var(--text-muted)' }}>{t('perf.memoryTotal')} </span>
          {formatBytes(latest.totalJSHeapSize)}
        </span>
        <span>
          <span style={{ color: 'var(--text-muted)' }}>{t('perf.memoryLimit')} </span>
          {formatBytes(latest.jsHeapSizeLimit)}
        </span>
      </div>
      <Sparkline values={samples.map((s) => s.usedJSHeapSize)} color="var(--accent-blue)" min={0} />
    </div>
  );
}
