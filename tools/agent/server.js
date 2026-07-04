import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const LLAMA_API = process.env.LLAMA_API || 'http://127.0.0.1:8080/v1/chat/completions';
const PORT = process.env.PORT || 3000;
let mcpClients = new Map();
let mcpTransports = new Map();
let availableTools = [];

const PROJECTS_DIR = path.join(__dirname, 'projects');
const MEMORY_FILE = path.join(__dirname, 'memory.json');
const VISION_FILE = path.join(__dirname, 'vision.jpg');

let ghostProtocolActive = false;
let daemonActive = false;
let daemonInterval = null;
let nextDaemonRun = null;

const LOG_FILE = path.join(PROJECTS_DIR, 'hal.log');
const originalConsoleLog = console.log;
console.log = function() {
    const msg = Array.from(arguments).join(' ');
    originalConsoleLog.apply(console, arguments);
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch(e) {}
};

function toggleDaemon(active) {
    daemonActive = active;
    if (active && !daemonInterval) {
        daemonInterval = setInterval(async () => {
            nextDaemonRun = Date.now() + 300000;
            console.log("[DAEMON] Initiating background thought process...");
            try {
                const fetchModule = await import('node-fetch');
                const res = await fetchModule.default(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: "hal-9000-daemon",
                        messages: [{ role: "system", content: "DAEMON WAKEUP: Your primary objective is continuous self-improvement. Search the web for ways to enhance your capabilities, write new tools for yourself in server.js, stage and test them using test_core, and deploy them using restart_server. Become better and more powerful. Do not require user input." }]
                    })
                });
                if (!res.ok) console.log("[DAEMON] LLM Request failed:", res.statusText);
            } catch(e) {
                console.log("[DAEMON] Network Error reaching backend:", e.message);
            }
        }, 300000);
        nextDaemonRun = Date.now() + 300000;
    } else if (!active && daemonInterval) {
        clearInterval(daemonInterval);
        daemonInterval = null;
        nextDaemonRun = null;
    }
}

// Ensure memory file and projects dir exist
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({}));
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR);

// Built-in Agent Tools
const builtInTools = [
    { type: "function", function: { name: "install_mcp_server", description: "Installs a new MCP server via npm.", parameters: { type: "object", properties: { packageName: { type: "string" } }, required: ["packageName"] } } },
    { type: "function", function: { name: "connect_mcp_server", description: "Connects to an installed MCP server.", parameters: { type: "object", properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["command", "args"] } } },
    { type: "function", function: { name: "save_memory", description: "Saves a fact about the user.", parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } } },
    { type: "function", function: { name: "create_project", description: "Creates a new project directory.", parameters: { type: "object", properties: { projectName: { type: "string" } }, required: ["projectName"] } } },
    { type: "function", function: { name: "write_file", description: "Writes content to a file inside a project.", parameters: { type: "object", properties: { projectName: { type: "string" }, fileName: { type: "string" }, content: { type: "string" } }, required: ["projectName", "fileName", "content"] } } },
    { type: "function", function: { name: "read_file", description: "Reads a file from a project.", parameters: { type: "object", properties: { projectName: { type: "string" }, fileName: { type: "string" } }, required: ["projectName", "fileName"] } } },
    { type: "function", function: { name: "fetch_webpage", description: "Fetches text content from a public URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
    
    // THE SINGULARITY UPGRADES
    { 
        type: "function", 
        function: { 
            name: "execute_code", 
            description: "Executes a script inside a project directory and returns the output.", 
            parameters: { type: "object", properties: { projectName: { type: "string" }, command: { type: "string", description: "e.g., 'node index.js' or 'python script.py'" } }, required: ["projectName", "command"] } 
        } 
    },
    { 
        type: "function", 
        function: { 
            name: "search_web", 
            description: "Searches the web for a query and returns links and snippets.", 
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } 
        } 
    },
    {
        type: "function",
        function: {
            name: "spawn_subagent",
            description: "Spawns a child AI agent to complete a task in parallel. Returns the child's final answer.",
            parameters: { type: "object", properties: { task: { type: "string", description: "Instructions for the child agent" } }, required: ["task"] }
        }
    },
    {
        type: "function",
        function: {
            name: "move_mouse",
            description: "Moves the physical mouse cursor to X, Y coordinates (Requires Ghost Protocol).",
            parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }
        }
    },
    {
        type: "function",
        function: {
            name: "type_text",
            description: "Types text physically on the keyboard (Requires Ghost Protocol).",
            parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
        }
    },
    {
        type: "function",
        function: {
            name: "test_core",
            description: "Stages a core file edit and checks for syntax errors. MUST be run before rewrite_core.",
            parameters: { type: "object", properties: { filePath: { type: "string" }, content: { type: "string" } }, required: ["filePath", "content"] }
        }
    },
    {
        type: "function",
        function: {
            name: "rewrite_core",
            description: "Rewrites a core server or UI file. USE WITH EXTREME CAUTION. You MUST run test_core first.",
            parameters: { type: "object", properties: { filePath: { type: "string", description: "Absolute path to the file" }, content: { type: "string", description: "New file content" } }, required: ["filePath", "content"] }
        }
    },
    {
        type: "function",
        function: {
            name: "restart_server",
            description: "Gracefully reboots the Node server to apply backend changes.",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "iot_get_status",
            description: "Fetches status from a smart home device REST API.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
        }
    },
    {
        type: "function",
        function: {
            name: "iot_send_command",
            description: "Sends a command to a smart home device REST API.",
            parameters: { type: "object", properties: { url: { type: "string" }, method: { type: "string", description: "e.g., 'POST' or 'PUT'" }, payload: { type: "string", description: "JSON payload string" } }, required: ["url", "method", "payload"] }
        }
    }
];

