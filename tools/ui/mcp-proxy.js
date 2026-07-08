import http from 'http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
let port = 8080;
let cmdArgs = [];

if (portIndex !== -1 && portIndex < args.length - 1) {
  port = parseInt(args[portIndex + 1], 10);
  cmdArgs = args.filter((_, i) => i !== portIndex && i !== portIndex + 1);
} else {
  cmdArgs = args;
}

if (cmdArgs.length === 0) {
  console.error("Usage: node mcp-proxy.js --port <port> <command> [args...]");
  process.exit(1);
}

const command = cmdArgs[0];
const commandArgs = cmdArgs.slice(1);

let activeTransport = null;

console.log(`Starting MCP stdio proxy for: ${command} ${commandArgs.join(' ')}`);

const stdioTransport = new StdioClientTransport({
  command,
  args: commandArgs,
  env: process.env,
});

async function start() {
  await stdioTransport.start();
  console.log("Stdio transport started.");

  const server = http.createServer(async (req, res) => {
    // Basic CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      console.log("New SSE connection established");
      
      // Node native response doesn't exactly match Express response.
      // SSEServerTransport expects Express-like req/res, but it just calls res.writeHead, res.write, res.end, etc.
      // It is compatible with native http ServerResponse!
      const transport = new SSEServerTransport('/message', res);
      await transport.start();
      
      transport.onmessage = async (message) => {
        await stdioTransport.send(message);
      };

      stdioTransport.onmessage = async (message) => {
        await transport.send(message);
      };

      activeTransport = transport;
      
      req.on('close', () => {
        console.log("SSE connection closed");
        activeTransport = null;
      });
    } else if (req.method === 'POST' && url.pathname === '/message') {
      if (activeTransport) {
        try {
          await activeTransport.handlePostMessage(req, res);
        } catch (err) {
          console.error("Error handling post message:", err);
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      } else {
        res.writeHead(404);
        res.end("No active SSE connection");
      }
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(`MCP Proxy listening on http://localhost:${port}/sse`);
  });
}

start().catch(console.error);
