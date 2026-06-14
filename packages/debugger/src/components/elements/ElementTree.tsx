import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { sendCommand } from '../../ws';
import HtmlEditModal from './HtmlEditModal';
import { NODE_TYPE, type RrwebNode } from './domTree';
import { useT } from '../../i18n';
import { copyToClipboard } from '../../clipboard';

function attrString(attrs?: Record<string, string | number | boolean | null>): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}="${String(v ?? '')}"`)
    .join(' ');
}

/**
 * Ids to expand by default so the page content is visible on load:
 * the <html> element and the <body> element.
 */
function findDefaultExpandIds(root: RrwebNode): number[] {
  const ids: number[] = [];
  const walk = (node: RrwebNode): void => {
    // Include the document root as a defensive default. rrweb normally renders
    // Document nodes by directly rendering children, but expanding it is harmless
    // and prevents future tree-shape changes from hiding <html>/<body>.
    if (node.type === NODE_TYPE.Document) ids.push(node.id);
    if (node.type === NODE_TYPE.Element) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'html' || tag === 'body') ids.push(node.id);
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  return ids;
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

// ─────────────────────────────────────────────────────────
// Selector / XPath / JS path / outerHTML generation helpers
// ─────────────────────────────────────────────────────────

/** Normalize an rrweb attribute value to a trimmed string. */
function attrValue(node: RrwebNode, key: string): string {
  const v = node.attributes?.[key];
  return v == null ? '' : String(v).trim();
}

/** Generate a CSS selector for a node (prefers id, then tag.class, else tag). */
function generateSelector(node: RrwebNode): string {
  const tag = (node.tagName ?? '').toLowerCase();
  const id = attrValue(node, 'id');
  if (id) return `#${id}`;
  const classes = attrValue(node, 'class').split(/\s+/).filter(Boolean);
  if (classes.length > 0) return `${tag}.${classes[0]}`;
  return tag;
}

/**
 * Build a map from each node id to its parent node, used for upward traversal
 * during XPath / outerHTML generation.
 */
function buildParentMap(root: RrwebNode): Map<number, RrwebNode> {
  const parents = new Map<number, RrwebNode>();
  const walk = (node: RrwebNode): void => {
    for (const child of node.childNodes ?? []) {
      parents.set(child.id, node);
      walk(child);
    }
  };
  walk(root);
  return parents;
}

/** Compute the 1-based index of `node` among siblings sharing its tagName. */
function tagIndexAmongSiblings(parent: RrwebNode | undefined, node: RrwebNode): number {
  if (!parent) return 1;
  let index = 0;
  for (const child of parent.childNodes ?? []) {
    if (child.type === NODE_TYPE.Element && child.tagName === node.tagName) {
      index += 1;
      if (child.id === node.id) return index;
    }
  }
  return index || 1;
}

/**
 * Generate an absolute XPath expression for the node by walking up the
 * parent chain, e.g. /html/body/div[2]/span[1].
 */
function generateXPath(node: RrwebNode, parents: Map<number, RrwebNode>): string {
  const segments: string[] = [];
  let current: RrwebNode | undefined = node;
  while (current && current.type === NODE_TYPE.Element) {
    const parent = parents.get(current.id);
    const tag = (current.tagName ?? '').toLowerCase();
    const idx = tagIndexAmongSiblings(parent, current);
    segments.unshift(`${tag}[${idx}]`);
    current = parent;
  }
  return '/' + segments.join('/');
}

/** Generate a `document.querySelector(...)` JS path snippet. */
function generateJsPath(node: RrwebNode): string {
  const selector = generateSelector(node).replace(/'/g, "\\'");
  return `document.querySelector('${selector}')`;
}

/** Reconstruct the outerHTML string for a node from the rrweb tree. */
function generateOuterHTML(node: RrwebNode): string {
  const serialize = (n: RrwebNode): string => {
    if (n.type === NODE_TYPE.Text) return n.textContent ?? '';
    if (n.type === NODE_TYPE.Comment) return `<!--${n.textContent ?? ''}-->`;
    if (n.type === NODE_TYPE.DocumentType) return '<!DOCTYPE html>';
    if (n.type !== NODE_TYPE.Element) return '';
    const tag = (n.tagName ?? '').toLowerCase();
    const attrs = attrString(n.attributes);
    const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
    const voidTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr',
    ]);
    if (voidTags.has(tag)) return attrs ? `<${tag} ${attrs} />` : `<${tag} />`;
    const inner = (n.childNodes ?? []).map(serialize).join('');
    return `${open}${inner}</${tag}>`;
  };
  return serialize(node);
}

/** Copy text to clipboard with a graceful fallback for insecure contexts. */
// ─────────────────────────────────────────────────────────
// Forced pseudo-state
// ─────────────────────────────────────────────────────────

type PseudoState = ':hover' | ':active' | ':focus' | ':focus-visible';

const PSEUDO_STATES: PseudoState[] = [':hover', ':active', ':focus', ':focus-visible'];

