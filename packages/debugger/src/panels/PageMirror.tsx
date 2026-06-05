import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';

// rrweb event type 2 = FullSnapshot
const FULL_SNAPSHOT_TYPE = 2;

export default function PageMirror(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const pickerActive = useStore((s) => s.pickerActive);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<InstanceType<typeof Replayer> | null>(null);
  const processedCountRef = useRef(0);
  const hasFullSnapshotRef = useRef(false);
  const [ready, setReady] = React.useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hoveredElementRef = useRef<Element | null>(null);

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

  // Picker overlay styling
  const updateOverlay = React.useCallback((element: Element | null) => {
    if (!overlayRef.current) return;

    if (!element) {
      overlayRef.current.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return;

    overlayRef.current.style.display = 'block';
    overlayRef.current.style.left = `${rect.left - container.left}px`;
    overlayRef.current.style.top = `${rect.top - container.top}px`;
    overlayRef.current.style.width = `${rect.width}px`;
    overlayRef.current.style.height = `${rect.height}px`;
  }, []);

  // Picker event handlers
  useEffect(() => {
    if (!pickerActive || !ready || !replayerRef.current) {
      updateOverlay(null);
      hoveredElementRef.current = null;
      return;
    }

    const iframe = replayerRef.current.iframe;
    if (!iframe || !iframe.contentDocument) {
      console.warn('[PageMirror] Picker active but no iframe found');
      return;
    }

    const doc = iframe.contentDocument;

    const onMouseMove = (e: MouseEvent) => {
      const target = doc.elementFromPoint(e.clientX, e.clientY);
      if (target && target !== hoveredElementRef.current) {
        hoveredElementRef.current = target;
        updateOverlay(target);
      }
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const target = doc.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;

      // Get rrweb node ID from the replayer's mirror
      const mirror = (replayerRef.current as any)?.getMirror?.();
      if (!mirror || !mirror.getId) {
        console.warn('[PageMirror] Replayer mirror not available');
        return;
      }

      const nodeId = mirror.getId(target);
      if (nodeId && nodeId !== -1) {
        console.log('[PageMirror] Picked element with rrweb ID:', nodeId);
        setSelectedNode(nodeId);
        useStore.getState().setPickerActive(false);
      }
    };

    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('click', onClick, true);
    doc.body.style.cursor = 'crosshair';

    console.log('[PageMirror] Picker events attached to replayer iframe');

    return () => {
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('click', onClick, true);
      doc.body.style.cursor = '';
      updateOverlay(null);
      hoveredElementRef.current = null;
    };
  }, [pickerActive, ready, updateOverlay, setSelectedNode]);

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
            fontSize: 14,
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: 32 }}>⬜</span>
          <span>Waiting for page snapshot…</span>
          {vp && <span style={{ fontSize: 12 }}>{vp.width}×{vp.height}</span>}
        </div>
      )}
      <ScaleContainer vpWidth={vp?.width} vpHeight={vp?.height}>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative'
          }}
        >
          {/* Picker overlay */}
          <div
            ref={overlayRef}
            style={{
              position: 'absolute',
              display: 'none',
              pointerEvents: 'none',
              border: '2px solid var(--accent-blue)',
              background: 'rgba(79, 195, 247, 0.1)',
              zIndex: 999999,
              transition: 'all 100ms ease',
            }}
          />
        </div>
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
