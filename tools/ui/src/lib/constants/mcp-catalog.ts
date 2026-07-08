export interface McpEnvKey {
	description: string;
	required: boolean;
	default?: string;
}

export interface McpCatalogEntry {
	id: string;
	name: string;
	description: string;
	publisher: string;
	command: string;
	args: string[];
	envKeys?: Record<string, McpEnvKey>;
	categories: string[];
	icon?: string;
	githubUrl?: string;
}

export const FALLBACK_MCP_CATALOG: McpCatalogEntry[] = [
	{
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'Read-only access to PostgreSQL databases. Allows AI to query and analyze your database schemas and tables.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
		categories: ['Database'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres'
	},
	{
		id: 'github',
		name: 'GitHub',
		description: 'Interact with the GitHub API. Create issues, pull requests, search repositories, and read code.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		envKeys: { 
			GITHUB_PERSONAL_ACCESS_TOKEN: { description: 'GitHub Personal Access Token (classic or fine-grained)', required: true } 
		},
		categories: ['DevTools'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
	},
	{
		id: 'filesystem',
		name: 'File System',
		description: 'Read and analyze local files and directories safely.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
		categories: ['System'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
	},
	{
		id: 'slack',
		name: 'Slack',
		description: 'Read channels, post messages, and interact with your Slack workspace.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-slack'],
		envKeys: { 
			SLACK_BOT_TOKEN: { description: 'Bot User OAuth Token (xoxb-...)', required: true },
			SLACK_TEAM_ID: { description: 'Slack Team ID', required: false }
		},
		categories: ['Productivity'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack'
	},
	{
		id: 'google-maps',
		name: 'Google Maps',
		description: 'Get directions, search places, and analyze geographic data using Google Maps.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-google-maps'],
		envKeys: { 
			GOOGLE_MAPS_API_KEY: { description: 'Google Maps API Key', required: true } 
		},
		categories: ['Services'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps'
	},
	{
		id: 'memory',
		name: 'Memory Graph',
		description: 'Semantic memory graph database that persists facts and entities across sessions, allowing the AI to remember context.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-memory'],
		categories: ['AI', 'System'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
	},
	{
		id: 'sqlite',
		name: 'SQLite Database',
		description: 'Explore and query local SQLite databases.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-sqlite', 'database.db'],
		categories: ['Database'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite'
	},
	{
		id: 'puppeteer',
		name: 'Puppeteer Browser',
		description: 'Automate a headless Chrome browser to visit URLs, capture screenshots, and scrape websites.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-puppeteer'],
		categories: ['Web', 'Tools'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer'
	},
	{
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Perform web and local searches using the Brave Search API.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-brave-search'],
		envKeys: { 
			BRAVE_API_KEY: { description: 'Brave Search API Key', required: true } 
		},
		categories: ['Search', 'Web'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
	},
	{
		id: 'fetch',
		name: 'Web Fetch',
		description: 'Fetch and extract clean markdown content from any web URL.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-fetch'],
		categories: ['Web', 'Tools'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch'
	},
	{
		id: 'sentry',
		name: 'Sentry',
		description: 'Analyze application errors, issues, and performance data from Sentry.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-sentry'],
		envKeys: { 
			SENTRY_AUTH_TOKEN: { description: 'Sentry API Auth Token', required: true } 
		},
		categories: ['DevTools'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry'
	},
	{
		id: 'gitlab',
		name: 'GitLab',
		description: 'Interact with GitLab repositories, issues, and CI/CD pipelines.',
		publisher: 'Model Context Protocol',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-gitlab'],
		envKeys: { 
			GITLAB_PERSONAL_ACCESS_TOKEN: { description: 'GitLab Personal Access Token', required: true },
			GITLAB_API_URL: { description: 'GitLab API URL', required: false, default: 'https://gitlab.com/api/v4' }
		},
		categories: ['DevTools'],
		githubUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab'
	}
];

export async function fetchMcpCatalog(): Promise<McpCatalogEntry[]> {
	try {
		// Attempt to fetch from a public URL (e.g. GitHub Gist or Raw Content)
		// For now, using a placeholder gist URL. 
		// Replace with an actual URL if a central catalog is hosted.
		const response = await fetch('https://raw.githubusercontent.com/modelcontextprotocol/servers/main/catalog.json');
		if (response.ok) {
			const data = await response.json();
			if (Array.isArray(data) && data.length > 0) {
				return data as McpCatalogEntry[];
			}
		}
	} catch (e) {
		console.warn('Failed to fetch remote MCP catalog, falling back to local.', e);
	}
	return FALLBACK_MCP_CATALOG;
}
