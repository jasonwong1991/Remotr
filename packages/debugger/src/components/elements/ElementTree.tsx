import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';

// rrweb node types
const NODE_TYPE = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  Comment: 5,
} as const;

interface RrwebNode {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, string | number | boolean | null>;
  textContent?: string;
  childNodes?: RrwebNode[];
  name?: string; // DocumentType
  publicId?: string;
  systemId?: string;
  isSVG?: boolean;
}

function attrString(attrs?: Record<string, string | number | boolean | null>): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter(([k]) => !k.startsWith('_'))
    .slice(0, 5)
    .map(([k, v]) => `${k}="${String(v ?? '').slice(0, 40)}"`)
    .join(' ');
}

/** Find the chain of node IDs from root down to `targetId` (inclusive). */
function findPath(node: RrwebNode, targetId: number, acc: number[]): number[] | null {
  if (node.id === targetId) return [...acc, node.id];
  for (const child of node.childNodes ?? []) {
    const found = findPath(child, targetId, [...acc, node.id]);
    if (found) return found;
  }
  return null;
}

interface DomNodeProps {
  node: RrwebNode;
  depth: number;
  expandedIds: Set<number>;
  toggle: (id: number) => void;
  selectedNodeId: number | null;
  setSelectedNode: (id: number) => void;
  selectedRef: React.RefObject<HTMLSpanElement>;
}

function DomNode({
  node,
  depth,
  expandedIds,
  toggle,
  selectedNodeId,
  setSelectedNode,
  selectedRef,
}: DomNodeProps): React.ReactElement {
  if (node.type === NODE_TYPE.Text) {
    const text = (node.textContent ?? '').trim();
    if (!text) return <></>;
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--accent-orange)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {text.slice(0, 120)}
      </div>
    );
  }

  if (node.type === NODE_TYPE.Document) {
    return (
      <div>
        {(node.childNodes ?? []).map((c) => (
          <DomNode
            key={c.id}
            node={c}
            depth={depth}
            expandedIds={expandedIds}
            toggle={toggle}
            selectedNodeId={selectedNodeId}
            setSelectedNode={setSelectedNode}
            selectedRef={selectedRef}
          />
        ))}
      </div>
    );
  }

  if (node.type === NODE_TYPE.DocumentType) {
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {'<!DOCTYPE html>'}
      </div>
    );
  }

  if (node.type !== NODE_TYPE.Element) return <></>;

  const tag = node.tagName?.toLowerCase() ?? 'unknown';
  const attrs = attrString(node.attributes);
  const hasChildren = (node.childNodes ?? []).length > 0;
  const isSelected = selectedNodeId === node.id;
  const expanded = expandedIds.has(node.id);

  return (
    <div style={{ paddingLeft: depth * 12, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <span
        ref={isSelected ? selectedRef : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) toggle(node.id);
          setSelectedNode(node.id);
        }}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          background: isSelected ? 'var(--accent-blue)' : 'transparent',
          color: isSelected ? '#fff' : undefined,
          padding: '2px 4px',
          borderRadius: 2,
        }}
      >
        {hasChildren && (
          <span style={{ color: isSelected ? '#fff' : 'var(--text-muted)', fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        )}
        <span style={{ color: isSelected ? '#fff' : 'var(--accent-blue)' }}>{'<'}{tag}</span>
        {attrs && <span style={{ color: isSelected ? '#fff' : 'var(--accent-yellow)' }}> {attrs}</span>}
        {!hasChildren && <span style={{ color: isSelected ? '#fff' : 'var(--accent-blue)' }}>{' />'}</span>}
        {hasChildren && !expanded && (
          <span style={{ color: isSelected ? '#fff' : 'var(--accent-blue)' }}>{'>'}<span style={{ color: isSelected ? '#fff' : 'var(--text-muted)' }}>…</span>{'</'}{tag}{'>'}</span>
        )}
        {hasChildren && expanded && <span style={{ color: isSelected ? '#fff' : 'var(--accent-blue)' }}>{'>'}</span>}
      </span>
      {expanded && hasChildren && (
        <>
          {(node.childNodes ?? []).map((c) => (
            <DomNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggle={toggle}
              selectedNodeId={selectedNodeId}
              setSelectedNode={setSelectedNode}
              selectedRef={selectedRef}
            />
          ))}
          <div style={{ paddingLeft: 0 }}>
            <span style={{ color: 'var(--accent-blue)' }}>{'</'}{tag}{'>'}</span>
          </div>
        </>
      )}
    </div>
  );
}

interface ElementTreeProps {
  rootNode: RrwebNode | null;
}

export default function ElementTree({ rootNode }: ElementTreeProps): React.ReactElement {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  // Collapsed by default — only the explicitly expanded ids are open.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const selectedRef = useRef<HTMLSpanElement>(null);

  const toggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // When a node is selected externally (picker), expand the path to it.
  const pathToSelected = useMemo(() => {
    if (rootNode == null || selectedNodeId == null) return null;
    return findPath(rootNode, selectedNodeId, []);
  }, [rootNode, selectedNodeId]);

  useEffect(() => {
    if (!pathToSelected) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      // Expand all ancestors (exclude the selected leaf itself).
      for (let i = 0; i < pathToSelected.length - 1; i++) {
        next.add(pathToSelected[i]);
      }
      return next;
    });
  }, [pathToSelected]);

  // Scroll the selected node into view once it's rendered.
  useEffect(() => {
    if (selectedNodeId == null) return;
    const t = setTimeout(() => {
      selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(t);
  }, [selectedNodeId, expandedIds]);

  if (!rootNode) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', fontSize: 13,
      }}>
        Waiting for DOM snapshot…
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '8px 4px' }}>
      <DomNode
        node={rootNode}
        depth={0}
        expandedIds={expandedIds}
        toggle={toggle}
        selectedNodeId={selectedNodeId}
        setSelectedNode={setSelectedNode}
        selectedRef={selectedRef}
      />
    </div>
  );
}

export type { RrwebNode };
