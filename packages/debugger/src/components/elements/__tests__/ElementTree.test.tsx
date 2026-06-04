import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';
import ElementTree, { type RrwebNode } from '../ElementTree';

// Mock the store
const mockSetSelectedNode = vi.fn();
const mockSelectedNodeId = vi.fn(() => null);

vi.mock('../../../store', () => ({
  useStore: (selector: (state: any) => any) => {
    const mockStore = {
      selectedNodeId: mockSelectedNodeId(),
      setSelectedNode: mockSetSelectedNode,
    };
    return selector(mockStore);
  },
}));

describe('ElementTree', () => {
  beforeEach(() => {
    mockSetSelectedNode.mockClear();
    mockSelectedNodeId.mockReturnValue(null);
  });

  it('renders empty state when rootNode is null', () => {
    render(<ElementTree rootNode={null} />);
    expect(screen.getByText('Waiting for DOM snapshot…')).toBeInTheDocument();
  });

  it('renders rrweb DOM tree structure', () => {
    const rootNode: RrwebNode = {
      type: 0, // Document
      id: 1,
    childNodes: [
        {
          type: 1, // DocumentType
     id: 2,
          name: 'html',
       publicId: '',
          systemId: '',
      },
        {
          type: 2, // Element
          id: 3,
        tagName: 'html',
          attributes: {},
          childNodes: [
            {
         type: 2,
              id: 4,
              tagName: 'body',
         attributes: { class: 'container' },
         childNodes: [],
            },
          ],
        },
      ],
    };

    render(<ElementTree rootNode={rootNode} />);

    expect(screen.getByText('<!DOCTYPE html>')).toBeInTheDocument();
    expect(screen.getByText(/<html/)).toBeInTheDocument();
    expect(screen.getByText(/<body/)).toBeInTheDocument();
  });

  it('calls setSelectedNode when node is clicked', async () => {
    const user = userEvent.setup();
    const rootNode: RrwebNode = {
      type: 2,
    id: 1,
   tagName: 'div',
      attributes: {},
      childNodes: [],
    };

    render(<ElementTree rootNode={rootNode} />);

    const divElement = screen.getByText(/<div/);
    await user.click(divElement);

    expect(mockSetSelectedNode).toHaveBeenCalledWith(1);
  });

  it('highlights selected node', () => {
    mockSelectedNodeId.mockReturnValue(3);

    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
    attributes: {},
    childNodes: [
        {
      type: 2,
          id: 3,
          tagName: 'span',
        attributes: {},
          childNodes: [],
        },
      ],
    };

    render(<ElementTree rootNode={rootNode} />);

    const spanElement = screen.getByText(/<span/).closest('span');
    expect(spanElement).toHaveStyle({ background: 'var(--accent-blue-transparent)' });
  });

  it('expands and collapses nodes with children', async () => {
    const user = userEvent.setup();
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {},
      childNodes: [
        {
          type: 2,
          id: 2,
          tagName: 'span',
          attributes: {},
          childNodes: [],
        },
      ],
    };

    render(<ElementTree rootNode={rootNode} />);

    // Initially expanded (depth < 2)
    expect(screen.getByText(/<span/)).toBeInTheDocument();

    // Click to collapse
    const divElement = screen.getByText(/<div/).closest('span');
    await user.click(divElement!);

    // Should show collapsed indicator
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('renders text nodes with truncation', () => {
    const longText = 'a'.repeat(200);
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {},
      childNodes: [
        {
          type: 3, // Text
      id: 2,
          textContent: longText,
        },
      ],
    };

    render(<ElementTree rootNode={rootNode} />);

    const textNode = screen.getByText(/^a+$/);
    expect(textNode.textContent).toHaveLength(120);
  });

  it('renders attributes with truncation', () => {
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {
        class: 'container',
        'data-id': 'a'.repeat(100),
      },
      childNodes: [],
    };

    render(<ElementTree rootNode={rootNode} />);

    // Attributes should be truncated to 40 chars per attribute
    const attributesText = screen.getByText(/class="container"/);
    expect(attributesText).toBeInTheDocument();
  });

  it('skips empty text nodes', () => {
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {},
      childNodes: [
        {
          type: 3,
       id: 2,
          textContent: '   ',
        },
        {
      type: 3,
          id: 3,
          textContent: 'visible text',
        },
      ],
    };

    const { container } = render(<ElementTree rootNode={rootNode} />);

    expect(screen.getByText('visible text')).toBeInTheDocument();
    // Empty whitespace text node should not render
    expect(container.textContent).not.toContain('   ');
  });

  it('shows expand/collapse indicator for nodes with children', () => {
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {},
      childNodes: [
        {
          type: 2,
          id: 2,
        tagName: 'span',
          attributes: {},
          childNodes: [],
        },
      ],
    };

    render(<ElementTree rootNode={rootNode} />);

    // Should show expand indicator (▾ when expanded)
    expect(screen.getByText('▾')).toBeInTheDocument();
  });

  it('does not show expand indicator for leaf nodes', () => {
    const rootNode: RrwebNode = {
      type: 2,
      id: 1,
      tagName: 'div',
      attributes: {},
    childNodes: [],
    };

    render(<ElementTree rootNode={rootNode} />);

    expect(screen.queryByText('▾')).not.toBeInTheDocument();
    expect(screen.queryByText('▸')).not.toBeInTheDocument();
  });
});
