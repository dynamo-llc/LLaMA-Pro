const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();
app.use(cors());

let browser;
let page;

async function ensureBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({ headless: 'new' });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
    }
    return page;
}

let currentTransport = null;

app.get('/sse', async (req, res) => {
    if (currentTransport) {
        try { await currentTransport.close(); } catch(e) {}
    }
    const server = new Server(
        { name: 'puppeteer-browser-mcp', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'puppeteer_navigate',
                description: 'Navigate to a URL',
                inputSchema: {
                    type: 'object',
                    properties: { url: { type: 'string' } },
                    required: ['url']
                }
            },
            {
                name: 'puppeteer_screenshot',
                description: 'Take a screenshot of the current page. Returns a base64 encoded PNG image.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'puppeteer_click',
                description: 'Click an element on the page',
                inputSchema: {
                    type: 'object',
                    properties: { selector: { type: 'string' } },
                    required: ['selector']
                }
            },
            {
                name: 'puppeteer_fill',
                description: 'Fill out an input field',
                inputSchema: {
                    type: 'object',
                    properties: { selector: { type: 'string' }, value: { type: 'string' } },
                    required: ['selector', 'value']
                }
            },
            {
                name: 'puppeteer_evaluate',
                description: 'Execute JavaScript in the browser console',
                inputSchema: {
                    type: 'object',
                    properties: { script: { type: 'string' } },
                    required: ['script']
                }
            }
        ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
            const p = await ensureBrowser();
            const { name, arguments: args } = request.params;

            if (name === 'puppeteer_navigate') {
                await p.goto(args.url, { waitUntil: 'networkidle2' });
                return { content: [{ type: 'text', text: `Navigated to ${args.url}` }] };
            }
            if (name === 'puppeteer_screenshot') {
                const screenshot = await p.screenshot({ encoding: 'base64' });
                return { content: [{ type: 'image', data: screenshot, mimeType: 'image/png' }] };
            }
            if (name === 'puppeteer_click') {
                await p.click(args.selector);
                return { content: [{ type: 'text', text: `Clicked ${args.selector}` }] };
            }
            if (name === 'puppeteer_fill') {
                await p.type(args.selector, args.value);
                return { content: [{ type: 'text', text: `Filled ${args.selector} with ${args.value}` }] };
            }
            if (name === 'puppeteer_evaluate') {
                const result = await p.evaluate(args.script);
                return { content: [{ type: 'text', text: `Result: ${JSON.stringify(result)}` }] };
            }
            throw new Error(`Tool not found: ${name}`);
        } catch (error) {
            return { isError: true, content: [{ type: 'text', text: `Error: ${error.message}` }] };
        }
    });

    currentTransport = new SSEServerTransport('/message', res);
    await server.connect(currentTransport);
});

app.post('/message', async (req, res) => {
    if (currentTransport) {
        await currentTransport.handlePostMessage(req, res);
    } else {
        res.status(400).send('No active SSE connection');
    }
});

const PORT = 8006;
app.listen(PORT, () => {
    console.log(`Puppeteer MCP server running on http://localhost:${PORT}/sse`);
});
