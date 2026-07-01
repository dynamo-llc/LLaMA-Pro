<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { McpServerForm } from '$lib/components/app/mcp';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { uuid } from '$lib/utils';
	import { MCP_SERVER_ID_PREFIX } from '$lib/constants';

	interface Props {
		open: boolean;
		onOpenChange?: (open: boolean) => void;
	}

	interface Preset {
		name: string;
		url: string;
		description: string;
		headers?: string;
	}

	const PRESETS: Preset[] = [
		{
			name: 'DuckDuckGo News',
			url: 'http://localhost:8004/sse',
			description: 'Fetch the latest news articles (no API key required)'
		},
		{
			name: 'Brave Search',
			url: 'http://localhost:8002/sse',
			description: 'Web search engine integration (requires X-Brave-Key header)',
			headers: '{\n  "X-Brave-Key": "YOUR_API_KEY_HERE"\n}'
		},
		{
			name: 'SQLite Database',
			url: 'http://localhost:8030/sse',
			description: 'Read and write local SQL databases'
		},
		{
			name: 'Filesystem',
			url: 'http://localhost:8003/sse',
			description: 'Access local directory files and logs'
		},
		{
			name: 'Fetch Web Page',
			url: 'http://localhost:8005/sse',
			description: 'Scrape web pages and extract markdown content'
		},
		{
			name: 'Puppeteer Browser',
			url: 'http://localhost:8006/sse',
			description: 'Automate web browsing and capture screenshots'
		},
		{
			name: 'Ghidra (Headless)',
			url: 'http://localhost:8081/sse',
			description:
				'Analyze binaries, batch write, and run custom Python scripts headlessly using PyGhidra'
		},
		{
			name: 'IDA Pro',
			url: 'http://localhost:8082/sse',
			description: 'Decompile, read memory, and rename variables inside IDA Pro'
		},
		{
			name: 'Firecrawl',
			url: 'http://localhost:8011/sse',
			description: 'Scrapes and transforms any website into clean, LLM-ready data',
			headers: '{\n  "Authorization": "Bearer YOUR_FIRECRAWL_API_KEY"\n}'
		},
		{
			name: 'Supabase',
			url: 'http://localhost:8012/sse',
			description: 'Natively write SQL, manage database schemas, and query data'
		},
		{
			name: 'Figma',
			url: 'http://localhost:8013/sse',
			description: 'Exposes live structure, auto-layout, and components of Figma files',
			headers: '{\n  "Figma-Token": "YOUR_FIGMA_PERSONAL_ACCESS_TOKEN"\n}'
		},
		{
			name: 'Composio',
			url: 'http://localhost:8014/sse',
			description: 'Access over 250 tools and integrations (Jira, GitHub, Slack, etc.)',
			headers: '{\n  "x-api-key": "YOUR_COMPOSIO_API_KEY"\n}'
		},
		{
			name: 'Playwright',
			url: 'http://localhost:8015/sse',
			description: 'Programmatic browser automation and end-to-end testing'
		},
		{
			name: 'E2B Sandbox',
			url: 'http://localhost:8016/sse',
			description: 'Secure, isolated cloud sandbox environment to execute and test code',
			headers: '{\n  "Authorization": "Bearer YOUR_E2B_API_KEY"\n}'
		},
		{
			name: 'GitHub',
			url: 'http://localhost:8017/sse',
			description: 'Read repositories, create issues, submit PRs, and manage version control',
			headers: '{\n  "Authorization": "token YOUR_GITHUB_PERSONAL_ACCESS_TOKEN"\n}'
		},
		{
			name: 'Notion',
			url: 'http://localhost:8018/sse',
			description: 'Access workspace data, team documentation, and task boards',
			headers: '{\n  "Authorization": "Bearer YOUR_NOTION_INTEGRATION_TOKEN",\n  "Notion-Version": "2022-06-28"\n}'
		},
		{
			name: 'Chrome DevTools (Browsertools)',
			url: 'http://localhost:8019/sse',
			description: 'Connect directly to Chrome Developer Tools for runtime and console logs'
		},
		{
			name: 'Memory',
			url: 'http://localhost:8021/sse',
			description: 'Local semantic memory graph database that persists facts and entities across sessions'
		},
		{
			name: 'Docker',
			url: 'http://localhost:8022/sse',
			description: 'Inspect, manage, build, and run local Docker containers and view logs'
		},
		{
			name: 'PostgreSQL',
			url: 'http://localhost:8023/sse',
			description: 'Connect directly to PostgreSQL databases to read schemas and execute queries'
		},
		{
			name: 'Jupyter Notebook',
			url: 'http://localhost:8024/sse',
			description: 'Stateful Jupyter Python kernel for calculations, data analysis, and chart generation'
		},
		{
			name: 'Google Sheets',
			url: 'http://localhost:8025/sse',
			description: 'Access and edit Google Sheets spreadsheets'
		}
	];

	let { open = $bindable(), onOpenChange }: Props = $props();

	let newServerName = $state('');
	let newServerUrl = $state('');
	let newServerHeaders = $state('');
	let newServerUrlError = $derived.by(() => {
		if (!newServerUrl.trim()) return 'URL is required';
		try {
			new URL(newServerUrl);

			return null;
		} catch {
			return 'Invalid URL format';
		}
	});

	function handleOpenChange(value: boolean) {
		if (!value) {
			newServerName = '';
			newServerUrl = '';
			newServerHeaders = '';
		}
		open = value;
		onOpenChange?.(value);
	}

	function saveNewServer() {
		if (newServerUrlError) return;

		const newServerId = uuid() ?? `${MCP_SERVER_ID_PREFIX}-${Date.now()}`;

		mcpStore.addServer({
			id: newServerId,
			enabled: true,
			name: newServerName.trim() || undefined,
			url: newServerUrl.trim(),
			headers: newServerHeaders.trim() || undefined
		});

		conversationsStore.setMcpServerOverride(newServerId, true);

		handleOpenChange(false);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Add New Server</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4 py-4 max-h-[80vh] overflow-y-auto pr-1">
			<div>
				<div class="mb-2 block text-xs font-medium text-muted-foreground">
					Select a preset template
				</div>
				<div class="grid grid-cols-2 gap-2">
					{#each PRESETS as preset}
						<button
							type="button"
							class="flex flex-col text-left rounded-lg border border-border bg-card/50 p-2.5 hover:bg-accent/50 hover:border-accent transition-all text-xs"
							onclick={() => {
								newServerName = preset.name;
								newServerUrl = preset.url;
								newServerHeaders = preset.headers || '';
							}}
						>
							<span class="font-semibold text-foreground">{preset.name}</span>
							<span class="text-[10px] text-muted-foreground line-clamp-1"
								>{preset.description}</span
							>
						</button>
					{/each}
				</div>
			</div>

			<div class="border-t border-border pt-4">
				<McpServerForm
					name={newServerName}
					url={newServerUrl}
					headers={newServerHeaders}
					onNameChange={(v) => (newServerName = v)}
					onUrlChange={(v) => (newServerUrl = v)}
					onHeadersChange={(v) => (newServerHeaders = v)}
					urlError={newServerUrl ? newServerUrlError : null}
					id="new-server"
				/>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={() => handleOpenChange(false)}>Cancel</Button>

			<Button
				variant="default"
				size="sm"
				onclick={saveNewServer}
				disabled={!!newServerUrlError}
				aria-label="Save"
			>
				Add
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
