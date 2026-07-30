import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RemotrClient } from './client.js';
import { createMcpServer } from './server.js';

export interface McpHttpOptions {
  /** Remotr relay 的 HTTP 地址（MCP 工具经此自环回连本机，复用 HTTP+WS 链路） */
  serverUrl: string;
  /** 目标房间 */
  room: string;
}

/**
 * 以 Streamable HTTP 传输处理一次 MCP 请求（无状态模式）。
 * 每请求新建 Server + Transport：无 session 管理、无请求 ID 串扰；
 * 语义与 stdio 版一致 —— 工具调用本就是短连 WS 收 backlog 后即断。
 */
export async function handleMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpHttpOptions,
): Promise<void> {
  const mcp = createMcpServer(new RemotrClient(opts.serverUrl, opts.room));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态：不下发 session id，不做校验
    enableJsonResponse: true, // 纯 JSON 应答，避免长驻 SSE 流
  });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}
