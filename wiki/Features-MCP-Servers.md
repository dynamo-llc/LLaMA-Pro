# MCP Servers

LLaMA Pro supports the **Model Context Protocol (MCP)**, allowing you to connect your AI models to external data sources and tools seamlessly. 

## What is MCP?

The Model Context Protocol (MCP) is an open standard that enables AI models to securely access context and capabilities from local or remote servers. Instead of the model being isolated, an MCP server acts as a bridge to databases, file systems, web search tools, or custom APIs.

## How to Configure MCP Servers

1. Navigate to the **MCP Servers** tab in the LLaMA Pro UI.
2. Click **Add Server**.
3. **Configure the Connection:**
   - Provide a Name for the server.
   - Enter the server URL (for SSE/HTTP based MCP servers) or the command to launch the server locally (for stdio based MCP servers).
   - Enter any required API keys or environment variables.
4. **Enable Tools:** Once connected, the UI will list the available tools provided by that MCP server. You can toggle which tools are exposed to your model.

## Using MCP in Chat

When chatting with a model in LLaMA Pro, if you have active MCP servers, the model will automatically be provided with the schemas of the available tools. 

If the model decides it needs to use a tool (e.g., searching the web or reading a file), it will emit a tool call. LLaMA Pro will intercept this, securely route the request to the appropriate MCP server, and feed the result back into the model's context stream!

> [!CAUTION]
> Giving an AI model access to local file systems or databases via MCP can be a security risk. Always verify the tools you are enabling, and run untrusted code inside sandboxed environments.
