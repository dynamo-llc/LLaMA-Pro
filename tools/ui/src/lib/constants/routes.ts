export const NEW_CHAT_PARAM = 'new_chat';

/** Settings section slugs — used for routes and navigation. */
export const SETTINGS_SECTION_SLUGS = {
	GENERAL: 'general',
	DISPLAY: 'display',
	SAMPLING: 'sampling',
	PENALTIES: 'penalties',
	AGENTIC: 'agentic',
	DEVELOPER: 'developer',
	MCP: 'mcp',
	TOOLS: 'tools',
	IMPORT_EXPORT: 'import-export',
	ECHO: 'echo',
	MESH: 'mesh',
	TUNNEL: 'tunnel',
	MODELS: 'models',
	TELEMETRY: 'telemetry',
	TERMINAL: 'terminal'
} as const;

export const ROUTES = {
	/** Root — start of the app. */
	START: '#/',
	/** New chat — root with new chat query param. */
	NEW_CHAT: `?${NEW_CHAT_PARAM}=true#/`,
	/** Chat base — for dynamic chat URLs use RouterService. */
	CHAT: '#/chat',
	/** MCP servers. */
	MCP_SERVERS: '#/settings/mcp',
	/** Models management. */
	MODELS: '#/settings/models',
	/** Telemetry. */
	TELEMETRY: '#/settings/telemetry',
	/** Terminal. */
	TERMINAL: '#/settings/terminal',
	/** Settings base — for dynamic settings URLs use RouterService. */
	SETTINGS: '#/settings',
	/** Search — mobile-only full-page conversation search. */
	SEARCH: '#/search',
	/** News Portal */
	NEWS: '#/news',
	/** Companion / Jarvis AI */
	COMPANION: '#/companion'
} as const;
