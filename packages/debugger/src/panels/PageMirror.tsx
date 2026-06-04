import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';

// rrweb event type 2 = FullSnapshot
const FULL_SNAPSHOT_TYPE = 2;

export default function PageMirror(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<InstanceType<typeof Replayer> | null>(null);
  const processedCountRef = useRef(0);
  const hasFullSnapshotRef = useRef(false);
  // 用 state 驱动 overlay 显隐——ref 变化不会触发重渲染，必须用 state，
  // 否则即便镜像已初始化，绝对定位的 "Waiting" 遮罩仍会盖在镜像之上。
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    const events = rrwebEvents;
    if (events.length === 0) return;

    // Find first unprocessed events
    const newEvents = events.slice(processedCountRef.current);
    if (newEvents.length === 0) return;

    for (const event of newEvents) {
      const ev = event as { type?: number };

      if (!hasFullSnapshotRef.current) {
        // Wait for FullSnapshot to init Replayer
        if (ev.type === FULL_SNAPSHOT_TYPE) {
          hasFullSnapshotRef.current = true;
          if (!containerRef.current) continue;

          // Destroy previous replayer if any
          if (replayerRef.current) {
            try { replayerRef.current.destroy?.(); } catch { /* ignore */ }
            replayerRef.current = null;
            containerRef.current.innerHTML = '';
          }

          // Init with all events up to and including this one
          const initEvents = events.slice(0, processedCountRef.current + newEvents.indexOf(event) + 1);
          try {
            replayerRef.current = new Replayer(initEvents, {
              root: containerRef.current,
              liveMode: true,
              skipInactive: false,
              showWarning: false,
              showDebug: false,
              blockClass: '__rrweb_noop__',
            });
            // live 模式需从基线时间戳开始播放
            const baseTs = (initEvents[0] as { timestamp?: number })?.timestamp;
            replayerRef.current.startLive?.(baseTs);
            setReady(true);
          } catch (e) {
            console.warn('[PageMirror] Replayer init error:', e);
          }
        }
      } else if (replayerRef.current) {
        // Add subsequent events
        try {
          replayerRef.current.addEvent(event);
        } catch (e) {
          console.warn('[PageMirror] addEvent error:', e);
        }
      }
    }

    processedCountRef.current = events.length;
  }, [rrwebEvents]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { replayerRef.current?.destroy?.(); } catch { /* ignore */ }
    };
  }, []);

  const systemInfo = useStore((s) => s.systemInfo);
  const vp = systemInfo?.viewport;

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', background: '#1a1a1a' }}>
      {!ready && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8,
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          <span style={{ fontSize: 32 }}>⬜</span>
          <span>Waiting for page snapshot…</span>
          {vp && <span style={{ fontSize: 11 }}>{vp.width}×{vp.height}</span>}
        </div>
      )}
      {/* Scale wrapper */}
      <ScaleContainer vpWidth={vp?.width} vpHeight={vp?.height}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </ScaleContainer>
    </div>
  );
}

function ScaleContainer({
  children,
  vpWidth,
  vpHeight,
}: {
  children: React.ReactNode;
  vpWidth?: number;
  vpHeight?: number;
}): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  useEffect(() => {
    if (!wrapRef.current || !vpWidth || !vpHeight) return;

    const obs = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scaleX = width / vpWidth;
      const scaleY = height / vpHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    });

    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [vpWidth, vpHeight]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <div style={{
        transformOrigin: 'top left',
        transform: `scale(${scale})`,
        width: vpWidth ? `${vpWidth}px` : '100%',
        height: vpHeight ? `${vpHeight}px` : '100%',
      }}>
        {children}
      </div>
    </div>
  );
}