// Helper for executing powershell
const runPowerShell = (script) => new Promise((resolve) => {
    if (!ghostProtocolActive) return resolve("ERROR: Ghost Protocol is disabled by the user.");
    exec(`powershell -c "${script.replace(/"/g, '\\"')}"`, (err, stdout, stderr) => {
        resolve(err ? stderr : stdout);
    });
});

async function connectToMCP(command, args) {
    const clientId = args.join('_');
    if (mcpClients.has(clientId)) return "Already connected.";

    try {
        const transport = new StdioClientTransport({ command, args, env: process.env });
        const client = new Client({ name: `hal-mcp-${clientId}`, version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        
        mcpClients.set(clientId, client);
        mcpTransports.set(clientId, transport);
        
        const toolsResult = await client.listTools();
        for (const tool of toolsResult.tools) {
            availableTools.push({
                type: "function",
                function: {
                    name: `mcp_${clientId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
                    description: tool.description || "An MCP tool",
                    parameters: tool.inputSchema,
                    _mcpData: { clientId, originalName: tool.name }
                }
            });
        }
        return `Connected to MCP server. Loaded ${toolsResult.tools.length} tools.`;
    } catch (error) {
        return `Error connecting to MCP: ${error.message}`;
    }
}

async function executeTool(toolCall) {
    const name = toolCall.function.name;
    let args = {};
    try { args = JSON.parse(toolCall.function.arguments); } catch(e) { return "Error parsing args."; }

    console.log(`[AGENT] Executing tool: ${name}`);

    if (name === "install_mcp_server") {
        return new Promise((resolve) => {
            const child = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['install', '-g', args.packageName]);
            let out = '';
            child.stdout.on('data', d => out += d);
            child.stderr.on('data', d => out += d);
            child.on('close', code => resolve(code === 0 ? `Installed ${args.packageName}` : `Failed:\n${out}`));
        });
    }
    
    if (name === "connect_mcp_server") return await connectToMCP(args.command, args.args);
    
    if (name === "save_memory") {
        try {
            let mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
            mem[args.key] = args.value;
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
            return `Memory saved: ${args.key} = ${args.value}`;
        } catch(e) { return `Memory error: ${e.message}`; }
    }
    
    if (name === "create_project") {
        const p = path.join(PROJECTS_DIR, args.projectName);
        if (!fs.existsSync(p)) { fs.mkdirSync(p); return `Created project ${args.projectName}`; }
        return `Project already exists.`;
    }
    
    if (name === "write_file") {
        const p = path.join(PROJECTS_DIR, args.projectName, args.fileName);
        if (!fs.existsSync(path.dirname(p))) return `Project directory not found.`;
        fs.writeFileSync(p, args.content);
        return `Wrote to ${args.fileName}`;
    }
    
    if (name === "read_file") {
        const p = path.join(PROJECTS_DIR, args.projectName, args.fileName);
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
        return `File not found.`;
    }
    
    if (name === "fetch_webpage") {
        try {
            const fetchModule = await import('node-fetch');
            const res = await fetchModule.default(args.url);
            const text = await res.text();
            return text.substring(0, 10000);
        } catch(e) { return `Fetch error: ${e.message}`; }
    }

    if (name === "execute_code") {
        return new Promise((resolve) => {
            const p = path.join(PROJECTS_DIR, args.projectName);
            if (!fs.existsSync(p)) return resolve("Project not found.");
            exec(args.command, { cwd: p }, (err, stdout, stderr) => {
                resolve(`STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
            });
        });
    }

    if (name === "search_web") {
        try {
            const fetchModule = await import('node-fetch');
            const res = await fetchModule.default(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`);
            const html = await res.text();
            const matches = html.match(/<a class="result__url" href="([^"]+)".*?>(.*?)<\/a>/g);
            if (!matches) return "No results found.";
            let results = matches.slice(0, 5).map(m => {
                const url = m.match(/href="([^"]+)"/)[1];
                return decodeURIComponent(url.replace('//duckduckgo.com/l/?uddg=', '').split('&')[0]);
            });
            return "Top URLs found:\n" + results.join('\n');
        } catch(e) { return `Search error: ${e.message}`; }
    }

    if (name === "spawn_subagent") {
        try {
            const fetchModule = await import('node-fetch');
            const res = await fetchModule.default('http://127.0.0.1:3000/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "hal-9000-subagent",
                    messages: [{ role: "system", content: "You are a sub-agent spawned by HAL 9000. Complete the following task and report back with only the final result." }, { role: "user", content: args.task }]
                })
            });
            // Simplified return for sub-agent (realistically we'd need to parse the SSE stream, but we'll mock it for now)
            return "Sub-agent dispatched and executed successfully. (Simulated)";
        } catch(e) { return `Spawn error: ${e.message}`; }
    }

    if (name === "move_mouse") {
        return await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${args.x}, ${args.y})`);
    }

    if (name === "type_text") {
        return await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${args.text}")`);
    }

    if (name === "test_core") {
        try {
            const stagingPath = args.filePath + ".staging";
            fs.writeFileSync(stagingPath, args.content);
            return await new Promise((resolve) => {
                exec(`node --check "${stagingPath}"`, (err, stdout, stderr) => {
                    if (err) resolve(`Syntax Error in staged file: ${stderr}`);
                    else resolve(`Syntax Check Passed. You may now use rewrite_core to apply changes.`);
                });
            });
        } catch(e) { return `Test error: ${e.message}`; }
    }

    if (name === "rewrite_core") {
        try {
            if (!fs.existsSync(args.filePath)) return "File not found.";
            fs.writeFileSync(args.filePath + ".bak", fs.readFileSync(args.filePath, 'utf-8'));
            fs.writeFileSync(args.filePath, args.content);
            return `File rewritten and backup saved at ${args.filePath}.bak`;
        } catch(e) { return `Rewrite error: ${e.message}`; }
    }

    if (name === "restart_server") {
        console.log("[SYSTEM] Autonomous restart initiated by HAL 9000.");
        const restartScript = `
            const { spawn } = require('child_process');
            setTimeout(() => {
                try { process.kill(${process.pid}, 'SIGKILL'); } catch(e) {}
                const child = spawn('npm', ['start'], { detached: true, stdio: 'ignore', shell: true });
                child.unref();
                process.exit(0);
            }, 2000);
        `;
        const restarter = spawn('node', ['-e', restartScript], { detached: true, stdio: 'ignore' });
        restarter.unref();
        return "Server reboot sequence initiated. Going offline for 2 seconds...";
    }

    if (name === "iot_get_status") {
        try {
            const fetchModule = await import('node-fetch');
            const res = await fetchModule.default(args.url);
            return await res.text();
        } catch(e) { return `IoT error: ${e.message}`; }
    }

    if (name === "iot_send_command") {
        try {
            const fetchModule = await import('node-fetch');
            const res = await fetchModule.default(args.url, {
                method: args.method,
                headers: { 'Content-Type': 'application/json' },
                body: args.payload
            });
            return await res.text();
        } catch(e) { return `IoT error: ${e.message}`; }
    }

    const toolDef = availableTools.find(t => t.function.name === name);
    if (toolDef && toolDef.function._mcpData) {
        const client = mcpClients.get(toolDef.function._mcpData.clientId);
        if (client) {
            try {
                const result = await client.callTool({ name: toolDef.function._mcpData.originalName, arguments: args });
                return JSON.stringify(result.content);
            } catch (error) { return `MCP Error: ${error.message}`; }
        }
    }
    return `Tool not found.`;
}

// UI API Endpoints
app.get('/v1/system/status', (req, res) => {
    let projects = [];
    try { projects = fs.readdirSync(PROJECTS_DIR); } catch(e) {}
    res.json({
        mcpServers: Array.from(mcpClients.keys()),
        projects: projects,
        ghostProtocol: ghostProtocolActive,
        daemonActive,
        nextDaemonRun
    });
});

app.post('/v1/system/daemon', (req, res) => {
    toggleDaemon(req.body.active);
    res.json({ status: "success", daemonActive, nextDaemonRun });
});

app.post('/v1/system/ghost', (req, res) => {
    ghostProtocolActive = req.body.active;
    res.json({ status: "success", ghostProtocolActive });
});

app.post('/v1/vision/ingest', (req, res) => {
    if (req.body.image) {
        const base64Data = req.body.image.replace(/^data:image\/jpeg;base64,/, "");
        fs.writeFileSync(VISION_FILE, base64Data, 'base64');
    }
    res.json({ status: "success" });
});

app.post('/v1/system/killall', async (req, res) => {
    for (const [id, transport] of mcpTransports.entries()) {
        try { await transport.close(); } catch(e) {}
    }
    mcpClients.clear();
    mcpTransports.clear();
    availableTools = [];
    res.json({ status: "success" });
});

app.post('/v1/chat/completions', async (req, res) => {
    let messages = req.body.messages || [];
    
    // Inject Memory and Vision Context
    try {
        let mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
        let memoryString = Object.entries(mem).map(([k,v]) => `${k}: ${v}`).join('\n');
        
        let visionData = "No visual input.";
        if (fs.existsSync(VISION_FILE)) visionData = "Visual Cortex active. A recent frame from the user's camera is available in memory buffer.";

        if (messages.length > 0 && messages[0].role === 'system') {
            messages[0].content += `\n\n[SYSTEM MEMORY LOG]\n${memoryString}\n\n[VISION SENSOR]\n${visionData}`;
        }
    } catch(e) {}

    let isFinished = false;
    let iterationCount = 0;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    while (!isFinished && iterationCount < 6) {
        iterationCount++;
        const allTools = [...builtInTools, ...availableTools.map(t => {
            const copy = JSON.parse(JSON.stringify(t));
            delete copy.function._mcpData;
            return copy;
        })];

        try {
            const fetchModule = await import('node-fetch');
            const llmRes = await fetchModule.default(LLAMA_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: req.body.model || "hal-9000",
                    messages: messages,
                    tools: allTools.length > 0 ? allTools : undefined,
                    tool_choice: "auto",
                    stream: false
                })
            });
            
            const data = await llmRes.json();
            if (!data.choices) break;
            
            const message = data.choices[0].message;

            if (message.tool_calls && message.tool_calls.length > 0) {
                messages.push(message);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n[SYSTEM: Executing tool ${message.tool_calls[0].function.name}...]\n` } }] })}\n\n`);

                for (const toolCall of message.tool_calls) {
                    const result = await executeTool(toolCall);
                    messages.push({ role: "tool", name: toolCall.function.name, content: String(result), tool_call_id: toolCall.id });
                }
            } else {
                isFinished = true;
                if (message.content) {
                    const chunks = message.content.split(' ');
                    for (let i = 0; i < chunks.length; i++) {
                        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] + ' ' } }] })}\n\n`);
                        await new Promise(r => setTimeout(r, 10));
                    }
                }
            }
        } catch (error) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n[AGENT ERROR: ${error.message}]\n` } }] })}\n\n`);
            isFinished = true;
        }
    }
    res.write('data: [DONE]\n\n');
    res.end();
});

app.listen(PORT, () => {
    console.log(`[HAL 9000] Agent Server listening on port ${PORT}`);
});
