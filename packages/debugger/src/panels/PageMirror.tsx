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
      console.log('[PageMirror Picker] Inactive - pickerActive:', pickerActive, 'ready:', ready, 'replayer:', !!replayerRef.current);
      updateOverlay(null);
      hoveredElementRef.current = null;
      return;
    }

    const iframe = replayerRef.current.iframe;
    const container = containerRef.current;

    console.log('[PageMirror Picker] Initializing picker...');
    console.log('[PageMirror Picker] iframe exists:', !!iframe);
    console.log('[PageMirror Picker] iframe.contentDocument exists:', !!iframe?.contentDocument);
    console.log('[PageMirror Picker] container exists:', !!container);

    if (!iframe || !iframe.contentDocument || !container) {
      console.warn('[PageMirror Picker] Missing required elements - iframe:', !!iframe, 'contentDocument:', !!iframe?.contentDocument, 'container:', !!container);
      return;
    }

    const doc = iframe.contentDocument;
    console.log('[PageMirror Picker] doc.body exists:', !!doc.body);

    // Get iframe position relative to container
  const getIframeRect = () => {
      const iframeRect = iframe.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        left: iframeRect.left - containerRect.left,
        top: iframeRect.top - containerRect.top,
        width: iframeRect.width,
        height: iframeRect.height,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      console.log('[PageMirror Picker] mousemove event fired - clientX:', e.clientX, 'clientY:', e.clientY);

      const containerRect = container.getBoundingClientRect();
      const iframeRect = getIframeRect();

      // Calculate coordinates relative to container
      const containerX = e.clientX - containerRect.left;
      const containerY = e.clientY - containerRect.top;

      console.log('[PageMirror Picker] Container coords:', containerX, containerY);
      console.log('[PageMirror Picker] Iframe rect:', iframeRect);

      // Calculate coordinates relative to iframe
      const iframeX = containerX - iframeRect.left;
    const iframeY = containerY - iframeRect.top;

      console.log('[PageMirror Picker] Iframe coords:', iframeX, iframeY);

      // Check if inside iframe bounds
      if (iframeX < 0 || iframeY < 0 || iframeX > iframeRect.width || iframeY > iframeRect.height) {
        console.log('[PageMirror Picker] Outside iframe bounds');
        updateOverlay(null);
        hoveredElementRef.current = null;
        return;
      }

      const target = doc.elementFromPoint(iframeX, iframeY);
      console.log('[PageMirror Picker] elementFromPoint returned:', target?.tagName, target);

      if (target && target !== hoveredElementRef.current) {
        console.log('[PageMirror Picker] New hover target:', target.tagName, target.className);
        hoveredElementRef.current = target;
        updateOverlay(target);
      }
    };

    const onClick = (e: MouseEvent) => {
      console.log('[PageMirror Picker] click event fired');
      e.preventDefault();
      e.stopPropagation();

      const containerRect = container.getBoundingClientRect();
      const iframeRect = getIframeRect();

      const containerX = e.clientX - containerRect.left;
      const containerY = e.clientY - containerRect.top;
      const iframeX = containerX - iframeRect.left;
      const iframeY = containerY - iframeRect.top;

      console.log('[PageMirror Picker] Click at iframe coords:', iframeX, iframeY);

      const target = doc.elementFromPoint(iframeX, iframeY);
      console.log('[PageMirror Picker] Click target:', target?.tagName, target);

      if (!target) {
        console.warn('[PageMirror Picker] No target found at click position');
        return;
      }

      // Get rrweb node ID from the replayer's mirror
      const mirror = (replayerRef.current as any)?.getMirror?.();
      console.log('[PageMirror Picker] Mirror exists:', !!mirror, 'getId exists:', !!mirror?.getId);

      if (!mirror || !mirror.getId) {
        console.warn('[PageMirror Picker] Replayer mirror not available');
        return;
      }

      const nodeId = mirror.getId(target);
      console.log('[PageMirror Picker] Element rrweb nodeId:', nodeId);

      if (nodeId && nodeId !== -1) {
        console.log('[PageMirror Picker] ✓ Picked element with rrweb ID:', nodeId, target.tagName);
        setSelectedNode(nodeId);
        useStore.getState().setPickerActive(false);
    } else {
        console.warn('[PageMirror Picker] Invalid nodeId:', nodeId);
      }
    };

    // Attach to container, not iframe
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick, true);
    container.style.cursor = 'crosshair';

    console.log('[PageMirror Picker] ✓ Events attached to container');

    return () => {
      console.log('[PageMirror Picker] Cleanup - removing events');
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick, true);
      container.style.cursor = '';
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
