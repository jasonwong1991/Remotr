import React from 'react';
import type { BoxModel } from '@remotr/shared';
import { useT } from '../../i18n';

interface BoxModelPaneProps {
  boxModel: BoxModel | null;
}

/**
 * Derive edge values (top, right, bottom, left) from two nested BoxQuads.
 * Each quad is [x, y, width, height] representing the outer rect of that layer.
 * Edge = difference between outer and inner rect on each side.
 */
function edgesFromQuads(
  outer: BoxModel['margin'],
  inner: BoxModel['margin'],
): [number, number, number, number] {
  const [ox, oy, ow, oh] = outer;
  const [ix, iy, iw, ih] = inner;
  const top = iy - oy;
  const left = ix - ox;
  const bottom = oh - ih - top;
  const right = ow - iw - left;
  return [top, right, bottom, left];
}

function formatEdges(edges: [number, number, number, number]): string {
  const [t, r, b, l] = edges.map((v) => Math.round(v));
  if (t === r && r === b && b === l) return String(t);
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function EdgeLabel({ label, edges }: { label: string; edges: [number, number, number, number] }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>
      <span style={{ color: 'var(--text-muted)', marginRight: 3 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{formatEdges(edges)}</span>
    </div>
  );
}

export default function BoxModelPane({ boxModel }: BoxModelPaneProps): React.ReactElement {
  const t = useT();
  if (boxModel === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}
      >
        {t('boxModel.loading')}
      </div>
    );
  }

  const marginEdges = edgesFromQuads(boxModel.margin, boxModel.border);
  const borderEdges = edgesFromQuads(boxModel.border, boxModel.padding);
  const paddingEdges = edgesFromQuads(boxModel.padding, boxModel.content);
  const [, , contentW, contentH] = boxModel.content;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 12px',
        overflowY: 'auto',
        height: '100%',
        gap: 12,
      }}
    >
      {/* Box model diagram */}
      <div style={{ width: '100%', maxWidth: 340 }}>
        {/* Margin layer */}
        <div
          style={{
            position: 'relative',
            background: '#1a3a4a',
            border: '1px solid #2a5a6a',
            padding: '20px 16px 8px',
          }}
        >
          {/* Margin label */}
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: 6,
              fontSize: 10,
              color: '#4fc3f7',
              fontWeight: 600,
              letterSpacing: '0.05em',
            }}
          >
            margin
          </div>
          <EdgeLabel label="" edges={marginEdges} />

          {/* Border layer */}
          <div
            style={{
              position: 'relative',
              background: '#3a3000',
              border: '1px solid #6a5500',
              padding: '20px 16px 8px',
              marginTop: 4,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 6,
                fontSize: 10,
                color: '#ffcc02',
                fontWeight: 600,
                letterSpacing: '0.05em',
              }}
            >
              border
            </div>
            <EdgeLabel label="" edges={borderEdges} />

            {/* Padding layer */}
            <div
              style={{
                position: 'relative',
                background: '#1a3a1a',
                border: '1px solid #2a5a2a',
                padding: '20px 16px 8px',
                marginTop: 4,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 6,
                  fontSize: 10,
                  color: '#4caf50',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                }}
              >
                padding
              </div>
              <EdgeLabel label="" edges={paddingEdges} />

              {/* Content layer */}
              <div
                style={{
                  background: '#0d2a4a',
                  border: '1px solid #1a4a7a',
                  marginTop: 4,
                  padding: '8px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 40,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: '#4fc3f7',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  content
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                  }}
                >
                  {Math.round(contentW)} × {Math.round(contentH)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Offset info */}
      <div
        style={{
          width: '100%',
          maxWidth: 340,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: '6px 10px',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>offsetTop</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)' }}>
            {Math.round(boxModel.offsetTop)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>offsetLeft</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)' }}>
            {Math.round(boxModel.offsetLeft)}
          </span>
        </div>
      </div>
    </div>
  );
}
