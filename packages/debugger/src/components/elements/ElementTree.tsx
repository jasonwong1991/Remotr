import React, { useState } from 'react';
import { useStore } from '../../store';
import { sendCommand } from '../../ws';

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

function DomNode({ node, depth = 0 }: { node: RrwebNode; depth?: number }): React.ReactElement {
  const [expanded, setExpanded] = useState(depth < 2);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  if (node.type === NODE_TYPE.Text) {
    const text = (node.textContent ?? '').trim();
    if (!text) return <></>;
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--accent-orange)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {text.slice(0, 120)}
      </div>
    );
  }

  if (node.type === NODE_TYPE.Document) {
    return (
      <div>
        {(node.childNodes ?? []).map((c) => (
          <DomNode key={c.id} node={c} depth={depth} />
        ))}
      </div>
    );
  }

  if (node.type === NODE_TYPE.DocumentType) {
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {'<!DOCTYPE html>'}
      </div>
    );
  }

  if (node.type !== NODE_TYPE.Element) return <></>;

  const tag = node.tagName?.toLowerCase() ?? 'unknown';
  const attrs = attrString(node.attributes);
  const hasChildren = (node.childNodes ?? []).length > 0;
  const isSelected = selectedNodeId === node.id;

  return (
    <div style={{ paddingLeft: depth * 12, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) setExpanded((v) => !v);
          setSelectedNode(node.id);
        }}
        onMouseEnter={() => {
          sendCommand('elements.highlight', { nodeId: node.id }).catch(() => {
            // Ignore highlight errors
          });
        }}
        onMouseLeave={() => {
        sendCommand('elements.highlight', { nodeId: null }).catch(() => {
            // Ignore highlight errors
          });
        }}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          background: isSelected ? 'var(--accent-blue-transparent)' : 'transparent',
          padding: '2px 4px',
          borderRadius: 2,
        }}
      >
        {hasChildren && (
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{expanded ? '▾' : '▸'}</span>
        )}
        <span style={{ color: 'var(--accent-blue)' }}>{'<'}{tag}</span>
      {attrs && <span style={{ color: 'var(--accent-yellow)' }}> {attrs}</span>}
      {!hasChildren && <span style={{ color: 'var(--accent-blue)'}}>{' />'}</span>}
        {hasChildren && !expanded && (
          <span style={{ color: 'var(--accent-blue)' }}>{'>'}<span style={{ color: 'var(--text-muted)' }}>…</span>{'</'}{tag}{'>'}</span>
        )}
        {hasChildren && expanded && <span style={{ color: 'var(--accent-blue)' }}>{'>'}</span>}
      </span>
      {expanded && hasChildren && (
        <>
        {(node.childNodes ?? []).map((c) => (
            <DomNode key={c.id} node={c} depth={depth + 1} />
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
      <DomNode node={rootNode} depth={0} />
    </div>
  );
}

export type { RrwebNode };
