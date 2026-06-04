import React from 'react';
import type { CSSRule } from '@remotr/shared';

interface RulesPaneProps {
  inlineStyles: Record<string, string> | null;
  rules: CSSRule[] | null;
}

function formatSource(source: string): string {
  try {
    const url = new URL(source);
    return url.pathname.split('/').pop() || source;
  } catch {
    return source;
  }
}

function specificityScore([a, b, c]: [number, number, number]): number {
  return a * 10000 + b * 100 + c;
}

export default function RulesPane({ inlineStyles, rules }: RulesPaneProps): React.ReactElement {
  if (rules === null) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: 12,
      }}>
        Loading rules...
      </div>
    );
  }

  const sortedRules = [...rules].sort(
    (a, b) => specificityScore(b.specificity) - specificityScore(a.specificity)
  );

  const hasInline = inlineStyles && Object.keys(inlineStyles).length > 0;
  const hasRules = sortedRules.length > 0;

  if (!hasInline && !hasRules) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}>
        No matched rules
      </div>
    );
  }

  const ruleBlockStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    padding: '6px 8px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
  };

  const selectorLineStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  };

  const selectorStyle: React.CSSProperties = {
    color: 'var(--accent-blue)',
    fontWeight: 600,
  };

  const sourceStyle: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: 10,
    marginLeft: 8,
    flexShrink: 0,
  };

  const propLineStyle: React.CSSProperties = {
    paddingLeft: 16,
    lineHeight: '1.6',
  };

  const propNameStyle: React.CSSProperties = {
    color: 'var(--accent-purple, #a78bfa)',
  };

  const braceStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* Inline styles block */}
      {hasInline && (
        <div style={ruleBlockStyle}>
          <div style={selectorLineStyle}>
            <span style={selectorStyle}>element.style</span>
            <span style={sourceStyle}>inline</span>
          </div>
          <span style={braceStyle}>{'{'}</span>
          {Object.entries(inlineStyles!).map(([prop, value]) => (
            <div key={prop} style={propLineStyle}>
              <span style={propNameStyle}>{prop}</span>
              <span style={braceStyle}>: </span>
              <span>{value}</span>
              <span style={braceStyle}>;</span>
            </div>
          ))}
          <span style={braceStyle}>{'}'}</span>
        </div>
      )}

      {/* Matched rules sorted by specificity */}
      {sortedRules.map((rule, index) => (
        <div key={`${rule.selector}-${rule.styleSheetIndex}-${index}`} style={ruleBlockStyle}>
          <div style={selectorLineStyle}>
            <span style={selectorStyle}>{rule.selector}</span>
            <span style={sourceStyle}>{formatSource(rule.source)}</span>
          </div>
          <span style={braceStyle}>{'{'}</span>
          {Object.entries(rule.properties).map(([prop, value]) => (
            <div key={prop} style={propLineStyle}>
              <span style={propNameStyle}>{prop}</span>
              <span style={braceStyle}>: </span>
              <span>{value}</span>
              <span style={braceStyle}>;</span>
            </div>
          ))}
          <span style={braceStyle}>{'}'}</span>
        </div>
      ))}
    </div>
  );
}