// ─────────────────────────────────────────────────────────
// Context menu
// ─────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  onClick?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  useEffect(() => {
    const handlePointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Defer registration so the opening contextmenu event doesn't close it.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handlePointer);
      window.addEventListener('contextmenu', handlePointer);
    }, 0);
    window.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('contextmenu', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Keep the menu within the viewport.
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 4);
    if (top + rect.height > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height - 4);
    setPos({ left, top });
  }, [x, y]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    zIndex: 10000,
    minWidth: 180,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    padding: '4px 0',
    fontFamily: 'var(--font-sans, system-ui)',
    fontSize: 14,
    userSelect: 'none',
  };

  const renderItem = (item: MenuItem, index: number, isSub = false): React.ReactElement => {
    if (item.separator) {
      return <div key={`sep-${index}`} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
    }
    const hasSubmenu = item.submenu && item.submenu.length > 0;
    const isOpen = openSubmenu === index;
    return (
      <div
        key={item.label}
        // Submenu items must NOT touch `openSubmenu`: doing so closed the very
        // submenu the cursor just entered. Only top-level items drive it.
        onMouseEnter={() => {
          if (!isSub) setOpenSubmenu(hasSubmenu ? index : null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (hasSubmenu) return;
          item.onClick?.();
          onClose();
        }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '5px 12px',
          cursor: 'pointer',
          color: item.danger ? 'var(--accent-red)' : 'var(--text-primary)',
          background: isOpen ? 'var(--bg-primary)' : 'transparent',
          whiteSpace: 'nowrap',
        }}
        onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
        onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = isOpen ? 'var(--bg-primary)' : 'transparent'; }}
      >
        <span>
          {item.checked != null && (
            <span style={{ display: 'inline-block', width: 14 }}>{item.checked ? '✓' : ''}</span>
          )}
          {item.label}
        </span>
        {hasSubmenu && <span style={{ fontSize: 14 }}>▸</span>}
        {hasSubmenu && isOpen && (
          <div
            style={{
              position: 'absolute',
              left: '100%',
              top: -5,
              minWidth: 170,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              padding: '4px 0',
            }}
          >
            {item.submenu!.map((sub, i) => renderItem(sub, i + 1000, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={ref} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => renderItem(item, i))}
    </div>
  );
}

interface DomNodeProps {
  node: RrwebNode;
  depth: number;
  expandedIds: Set<number>;
  toggle: (id: number) => void;
  selectedNodeId: number | null;
  setSelectedNode: (id: number) => void;
  selectedRef: React.RefObject<HTMLSpanElement>;
  onContextMenu: (e: React.MouseEvent, node: RrwebNode) => void;
}

function DomNode({
  node,
  depth,
  expandedIds,
  toggle,
  selectedNodeId,
  setSelectedNode,
  selectedRef,
  onContextMenu,
}: DomNodeProps): React.ReactElement {
  if (node.type === NODE_TYPE.Text) {
    const text = (node.textContent ?? '').trim();
    if (!text) return <></>;
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--accent-orange)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>
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
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    );
  }

  if (node.type === NODE_TYPE.DocumentType) {
    return (
      <div style={{ paddingLeft: depth * 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>
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
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
      <span
        ref={isSelected ? selectedRef : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) toggle(node.id);
          setSelectedNode(node.id);
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
        style={{
          cursor: 'pointer',
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
          paddingLeft: depth * 12,
          paddingRight: 6,
          background: isSelected ? 'var(--accent-blue)' : 'transparent',
          color: isSelected ? '#fff' : undefined,
          borderRadius: 2,
          lineHeight: '20px',
          overflowWrap: 'anywhere',
          wordBreak: 'normal',
          whiteSpace: 'normal',
        }}
      >
        {hasChildren && (
          <span style={{ color: isSelected ? '#fff' : 'var(--text-muted)', fontSize: 14, marginRight: 2 }}>{expanded ? '▾' : '▸'}</span>
        )}
        <span style={{ color: isSelected ? '#fff' : 'var(--accent-blue)' }}>{'<'}{tag}</span>
        {attrs && <span style={{ color: isSelected ? '#fff' : 'var(--accent-yellow)', overflowWrap: 'anywhere', wordBreak: 'normal' }}> {attrs}</span>}
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
              onContextMenu={onContextMenu}
            />
          ))}
          <div style={{ paddingLeft: depth * 12 }}>
            <span style={{ color: 'var(--accent-blue)' }}>{'</'}{tag}{'>'}</span>
          </div>
        </>
      )}
    </div>
  );
}

