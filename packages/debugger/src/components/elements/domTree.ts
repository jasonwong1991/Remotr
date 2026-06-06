import type { Replayer } from 'rrweb';

// rrweb node types (mirrors rrweb-snapshot NodeType ordering).
export const NODE_TYPE = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  Comment: 5,
} as const;

/** A serialized DOM node in the shape the Elements tree renders. */
export interface RrwebNode {
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

/** Minimal slice of rrweb's Mirror that we depend on. */
interface MirrorLike {
  getId(node: Node | null | undefined): number;
}

/**
 * Rebuild the Elements tree from the rrweb Replayer's *live* mirror DOM.
 *
 * The Replayer applies every incremental mutation (attribute changes, node
 * removals, outerHTML replacement, …) to an internal iframe, so walking that
 * iframe gives the current DOM state — unlike parsing the one-shot FullSnapshot,
 * which never changes after the first frame. Node ids come from the mirror, so
 * they stay consistent with selection, highlight and command targeting.
 */
export function buildDomTreeFromReplayer(replayer: Replayer | null): RrwebNode | null {
  if (!replayer) return null;

  let mirror: MirrorLike | undefined;
  try {
    mirror = replayer.getMirror?.();
  } catch {
    return null;
  }

  const doc = replayer.iframe?.contentDocument;
  if (!mirror || !doc) return null;

  return serializeNode(doc, mirror);
}

function serializeNode(node: Node, mirror: MirrorLike): RrwebNode | null {
  switch (node.nodeType) {
    case Node.DOCUMENT_NODE:
      // Always render the document so its children (doctype, <html>) show up,
      // even if the document node itself is untracked by the mirror.
      return {
        type: NODE_TYPE.Document,
        id: mirror.getId(node),
        childNodes: serializeChildren(node, mirror),
      };

    case Node.DOCUMENT_TYPE_NODE: {
      const dt = node as DocumentType;
      return {
        type: NODE_TYPE.DocumentType,
        id: mirror.getId(node),
        name: dt.name,
        publicId: dt.publicId,
        systemId: dt.systemId,
      };
    }

    case Node.ELEMENT_NODE: {
      const id = mirror.getId(node);
      if (id < 0) return null; // untracked helper node injected by the replayer
      const el = node as Element;
      const attributes: Record<string, string> = {};
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        attributes[attr.name] = attr.value;
      }
      return {
        type: NODE_TYPE.Element,
        id,
        tagName: el.tagName.toLowerCase(),
        attributes,
        childNodes: serializeChildren(el, mirror),
      };
    }

    case Node.TEXT_NODE: {
      const id = mirror.getId(node);
      if (id < 0) return null;
      return { type: NODE_TYPE.Text, id, textContent: node.textContent ?? '' };
    }

    case Node.COMMENT_NODE: {
      const id = mirror.getId(node);
      if (id < 0) return null;
      return { type: NODE_TYPE.Comment, id, textContent: node.textContent ?? '' };
    }

    default:
      return null;
  }
}

function serializeChildren(node: Node, mirror: MirrorLike): RrwebNode[] {
  const out: RrwebNode[] = [];
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = serializeNode(children[i], mirror);
    if (child) out.push(child);
  }
  return out;
}
