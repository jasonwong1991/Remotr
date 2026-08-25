import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { EvalRunResult, SessionId, TraceSetResult } from '@remotr/shared';
import { RemotrClient, SessionConnection } from './client.js';
import { resolveStackVia, type ResolvedFrameOut } from './resolve.js';

/** 输出上限：单次工具响应超过此字节数即截断并标记 truncated（R6）。 */
const MAX_OUTPUT = 50_000;
/** 源码片段半径：命中行 ± 该行数，约 10 行以内（R6）。 */
const SNIPPET_RADIUS = 5;

/**
 * room 作为每个工具的可选入参：配置里的 /mcp 不必带 ?room=，
 * 房间名由「复制给 AI 修复」的上下文（`- room: xxx`）带进来，逐次调用传参。
 * 省略时回落到服务端配置的默认房间，兼容既有的 ?room= / --room 用法。
 */
const ROOM_PROP = {
  room: {
    type: 'string',
    description:
      'Room name. Take it from the pasted Remotr context line "- room: xxx". Omit only if your MCP URL already pins a room (…/mcp?room=…). Use remotr_list_rooms to discover it.',
  },
} as const;

const SESSION_PROPS = {
  ...ROOM_PROP,
  deviceId: { type: 'string', description: 'Target session deviceId (from remotr_list_sessions)' },
  pageId: { type: 'string', description: 'Target session pageId (from remotr_list_sessions)' },
} as const;

