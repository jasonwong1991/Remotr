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
  const [ready, setReady] = React.useState(false);

  const resetReplayer = React.useCallback(() => {
    try {
      replayerRef.current?.destroy?.();
    } catch {
      // ignore
    }
    replayerRef.current = null;
    processedCountRef.current = 0;
    hasFullSnapshotRef.current = false;
    setReady(false);
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
  }, []);

  useEffect(() => {
    const events = rrwebEvents;
    if (events.length === 0) {
      resetReplayer();
      return;
    }

    const newEvents = events.slice(processedCountRef.current);
    if (newEvents.length === 0) return;

    for (const event of newEvents) {
      const ev = event as { type?: number };

      if (!hasFullSnapshotRef.current) {
        if (ev.type === FULL_SNAPSHOT_TYPE) {
          hasFullSnapshotRef.current = true;
          if (!containerRef.current) continue;

          if (replayerRef.current) {
            try {
              replayerRef.current.destroy?.();
            } catch {
              // ignore
            }
            replayerRef.current = null;
            containerRef.current.innerHTML = '';
          }

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
            const baseTs = (initEvents[0] as { timestamp?: number })?.timestamp;
            replayerRef.current.startLive?.(baseTs);
            setReady(true);
          } catch (e) {
            console.warn('[PageMirror] Replayer init error:', e);
          }
        }
      } else if (replayerRef.current) {
        try {
          replayerRef.current.addEvent(event);
        } catch (e) {
          console.warn('[PageMirror] addEvent error:', e);
        }
      }
    }

    processedCountRef.current = events.length;
  }, [resetReplayer, rrwebEvents]);

  useEffect(() => resetReplayer, [resetReplayer]);

  const systemInfo = useStore((s) => s.systemInfo);
  const vp = systemInfo?.viewport;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        position: 'relative',
        background: 'var(--mirror-bg)',
      }}
    >
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--text-muted)',
            fontSize: 13,
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: 32 }}>⬜</span>
          <span>Waiting for page snapshot…</span>
          {vp && <span style={{ fontSize: 11 }}>{vp.width}×{vp.height}</span>}
        </div>
      )}
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
      const padding = 24;
      const scaleX = Math.max(0, width - padding) / vpWidth;
      const scaleY = Math.max(0, height - padding) / vpHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    });

    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [vpWidth, vpHeight]);

  const shellWidth = vpWidth ? vpWidth * scale : undefined;
  const shellHeight = vpHeight ? vpHeight * scale : undefined;

  return (
    <div
      ref={wrapRef}
      style={{
        width: '100%',
        height: '100%',
        minWidth: shellWidth ? `${shellWidth}px` : '100%',
        minHeight: shellHeight ? `${shellHeight}px` : '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        style={{
          width: shellWidth ? `${shellWidth}px` : '100%',
          height: shellHeight ? `${shellHeight}px` : '100%',
          flex: '0 0 auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            width: vpWidth ? `${vpWidth}px` : '100%',
            height: vpHeight ? `${vpHeight}px` : '100%',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
