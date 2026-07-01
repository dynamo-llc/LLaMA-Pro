const express = require('express');
const cors = require('cors');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const os = require('os');

const app = express();
app.use(cors());

let currentSseTransport = null;
let mcpClient = null;

app.get('/sse', async (req, res) => {
    try {
        if (mcpClient) {
            try { await mcpClient.close(); } catch (e) {}
        }
        if (currentSseTransport) {
            try { await currentSseTransport.close(); } catch (e) {}
        }

        const apiKey = req.headers['x-brave-key'] || process.env.BRAVE_API_KEY;
        if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
            console.error('Missing or invalid X-Brave-Key header');
            res.status(401).send('Missing or invalid X-Brave-Key header. Please provide a valid Brave Search API key.');
            return;
        }

        console.log('Spawning Brave Search MCP via npx...');
        const npxCommand = os.platform() === 'win32' ? 'npx.cmd' : 'npx';
        const stdioTransport = new StdioClientTransport({
            command: npxCommand,
            args: ['-y', '@modelcontextprotocol/server-brave-search', apiKey]
        });

        mcpClient = new Client(
            { name: 'brave-search-bridge-client', version: '1.0.0' },
            { capabilities: {} }
        );

        await mcpClient.connect(stdioTransport);
        console.log('Connected to Brave Search stdio server.');

        const sseServer = new Server(
            { name: 'brave-search-mcp', version: '1.0.0' },
            { capabilities: { tools: {} } }
        );

        sseServer.setRequestHandler(ListToolsRequestSchema, async () => {
            return await mcpClient.listTools();
        });

        sseServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            return await mcpClient.callTool(request.params);
        });

        currentSseTransport = new SSEServerTransport('/message', res);
        await sseServer.connect(currentSseTransport);
        console.log('SSE connection established and bridged.');
    } catch (err) {
        console.error('Error in /sse:', err);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error: ' + err.message);
        }
    }
});

app.post('/message', async (req, res) => {
    if (currentSseTransport) {
        await currentSseTransport.handlePostMessage(req, res);
    } else {
        res.status(400).send('No active SSE connection');
    }
});

const PORT = 8002; // As configured in preset
app.listen(PORT, () => {
    console.log(`Brave Search SSE bridge running on http://localhost:${PORT}/sse`);
});