const TOOLS: Tool[] = [
  {
    name: 'remotr_list_rooms',
    description:
      'List all active rooms on the server with their session counts. Use this when you do not know the room name (or the pasted context has none) before calling remotr_list_sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'remotr_list_sessions',
    description:
      'List live debugging sessions in a room (deviceId, pageId, URL, framework). Call this first to discover targets.',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP } },
  },
  {
    name: 'remotr_get_errors',
    description:
      'List recent runtime errors (uncaught errors, unhandled rejections, console.error) for a session, with raw (minified) stacks. Use the returned index with remotr_resolve_error / remotr_get_context / remotr_diagnose.',
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
  {
    name: 'remotr_diagnose',
    description:
      'One-call triage for the latest (or a specified) error: message + source-map-resolved stack + code snippet at the top frame + recent console + network timeline + a one-line suggested cause. Start here when a page is misbehaving.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        errorIndex: { type: 'number', description: 'Index from remotr_get_errors (default 0 = latest listed)' },
      },
      required: ['deviceId', 'pageId'],
    },
  },
  {
    name: 'remotr_run_eval',
    description:
      'Execute a JavaScript expression in the live page (indirect eval, global scope) and return the serialized result. This is the primary "act" primitive — use it to read app state, call functions, or reproduce a bug. Thrown errors are returned as an error-typed result (threw: true), not a tool failure.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        expression: { type: 'string', description: 'JS expression/statements to run in the page global scope' },
      },
      required: ['deviceId', 'pageId', 'expression'],
    },
  },
  {
    name: 'remotr_set_tracepoint',
    description:
      'Place a no-pause tracepoint: wraps the function at functionPath so every call reports args/return/stack without pausing execution. Returns a tracepointId — poll remotr_get_tracepoint_hits with it. Use this to observe a function that runs during a repro.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        functionPath: {
          type: 'string',
          description: 'Dotted path from the page global, e.g. "fetch", "window.fetch", or "app.cart.calcTotal"',
        },
        condition: {
          type: 'string',
          description:
            'Optional filter expression evaluated after the call; may reference args (array), ret, self (this). Report only when truthy. Fail-open on error.',
        },
        captureArgs: {
          type: 'boolean',
          description: 'Optional (default true). Args are always captured by the SDK; this is advisory.',
        },
      },
      required: ['deviceId', 'pageId', 'functionPath'],
    },
  },
  {
    name: 'remotr_get_tracepoint_hits',
    description:
      'Return recent tracepoint hits (args, return value, thrown, stack, timestamp), most-recent last, capped. Optionally filter by tracepointId from remotr_set_tracepoint.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_PROPS,
        tracepointId: { type: 'string', description: 'Filter to one tracepoint (from remotr_set_tracepoint)' },
        limit: { type: 'number', description: 'Max hits to return (default 20)' },
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

/** 把解析帧的片段裁到 SNIPPET_RADIUS 行以内（R6，双保险）。 */
function trimSnippet(frame: ResolvedFrameOut): ResolvedFrameOut {
  const s = frame.snippet;
  if (!s || s.lines.length <= SNIPPET_RADIUS * 2 + 1) return frame;
  const start = Math.max(0, s.focusIndex - SNIPPET_RADIUS);
  const end = Math.min(s.lines.length, s.focusIndex + SNIPPET_RADIUS + 1);
  return {
    ...frame,
    snippet: {
      startLine: s.startLine + start,
      lines: s.lines.slice(start, end),
      focusIndex: s.focusIndex - start,
    },
  };
}

async function withSession<T>(
  client: RemotrClient,
  session: SessionId,
  room: string | undefined,
  fn: (conn: SessionConnection) => Promise<T>,
): Promise<T> {
  const conn = await client.connectSession(session, room);
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
  // 房间名逐次调用传入，缺省由 client 回落到配置里的默认房间
  const room = typeof args.room === 'string' ? args.room : undefined;
  switch (name) {
    case 'remotr_list_rooms': {
      const rooms = await client.listRooms();
      return { count: rooms.length, rooms };
    }
    case 'remotr_list_sessions': {
      const sessions = await client.listSessions(room);
      return {
        room: client.resolveRoom(room),
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
      return withSession(client, session, room, async (conn) => {
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
              ? 'Call remotr_diagnose (or remotr_get_context) with an errorIndex for resolved source + full context.'
              : 'No errors captured in the current backlog.',
        };
      });
    }

    case 'remotr_resolve_error': {
      const session = sessionFromArgs(args);
      const errorIndex = Number(args.errorIndex ?? 0);
      return withSession(client, session, room, async (conn) => {
        const errors = conn.errors();
        const err = errors[errorIndex];
        if (!err) throw new Error(`No error at index ${errorIndex} (have ${errors.length})`);
        if (!err.stack) return { error: err.message, frames: [], note: 'Error has no stack to resolve.' };
        const frames = (await resolveStackVia(conn, err.stack, SNIPPET_RADIUS)).map(trimSnippet);
        return { error: err.message, frames };
      });
    }

    case 'remotr_get_context': {
      const session = sessionFromArgs(args);
      const errorIndex = Number(args.errorIndex ?? 0);
      return withSession(client, session, room, async (conn) => {
        const errors = conn.errors();
        const err = errors[errorIndex];
        if (!err) throw new Error(`No error at index ${errorIndex} (have ${errors.length})`);
        const info = conn.systemInfo();
        const frames = err.stack
          ? (await resolveStackVia(conn, err.stack, SNIPPET_RADIUS)).map(trimSnippet)
          : [];
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
          networkIssues: conn.networkIssues(20),
        };
      });
    }

    case 'remotr_diagnose': {
      const session = sessionFromArgs(args);
      const errorIndex = Number(args.errorIndex ?? 0);
      return withSession(client, session, room, async (conn) => {
        const errors = conn.errors();
        const err = errors[errorIndex];
        if (!err) throw new Error(`No error at index ${errorIndex} (have ${errors.length})`);
        const info = conn.systemInfo();
        const frames = err.stack
          ? (await resolveStackVia(conn, err.stack, SNIPPET_RADIUS)).map(trimSnippet)
          : [];
        const top = frames.find((f) => f.original) ?? frames[0];
        const net = conn.networkIssues(10);
        return {
          suggestedCause: suggestCause(err.message, top, net),
          error: {
            kind: err.kind,
            message: err.message,
            isPromiseRejection: err.isPromiseRejection,
            timestamp: err.timestamp,
          },
          topFrame: top
            ? { fn: top.fn, at: top.original ?? top.raw, snippet: top.snippet }
            : undefined,
          frames,
          page: info ? { url: info.url, framework: info.framework } : undefined,
          recentConsole: conn.recentConsole(15),
          networkTimeline: net,
        };
      });
    }

    case 'remotr_run_eval': {
      const session = sessionFromArgs(args);
      const expression = String(args.expression ?? '');
      if (!expression) throw new Error('expression is required');
      return withSession(client, session, room, async (conn) => {
        const reply = (await conn.sendCommand('eval.run', { code: expression })) as EvalRunResult;
        const atom = reply?.result;
        const threw = atom?.type === 'error';
        return {
          threw,
          type: atom?.type,
          result: atom?.display,
          value: atom?.value,
          children: atom?.children,
          truncated: atom?.truncated,
        };
      });
    }

    case 'remotr_set_tracepoint': {
      const session = sessionFromArgs(args);
      const path = String(args.functionPath ?? '');
      if (!path) throw new Error('functionPath is required');
      const condition = args.condition != null ? String(args.condition) : undefined;
      const id = `tp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      return withSession(client, session, room, async (conn) => {
        const reply = (await conn.sendCommand('trace.set', {
          tracepoint: { id, path, condition },
        })) as TraceSetResult;
        return {
          tracepointId: id,
          path,
          ok: reply?.ok ?? false,
          error: reply?.error,
          hint: reply?.ok
            ? 'Reproduce the behavior, then call remotr_get_tracepoint_hits with this tracepointId.'
            : 'Set failed — check functionPath resolves from the page global and points at a configurable function.',
        };
      });
    }

    case 'remotr_get_tracepoint_hits': {
      const session = sessionFromArgs(args);
      const tracepointId = args.tracepointId != null ? String(args.tracepointId) : undefined;
      const limit = Number(args.limit ?? 20);
      return withSession(client, session, room, async (conn) => {
        const hits = conn.traceHits(limit, tracepointId);
        return {
          count: hits.length,
          hits,
          hint:
            hits.length === 0
              ? 'No hits yet — trigger the code path in the page (e.g. via remotr_run_eval or user action), then poll again.'
              : undefined,
        };
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** 从错误信息 + 顶帧 + 网络问题拼一句「可能原因」，给 AI 一个起点（不确定则保守表述）。 */
function suggestCause(
  message: string,
  top: ResolvedFrameOut | undefined,
  net: Array<{ url?: string; status?: number; error?: string }>,
): string {
  const at = top?.original
    ? `${top.original.source}:${top.original.line}`
    : top
      ? `${top.raw.url}:${top.raw.line}`
      : 'an unresolved frame';
  const m = message.toLowerCase();
  if (/is not a function|not a constructor/.test(m))
    return `Calling a non-callable value near ${at} — check the type/shape of the target before the call.`;
  if (/undefined|null/.test(m) && /reading|property|of/.test(m))
    return `Reading a property off null/undefined near ${at} — guard the value or fix the upstream that left it empty.`;
  if (/is not defined/.test(m))
    return `A referenced identifier is undefined near ${at} — likely a missing import/global or a load-order issue.`;
  if (net.length > 0) {
    const f = net[0];
    return `Failed request (${f.status ?? f.error} ${f.url ?? ''}) precedes the error at ${at} — a network failure may be the root cause.`;
  }
  return `Error thrown at ${at}; inspect the top-frame snippet and recent console for the trigger.`;
}

/** 紧凑序列化 + 50KB 输出防护（R6）。超限则截断并追加 truncated 标记。 */
function serialize(result: unknown): string {
  const text = JSON.stringify(result);
  if (text.length <= MAX_OUTPUT) return text;
  return (
    text.slice(0, MAX_OUTPUT) +
    `\n…[truncated: true — output exceeded ${MAX_OUTPUT} chars; refine your query or use a more specific tool]`
  );
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
      return { content: [{ type: 'text', text: serialize(result) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
