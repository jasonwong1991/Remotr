import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import ElementTree from '../components/elements/ElementTree';
import StylesPane from '../components/elements/StylesPane';
import BoxModelPane from '../components/elements/BoxModelPane';
import EditableStylesPane from '../components/elements/EditableStylesPane';
import PickerButton from '../components/elements/PickerButton';
import { sendCommand } from '../ws';
import type { RrwebNode } from '../components/elements/ElementTree';
import type { BoxModel, CSSRule } from '@remotr/shared';
import type { LoadStatus } from '../components/elements/StylesPane';

interface RrwebSnapshot {
  type: number;
  data: { node: RrwebNode; initialOffset?: { top: number; left: number } };
}

function parseFullSnapshot(events: unknown[]): RrwebNode | null {
  for (const ev of events) {
    const e = ev as { type?: number; data?: { node?: RrwebNode } };
    if (e.type === 2 && e.data?.node) return e.data.node;
  }
  return null;
}

export default function ElementsPanel(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedElementData = useStore((s) => s.selectedElementData);
  const setElementData = useStore((s) => s.setElementData);
  const rootNode = useMemo(() => parseFullSnapshot(rrwebEvents), [rrwebEvents]);
  const [inspectorTab, setInspectorTab] = useState<'computed' | 'boxModel' | 'styles'>('styles');
  const [boxModel, setBoxModel] = useState<BoxModel | null>(null);
  const [rulesResult, setRulesResult] = useState<{ inlineStyles: Record<string, string>; rules: CSSRule[] } | null>(null);
  const [computedStatus, setComputedStatus] = useState<LoadStatus>('idle');
  const [rulesStatus, setRulesStatus] = useState<LoadStatus>('idle');
  const [computedError, setComputedError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [leftWidth, setLeftWidth] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.max(20, Math.min(80, pct)));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const fetchData = useCallback(() => {
    if (selectedNodeId === null) {
      setElementData({ computedStyles: null });
      setBoxModel(null);
      setRulesResult(null);
      setComputedStatus('idle');
      setRulesStatus('idle');
      return;
    }
    const reqId = ++requestIdRef.current;
    setComputedStatus('loading');
    setRulesStatus('loading');
    setComputedError(null);
    setRulesError(null);

    sendCommand('elements.getComputedStyles', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
        if (reply.error) {
          setComputedError(reply.error);
          setComputedStatus('error');
          setElementData({ computedStyles: null });
        } else {
          const result = reply.result as { styles: Record<string, string> };
          setElementData({ computedStyles: result.styles });
          setComputedStatus('success');
        }
      })
      .catch((err) => {
        if (reqId !== requestIdRef.current) return;
        setComputedError(err instanceof Error ? err.message : 'Failed to fetch computed styles');
        setComputedStatus('error');
     setElementData({ computedStyles: null });
      });

    sendCommand('elements.getBoxModel', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
        if (reply.error) {
          setBoxModel(null);
        } else {
        const result = reply.result as { boxModel: BoxModel };
          setBoxModel(result.boxModel);
        }
      })
      .catch(() => {
        if (reqId !== requestIdRef.current) return;
        setBoxModel(null);
      });

    sendCommand('elements.getMatchedRules', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
        if (reply.error) {
          setRulesError(reply.error);
          setRulesStatus('error');
          setRulesResult(null);
        } else {
          const result = reply.result as { inlineStyles: Record<string, string>; rules: CSSRule[] };
          setRulesResult({ inlineStyles: result.inlineStyles, rules: result.rules });
          setRulesStatus('success');
        }
      })
      .catch((err) => {
    if (reqId !== requestIdRef.current) return;
        setRulesError(err instanceof Error ? err.message : 'Failed to fetch matched rules');
        setRulesStatus('error');
        setRulesResult(null);
      });
  }, [selectedNodeId, setElementData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStyleSaved = useCallback(() => {
    if (selectedNodeId === null) return;
    const reqId = ++requestIdRef.current;
    setComputedStatus('loading');
    setRulesStatus('loading');

    sendCommand('elements.getComputedStyles', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
        if (!reply.error) {
        const result = reply.result as { styles: Record<string, string> };
       setElementData({ computedStyles: result.styles });
          setComputedStatus('success');
        }
      })
      .catch(() => {});

    sendCommand('elements.getMatchedRules', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reqId !== requestIdRef.current) return;
      if (!reply.error) {
          const result = reply.result as { inlineStyles: Record<string, string>; rules: CSSRule[] };
          setRulesResult({ inlineStyles: result.inlineStyles, rules: result.rules });
          setRulesStatus('success');
        }
   })
      .catch(() => {});
  }, [selectedNodeId, setElementData]);

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <PickerButton />
      </div>
      <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: `${leftWidth}%`, height: '100%', overflow: 'hidden' }}><ElementTree rootNode={rootNode} /></div>
        <div onMouseDown={onMouseDown} style={{ width: 4, cursor: 'col-resize', background: 'var(--border)', flexShrink: 0 }} />
        <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['styles', 'computed', 'boxModel'] as const).map((tab) => (
        <button key={tab} onClick={() => setInspectorTab(tab)} style={{ border: 'none', borderBottom: inspectorTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent', borderRadius: 0, background: inspectorTab === tab ? 'var(--bg-primary)' : 'transparent', color: inspectorTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)', padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>
            {tab === 'styles' ? 'Styles' : tab === 'computed' ? 'Computed' : 'Box Model'}
           </button>
            ))}
          </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
          {inspectorTab === 'styles' && <EditableStylesPane inlineStyles={rulesResult?.inlineStyles ?? null} rules={rulesResult?.rules ?? null} nodeId={selectedNodeId} status={rulesStatus} error={rulesError} onRetry={fetchData} onStyleSaved={handleStyleSaved} />}
         {inspectorTab === 'computed' && <StylesPane styles={selectedElementData?.computedStyles ?? null} nodeId={selectedNodeId} status={computedStatus} error={computedError} onRetry={fetchData} onStyleSaved={handleStyleSaved} onStyleError={setComputedError} />}
         {inspectorTab === 'boxModel' && <BoxModelPane boxModel={boxModel} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { RrwebSnapshot };