interface ElementTreeProps {
  rootNode: RrwebNode | null;
  /** Notified when a context-menu action mutates the element's inline style,
   *  so the Styles pane can reflect it optimistically (e.g. hide → display:none). */
  onStyleChanged?: (property: string, value: string) => void;
  /** Per-node forced pseudo-states, owned by ElementsPanel (drives the matched-rules query). */
  forcedStates: Map<number, Set<string>>;
  /** Toggle a forced pseudo-state for a node. */
  onToggleForcedState: (nodeId: number, pseudo: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: RrwebNode;
}

export default function ElementTree({ rootNode, onStyleChanged, forcedStates, onToggleForcedState }: ElementTreeProps): React.ReactElement {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const t = useT();
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  // Collapsed by default — only the explicitly expanded ids are open.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const selectedRef = useRef<HTMLSpanElement>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Open outerHTML editor target (null = closed).
  const [htmlEdit, setHtmlEdit] = useState<{ nodeId: number; initial: string } | null>(null);

  const parentMap = useMemo(() => (rootNode ? buildParentMap(rootNode) : new Map<number, RrwebNode>()), [rootNode]);

  const toggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Keep <html> and <body> expanded whenever a new snapshot tree arrives.
  // Do not guard with a one-shot ref: rrweb may replace the snapshot tree after
  // the first render, and the new <body> can have a different node id.
  useEffect(() => {
    if (rootNode == null) return;
    const ids = findDefaultExpandIds(rootNode);
    if (ids.length === 0) return;
    setExpandedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      // Keep the same reference when nothing new was expanded so the live tree
      // rebuilds (one per DOM mutation) don't spuriously re-run dependent effects.
      return changed ? next : prev;
    });
  }, [rootNode]);

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

  const handleContextMenu = (e: React.MouseEvent, node: RrwebNode): void => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedNode(node.id);
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const closeMenu = (): void => setContextMenu(null);

  // ── Menu action handlers ──────────────────────────────────

  const doCopy = (text: string): void => {
    void copyToClipboard(text);
  };

  const togglePseudo = (node: RrwebNode, pseudo: PseudoState): void => {
    // Forced states live in ElementsPanel; toggling re-queries matched rules so
    // the real pseudo-class rules (e.g. .btn:hover) appear in the Styles pane.
    onToggleForcedState(node.id, pseudo);
  };

  const hideElement = (node: RrwebNode): void => {
    void sendCommand('elements.setStyle', { nodeId: node.id, property: 'display', value: 'none' }).catch(() => {});
    // Reflect it in the Styles pane immediately (same path as in-pane edits).
    onStyleChanged?.('display', 'none');
  };

  const editHTML = (node: RrwebNode): void => {
    setHtmlEdit({ nodeId: node.id, initial: generateOuterHTML(node) });
  };

  const deleteElement = (node: RrwebNode): void => {
    void sendCommand('elements.deleteNode', { nodeId: node.id }).catch(() => {});
  };

  const scrollIntoView = (node: RrwebNode): void => {
    void sendCommand('elements.scrollIntoView', { nodeId: node.id }).catch(() => {});
  };

  const buildMenuItems = (node: RrwebNode): MenuItem[] => {
    const forced = forcedStates.get(node.id) ?? new Set<string>();
    return [
      { label: t('menu.copySelector'), onClick: () => doCopy(generateSelector(node)) },
      { label: t('menu.copyOuterHtml'), onClick: () => doCopy(generateOuterHTML(node)) },
      { label: t('menu.copyXpath'), onClick: () => doCopy(generateXPath(node, parentMap)) },
      { label: t('menu.copyJsPath'), onClick: () => doCopy(generateJsPath(node)) },
      { label: '', separator: true },
      {
        label: t('menu.forceState'),
        submenu: PSEUDO_STATES.map((pseudo) => ({
          label: pseudo,
          checked: forced.has(pseudo),
          onClick: () => togglePseudo(node, pseudo),
        })),
      },
      { label: '', separator: true },
      { label: t('menu.hideElement'), onClick: () => hideElement(node) },
      { label: t('menu.editHtml'), onClick: () => editHTML(node) },
      { label: t('menu.deleteElement'), danger: true, onClick: () => deleteElement(node) },
      { label: '', separator: true },
      { label: t('menu.scrollIntoView'), onClick: () => scrollIntoView(node) },
    ];
  };

  if (!rootNode) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', fontSize: 13,
      }}>
        {t('tree.waiting')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '8px 4px' }}>
        <DomNode
          node={rootNode}
          depth={0}
          expandedIds={expandedIds}
          toggle={toggle}
          selectedNodeId={selectedNodeId}
          setSelectedNode={setSelectedNode}
          selectedRef={selectedRef}
          onContextMenu={handleContextMenu}
        />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={buildMenuItems(contextMenu.node)}
            onClose={closeMenu}
          />
        )}
        {htmlEdit && (
          <HtmlEditModal
            initialValue={htmlEdit.initial}
            onCancel={() => setHtmlEdit(null)}
            onSave={(html) => {
              if (html !== htmlEdit.initial) {
                void sendCommand('elements.setHTML', { nodeId: htmlEdit.nodeId, outerHTML: html }).catch(() => {});
              }
              setHtmlEdit(null);
            }}
          />
        )}
    </div>
  );
}

export type { RrwebNode };
