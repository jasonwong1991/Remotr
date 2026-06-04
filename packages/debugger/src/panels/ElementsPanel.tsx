import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import ElementTree from '../components/elements/ElementTree';
import StylesPane from '../components/elements/StylesPane';
import BoxModelPane from '../components/elements/BoxModelPane';
import RulesPane from '../components/elements/RulesPane';
import PickerButton from '../components/elements/PickerButton';
import { sendCommand } from '../ws';
import type { RrwebNode } from '../components/elements/ElementTree';
import type { BoxModel, CSSRule } from '@remotr/shared';

interface RrwebSnapshot {
  type: number; // 2 = FullSnapshot
  data: {
    node: RrwebNode;
    initialOffset?: { top: number; left: number };
  };
}

function parseFullSnapshot(events: unknown[]): RrwebNode | null {
  for (const ev of events) {
    const e = ev as { type?: number; data?: { node?: RrwebNode } };
    if (e.type === 2 && e.data?.node) {
      return e.data.node;
    }
  }
  return null;
}

export default function ElementsPanel(): React.ReactElement {
  const rrwebEvents = useStore((s) => s.rrwebEvents);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedElementData = useStore((s) => s.selectedElementData);
  const setElementData = useStore((s) => s.setElementData);

  const rootNode = useMemo(() => parseFullSnapshot(rrwebEvents), [rrwebEvents]);

  // Inspector sub-tab
  const [inspectorTab, setInspectorTab] = useState<'computed' | 'boxModel' | 'rules'>('computed');

  // Local state for box model and rules (avoids store schema changes)
  const [boxModel, setBoxModel] = useState<BoxModel | null>(null);
  const [rulesResult, setRulesResult] = useState<{ inlineStyles: Record<string, string>; rules: CSSRule[] } | null>(null);

  // Draggable split
  const [leftWidth, setLeftWidth] = useState(50); // percent
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

  // Fetch computed styles, box model, and matched rules when selection changes
  useEffect(() => {
    if (selectedNodeId === null) {
      setElementData({ computedStyles: null });
      setBoxModel(null);
      setRulesResult(null);
      return;
    }

    // Fetch computed styles
    sendCommand('elements.getComputedStyles', { nodeId: selectedNodeId })
      .then((reply) => {
      if (reply.error) {
          console.warn('Failed to get computed styles:', reply.error);
        setElementData({ computedStyles: null });
        } else {
        const result = reply.result as { styles: Record<string, string> };
          setElementData({ computedStyles: result.styles });
        }
      })
      .catch((err) => {
        console.warn('Error fetching computed styles:', err);
        setElementData({ computedStyles: null });
      });

    // Fetch box model
    sendCommand('elements.getBoxModel', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reply.error) {
      console.warn('Failed to get box model:', reply.error);
       setBoxModel(null);
        } else {
       const result = reply.result as { boxModel: BoxModel };
          setBoxModel(result.boxModel);
        }
      })
      .catch((err) => {
        console.warn('Error fetching box model:', err);
        setBoxModel(null);
      });

    // Fetch matched rules
    sendCommand('elements.getMatchedRules', { nodeId: selectedNodeId })
      .then((reply) => {
        if (reply.error) {
       console.warn('Failed to get matched rules:', reply.error);
          setRulesResult(null);
        } else {
          const result = reply.result as { inlineStyles: Record<string, string>; rules: CSSRule[] };
          setRulesResult({ inlineStyles: result.inlineStyles, rules: result.rules });
        }
      })
      .catch((err) => {
      console.warn('Error fetching matched rules:', err);
        setRulesResult(null);
      });
  }, [selectedNodeId, setElementData]);

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
    flexShrink: 0,
      }}>
        <PickerButton />
      </div>

    {/* Main content */}
      <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left pane: ElementTree */}
        <div style={{ width: `${leftWidth}%`, height: '100%', overflow: 'hidden' }}>
          <ElementTree rootNode={rootNode} />
        </div>

        {/* Divider */}
    <div
          onMouseDown={onMouseDown}
          style={{
            width: 4,
         cursor: 'col-resize',
            background: 'var(--border)',
            flexShrink: 0,
          }}
        />

        {/* Right pane: Inspector with sub-tabs */}
        <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Sub-tab bar */}
        <div style={{
         display: 'flex',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
         flexShrink: 0,
          }}>
            {(['computed', 'boxModel', 'rules'] as const).map((tab) => (
          <button
                key={tab}
                onClick={() => setInspectorTab(tab)}
            style={{
            border: 'none',
                borderBottom: inspectorTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
               borderRadius: 0,
                background: inspectorTab === tab ? 'var(--bg-primary)' : 'transparent',
                  color: inspectorTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
          padding: '6px 14px',
                cursor: 'pointer',
                  fontSize: 12,
            }}
            >
              {tab === 'computed' ? 'Computed' : tab === 'boxModel' ? 'Box Model' : 'Rules'}
          </button>
            ))}
          </div>

          {/* Sub-tab content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {inspectorTab === 'computed' && (
              <StylesPane styles={selectedElementData?.computedStyles ?? null} nodeId={selectedNodeId} />
            )}
            {inspectorTab === 'boxModel' && (
              <BoxModelPane boxModel={boxModel} />
            )}
            {inspectorTab === 'rules' && (
              <RulesPane
                inlineStyles={rulesResult?.inlineStyles ?? null}
         rules={rulesResult?.rules ?? null}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// suppress unused import warning
export type { RrwebSnapshot };
