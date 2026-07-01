const express = require('express');
const cors = require('cors');
const { searchNews } = require('duck-duck-scrape');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();
app.use(cors());

// Store transports by some ID (the SDK actually handles this internally usually, but we need to route POSTs)
let currentTransport = null;

app.get('/sse', async (req, res) => {
    const server = new Server(
        { name: 'duckduckgo-news-mcp', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'get_todays_news',
                description: 'Fetches the latest news articles for a given topic or general news if no topic is provided.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        topic: { type: 'string', description: 'The topic to search news for.' },
                        limit: { type: 'number', description: 'The maximum number of news articles to return (max 20).' }
                    }
                }
            }
        ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === 'get_todays_news') {
            const topic = request.params.arguments?.topic || 'world';
            const limit = request.params.arguments?.limit || 10;
            try {
                const results = await searchNews(topic);
                const articles = results.results.slice(0, limit).map(r => 
                    `Title: ${r.title}\nSource: ${r.source}\nDate: ${new Date(r.date * 1000).toLocaleString()}\nSnippet: ${r.excerpt}\nURL: ${r.url}`
                ).join('\n\n');
                return { content: [{ type: 'text', text: articles || 'No news found.' }] };
            } catch (error) {
                return { isError: true, content: [{ type: 'text', text: `Error: ${error.message}` }] };
            }
        }
        throw new Error(`Tool not found: ${request.params.name}`);
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

const PORT = 8004;
app.listen(PORT, () => {
    console.log(`DuckDuckGo News MCP server running on http://localhost:${PORT}/sse`);
});
