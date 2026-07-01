import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';
import { buildDomTreeFromReplayer } from '../components/elements/domTree';
import { useT } from '../i18n';

// rrweb event type 2 = FullSnapshot
const FULL_SNAPSHOT_TYPE = 2;
// rrweb event type 3 = IncrementalSnapshot; data.source 0 = Mutation (node
// add/remove, attribute/style/text changes) — the only increments that alter
// the DOM tree shape and therefore warrant a tree rebuild.
const INCREMENTAL_SNAPSHOT_TYPE = 3;
const MUTATION_SOURCE = 0;

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export default function PageMirror(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const t = useT();
  const pickerActive = useStore((s) => s.pickerActive);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<InstanceType<typeof Replayer> | null>(null);
  const processedCountRef = useRef(0);
  const hasFullSnapshotRef = useRef(false);
  const treeRafRef = useRef<number | null>(null);
  const [ready, setReady] = React.useState(false);
  const [userZoom, setUserZoom] = React.useState(1);

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
    if (treeRafRef.current != null) {
      cancelAnimationFrame(treeRafRef.current);
      treeRafRef.current = null;
    }
    useStore.getState().setDomTree(null);
    setReady(false);
  }, []);

  /**
   * Publish the live Elements tree from the replayer's mirror. Coalesced into a
   * single rebuild per animation frame so bursts of mutations (or a remote page
   * animating) don't trigger a full DOM walk per event.
   */
  const scheduleTreePublish = React.useCallback(() => {
    if (treeRafRef.current != null) return;
    treeRafRef.current = requestAnimationFrame(() => {
      treeRafRef.current = null;
      useStore.getState().setDomTree(buildDomTreeFromReplayer(replayerRef.current));
    });
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

    // Whether this batch changed the DOM tree shape and warrants a rebuild.
    let structural = false;

    for (const event of newEvents) {
      const ev = event as { type?: number; data?: { source?: number } };

      if (ev.type === FULL_SNAPSHOT_TYPE) {
        structural = true;
      } else if (ev.type === INCREMENTAL_SNAPSHOT_TYPE && ev.data?.source === MUTATION_SOURCE) {
        structural = true;
      }

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
              // CRITICAL: must be false. rrweb's virtual-DOM optimization engages
              // the moment a mutation is applied in `isSync` mode, and only flushes
              // back to the real iframe when a later *non-sync* event arrives. The
              // far-future baseline below forces EVERY event to be sync, so that
              // flush never happens — mutations (e.g. hiding an element) would apply
              // to an invisible virtual DOM and never paint. Disabling it makes each
              // increment apply straight to the live iframe DOM, which also keeps the
              // Elements tree (walked from that DOM) in sync.
              useVirtualDom: false,
            });
            // rrweb liveMode schedules each incoming event through an internal
            // timer with `delay = event.timestamp - baselineTime`. If baseline
            // is the first event's timestamp, every later incremental event is
            // deferred by the full elapsed session time (seconds of lag).
            //
            // We never need wall-clock playback here — we want every increment
            // applied the instant it arrives. addEvent() applies synchronously
            // whenever `event.timestamp < baselineTime`, so we pin baseline to a
            // far-future constant. All real timestamps fall below it, making the
            // `isSync` path fire immediately (no timer scheduling, no lag).
            // (Date.now() is unavailable in this sandbox, hence the constant.)
            const FAR_FUTURE_BASELINE = 8.64e15; // max safe Date value (year 275760)
            replayerRef.current.startLive?.(FAR_FUTURE_BASELINE);
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

    // Rebuild the Elements tree once per batch when the DOM actually changed.
    if (structural) scheduleTreePublish();
  }, [resetReplayer, rrwebEvents, scheduleTreePublish]);

  useEffect(() => resetReplayer, [resetReplayer]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        position: 'relative',
        background: 'var(--mirror-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Zoom toolbar */}
      {ready && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            fontSize: 11,
            zIndex: 10,
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Zoom:</span>
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setUserZoom(level)}
              style={{
                background: userZoom === level ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
                color: userZoom === level ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                padding: '2px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {Math.round(level * 100)}%
            </button>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 10 }}>
            {vp && `${vp.width}×${vp.height}`}
          </span>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
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
          <span>{t('mirror.waiting')}</span>
          {vp && <span style={{ fontSize: 12 }}>{vp.width}×{vp.height}</span>}
        </div>
      )}
      <ScaleContainer
        vpWidth={vp?.width}
        vpHeight={vp?.height}
        scale={userZoom}
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
    </div>
  );
}

export function ScaleContainer({
  children,
  vpWidth,
  vpHeight,
  scale,
  onScale,
}: {
  children: React.ReactNode;
  vpWidth?: number;
  vpHeight?: number;
  scale: number;
  onScale: (scale: number) => void;
}): React.ReactElement {
  useEffect(() => {
    onScale(scale);
  }, [scale, onScale]);

  const shellWidth = vpWidth ? vpWidth * scale : undefined;
  const shellHeight = vpHeight ? vpHeight * scale : undefined;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minWidth: shellWidth ? `${shellWidth}px` : '100%',
        minHeight: shellHeight ? `${shellHeight}px` : '100%',
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      {/* Scaled stage: iframe + overlays share this transformed coordinate space */}
      <div
        style={{
          position: 'relative',
          width: shellWidth ? `${shellWidth}px` : '100%',
          height: shellHeight ? `${shellHeight}px` : '100%',
          margin: 'auto',
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
