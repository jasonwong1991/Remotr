import React, { useState } from 'react';
import type { SpyAtom } from '@remotr/shared';

interface Props {
  atom: SpyAtom;
  depth?: number;
}

const MAX_INLINE_DEPTH = 2;

function getColor(type: SpyAtom['type']): string {
  switch (type) {
    case 'string': return '#ce9178';
    case 'number': return '#b5cea8';
    case 'boolean': return '#569cd6';
    case 'null':
    case 'undefined': return '#858585';
    case 'error': return '#f44747';
    case 'date': return '#4fc3f7';
    default: return '#d4d4d4';
  }
}

export function SpyAtomView({ atom, depth = 0 }: Props): React.ReactElement {
  // 对象/数组默认收起，避免日志一打印就铺开一大片；点击展开。
  const [expanded, setExpanded] = useState(false);

  const hasChildren = (atom.type === 'object' || atom.type === 'array' || atom.type === 'error') &&
    atom.children != null && atom.children.length > 0;

  if (!hasChildren) {
    return (
      <span style={{ color: getColor(atom.type), fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {atom.type === 'string' ? `"${atom.display}"` : atom.display}
        {atom.circular ? <span style={{ color: '#858585' }}> [Circular]</span> : null}
        {atom.truncated ? <span style={{ color: '#858585' }}> …</span> : null}
      </span>
    );
  }

  const isArray = atom.type === 'array';
  const openBrace = isArray ? '[' : '{';
  const closeBrace = isArray ? ']' : '}';
  const indent = '  '.repeat(depth + 1);

  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <span
        onClick={() => setExpanded((v) => !v)}
        style={{ cursor: 'pointer', userSelect: 'none', color: '#d4d4d4' }}
      >
        <span style={{ color: '#858585', fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        {!expanded && (
          <span style={{ color: '#858585' }}> {atom.display}</span>
        )}
      </span>
      {expanded && (
        <>
          <span style={{ color: '#d4d4d4' }}>{openBrace}</span>
          {atom.children!.map((entry) => (
            <div key={entry.key} style={{ paddingLeft: 16 }}>
              <span style={{ color: '#9cdcfe' }}>{indent}{entry.key}</span>
              <span style={{ color: '#d4d4d4' }}>: </span>
              <SpyAtomView atom={entry.value} depth={depth + 1} />
              {depth < MAX_INLINE_DEPTH ? ',' : ''}
            </div>
          ))}
          {atom.truncated && (
            <div style={{ paddingLeft: 16, color: '#858585' }}>{indent}…</div>
          )}
          <span style={{ color: '#d4d4d4' }}>{closeBrace}</span>
        </>
      )}
    </span>
  );
}
