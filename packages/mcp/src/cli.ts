#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RemotrClient } from './client.js';
import { createMcpServer } from './server.js';

interface Args {
  server: string;
  room: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    server: process.env.REMOTR_SERVER || 'http://localhost:9777',
    room: process.env.REMOTR_ROOM || 'default',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server' || a === '-s') out.server = argv[++i];
    else if (a === '--room' || a === '-r') out.room = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const { server, room } = parseArgs(process.argv.slice(2));
  const client = new RemotrClient(server, room);
  const mcp = createMcpServer(client);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // 日志必须走 stderr：stdout 是 MCP 协议通道
  console.error(`[remotr-mcp] ready · server=${server} · room=${room}`);
}

main().catch((err) => {
  console.error('[remotr-mcp] fatal:', err);
  process.exit(1);
});
