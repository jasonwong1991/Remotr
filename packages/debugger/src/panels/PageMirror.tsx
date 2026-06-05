import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';

// rrweb event type 2 = FullSnapshot
const FULL_SNAPSHOT_TYPE = 2;

export default function PageMirror(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const pickerActive = useStore((s) => s.pickerActive);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<InstanceType<typeof Replayer> | null>(null);
  const processedCountRef = useRef(0);
  const hasFullSnapshotRef = useRef(false);
  const [ready, setReady] = React.useState(false);

  // Overlays live in the scaled space (siblings of the iframe), so their
  // coordinates use iframe-internal values multiplied by the current scale.
  const hoverOverlayRef = useRef<HTMLDivElement | null>(null);
  const selectOverlayRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);

  const systemInfo = useStore((s) => s.systemInfo);
  const vp = systemInfo?.viewport;

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
  }, []);

  /**
   * Position an overlay box over an iframe-internal element.
   * The overlays are siblings of the iframe INSIDE the scaled (transform:scale)
   * layer, so they share the iframe's unscaled coordinate space — the parent
   * transform scales them visually. Therefore we use the element's raw
   * iframe-internal rect with no scale multiplication.
   */
  const positionOverlay = React.useCallback(
    (overlay: HTMLDivElement | null, element: Element | null) => {
      if (!overlay) return;
      if (!element) {
        overlay.style.display = 'none';
        return;
      }
      const rect = element.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    },
    [],
  );

  // ── Picker: hover + click inside the replayer iframe ──────────────────────
  useEffect(() => {
    if (!pickerActive || !ready || !replayerRef.current) {
      positionOverlay(hoverOverlayRef.current, null);
      return;
    }

    const iframe = replayerRef.current.iframe;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    // Translate a viewport mouse coordinate into iframe-internal coordinates.
    // The iframe is rendered at `scale`, so divide the offset by scale.
    const toIframeCoords = (clientX: number, clientY: number) => {
      const iframeRect = iframe.getBoundingClientRect();
      const scale = scaleRef.current || 1;
      return {
        x: (clientX - iframeRect.left) / scale,
        y: (clientY - iframeRect.top) / scale,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = toIframeCoords(e.clientX, e.clientY);
      const target = doc.elementFromPoint(x, y);
      positionOverlay(hoverOverlayRef.current, target);
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = toIframeCoords(e.clientX, e.clientY);
      const target = doc.elementFromPoint(x, y);
      if (!target) return;

      const mirror = replayerRef.current?.getMirror?.();
      const nodeId = mirror?.getId(target as Node) ?? -1;
      if (nodeId && nodeId !== -1) {
        setSelectedNode(nodeId);
      }
      useStore.getState().setPickerActive(false);
    };

    // Listen on the wrapper (which contains the iframe) at capture phase so we
    // intercept before the replayed page can swallow the event.
    const wrapper = replayerRef.current.wrapper ?? iframe.parentElement ?? iframe;
    wrapper.addEventListener('mousemove', onMouseMove, true);
    wrapper.addEventListener('click', onClick, true);
    (wrapper as HTMLElement).style.cursor = 'crosshair';

    return () => {
      wrapper.removeEventListener('mousemove', onMouseMove, true);
      wrapper.removeEventListener('click', onClick, true);
      (wrapper as HTMLElement).style.cursor = '';
      positionOverlay(hoverOverlayRef.current, null);
    };
  }, [pickerActive, ready, positionOverlay, setSelectedNode]);

  // ── Reverse highlight: selected node (from tree/picker) → box in mirror ───
  useEffect(() => {
    if (!ready || !replayerRef.current || selectedNodeId == null) {
      positionOverlay(selectOverlayRef.current, null);
      return;
    }
    const mirror = replayerRef.current.getMirror?.();
    const node = mirror?.getNode(selectedNodeId) as Element | null;
    positionOverlay(selectOverlayRef.current, node ?? null);
  }, [selectedNodeId, ready, rrwebEvents, positionOverlay]);

  // ── Feed rrweb events into the Replayer ───────────────────────────────────
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
          }

          const initEvents = events.slice(0, processedCountRef.current + newEvents.indexOf(event) + 1);
          try {
            replayerRef.current = new Replayer(initEvents, {
              root: containerRef.current,
              liveMode: true,
              skipInactive: false,
              showWarning: false,
              showDebug: false,
              mouseTail: false,
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
      <ScaleContainer
        vpWidth={vp?.width}
        vpHeight={vp?.height}
        onScale={(s) => {
          scaleRef.current = s;
        }}
      >
        {/* rrweb mounts its iframe inside this node */}
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
        {/* Hover highlight (picker mode) */}
        <div
          ref={hoverOverlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'none',
            pointerEvents: 'none',
            border: '1px solid rgba(79, 195, 247, 0.9)',
            background: 'rgba(79, 195, 247, 0.25)',
            zIndex: 999998,
          }}
        />
        {/* Selected element highlight */}
        <div
          ref={selectOverlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'none',
            pointerEvents: 'none',
            outline: '2px solid var(--accent-orange)',
            background: 'rgba(255, 140, 0, 0.12)',
            zIndex: 999999,
          }}
        />
      </ScaleContainer>
    </div>
  );
}

function ScaleContainer({
  children,
  vpWidth,
  vpHeight,
  onScale,
}: {
  children: React.ReactNode;
  vpWidth?: number;
  vpHeight?: number;
  onScale: (scale: number) => void;
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
      const next = Math.min(scaleX, scaleY, 1);
      setScale(next);
      onScale(next);
    });

    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [vpWidth, vpHeight, onScale]);

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
      {/* Scaled stage: iframe + overlays share this transformed coordinate space */}
      <div
        style={{
          position: 'relative',
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
            position: 'relative',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
