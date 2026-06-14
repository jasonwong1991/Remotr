import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { SessionId } from '@remotr/shared';
import { RemotrClient, SessionConnection } from './client.js';
import { resolveStackVia } from './resolve.js';

const SESSION_PROPS = {
  deviceId: { type: 'string', description: 'Target session deviceId (from remotr_list_sessions)' },
  pageId: { type: 'string', description: 'Target session pageId (from remotr_list_sessions)' },
} as const;

const TOOLS: Tool[] = [
  {
    name: 'remotr_list_sessions',
    description:
      'List live debugging sessions in the room (deviceId, pageId, URL, framework). Call this first to discover targets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'remotr_get_errors',
    description:
      'List recent runtime errors (uncaught errors, unhandled rejections, console.error) for a session, with raw (minified) stacks. Use the returned index with remotr_resolve_error / remotr_get_context.',
    inputSchema: {
      type: 'object',
      properties: { ...SESSION_PROPS },
      required: ['deviceId', 'pageId'],
    },
  },
  {
    name: 'remotr_resolve_error',
    description:
      'Resolve one error\'s stack back to original source via source maps: returns original file:line + code snippet per frame. The SDK fetches scripts/maps same-origin.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        errorIndex: { type: 'number', description: 'Index from remotr_get_errors (default 0)' },
      },
      required: ['deviceId', 'pageId'],
    },
  },
  {
    name: 'remotr_get_context',
    description:
      'Full diagnostic bundle for one error to drive a fix: system info, the error, source-map-resolved frames with code snippets, recent console timeline, and failed network requests.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        errorIndex: { type: 'number', description: 'Index from remotr_get_errors (default 0)' },
      },
      required: ['deviceId', 'pageId'],
    },
  },
];

function sessionFromArgs(args: Record<string, unknown>): SessionId {
  const deviceId = String(args.deviceId ?? '');
  const pageId = String(args.pageId ?? '');
  if (!deviceId || !pageId) throw new Error('deviceId and pageId are required');
  return { deviceId, pageId };
}

async function withSession<T>(
  client: RemotrClient,
  session: SessionId,
  fn: (conn: SessionConnection) => Promise<T>,
): Promise<T> {
  const conn = await client.connectSession(session);
  try {
    await conn.waitForBacklog();
    return await fn(conn);
  } finally {
    conn.close();
  }
}

async function dispatch(
  client: RemotrClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'remotr_list_sessions': {
      const sessions = await client.listSessions();
      return {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          deviceId: s.session.deviceId,
          pageId: s.session.pageId,
          identity: s.identity,
          connected: s.connected,
          url: s.systemInfo?.url,
          title: s.systemInfo?.title,
          framework: s.systemInfo?.framework,
        })),
      };
    }

    case 'remotr_get_errors': {
      const session = sessionFromArgs(args);
      return withSession(client, session, async (conn) => {
        const errors = conn.errors();
        return {
          count: errors.length,
          errors: errors.map((e) => ({
            index: e.index,
            kind: e.kind,
            message: e.message,
            isPromiseRejection: e.isPromiseRejection,
            timestamp: e.timestamp,
            stack: e.stack,
          })),
          hint:
            errors.length > 0
              ? 'Call remotr_get_context with an errorIndex for resolved source + full context.'
              : 'No errors captured in the current backlog.',
        };
      });
    }

    case 'remotr_resolve_error': {
      const session = sessionFromArgs(args);
      const errorIndex = Number(args.errorIndex ?? 0);
      return withSession(client, session, async (conn) => {
        const errors = conn.errors();
        const err = errors[errorIndex];
        if (!err) throw new Error(`No error at index ${errorIndex} (have ${errors.length})`);
        if (!err.stack) return { error: err.message, frames: [], note: 'Error has no stack to resolve.' };
        const frames = await resolveStackVia(conn, err.stack);
        return { error: err.message, frames };
      });
    }

    case 'remotr_get_context': {
      const session = sessionFromArgs(args);
      const errorIndex = Number(args.errorIndex ?? 0);
      return withSession(client, session, async (conn) => {
        const errors = conn.errors();
        const err = errors[errorIndex];
        if (!err) throw new Error(`No error at index ${errorIndex} (have ${errors.length})`);
        const info = conn.systemInfo();
        const frames = err.stack ? await resolveStackVia(conn, err.stack) : [];
        return {
          system: info
            ? { url: info.url, title: info.title, framework: info.framework, viewport: info.viewport, ua: info.ua }
            : undefined,
          error: {
            kind: err.kind,
            message: err.message,
            isPromiseRejection: err.isPromiseRejection,
            timestamp: err.timestamp,
          },
          frames,
          recentConsole: conn.recentConsole(30),
          networkIssues: conn.networkIssues(),
        };
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** 创建 MCP server（stdio），把 Remotr 运行时数据暴露为工具供 Claude Code 使用。 */
export function createMcpServer(client: RemotrClient): Server {
  const server = new Server(
    { name: 'remotr-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatch(client, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
