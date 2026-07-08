<script lang="ts">
	import { fetchMcpCatalog, type McpCatalogEntry } from '$lib/constants/mcp-catalog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Search, Download, ExternalLink, Check, Loader2, Server } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { uuid } from '$lib/utils';
	import { getBaseUrl } from '$lib/utils/get-base-url';
	import { MCP_SERVER_ID_PREFIX } from '$lib/constants';
	import { onMount } from 'svelte';
	import McpEnvDialog from './McpEnvDialog.svelte';

	let searchQuery = $state('');
	let selectedCategory = $state<string | null>(null);
	let installingId = $state<string | null>(null);
	
	let catalog = $state<McpCatalogEntry[]>([]);
	let isCatalogLoading = $state(true);

	// Env Dialog State
	let envDialogOpen = $state(false);
	let envDialogEntry = $state<McpCatalogEntry | null>(null);

	onMount(async () => {
		catalog = await fetchMcpCatalog();
		isCatalogLoading = false;
	});

	let categories = $derived.by(() => {
		return Array.from(new Set(catalog.flatMap((c) => c.categories))).sort();
	});

	let filteredCatalog = $derived.by(() => {
		let res = catalog;
		if (selectedCategory) {
			res = res.filter((c) => c.categories.includes(selectedCategory!));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			res = res.filter(
				(c) =>
					c.name.toLowerCase().includes(q) ||
					c.description.toLowerCase().includes(q) ||
					c.publisher.toLowerCase().includes(q)
			);
		}
		return res;
	});

	function requestInstallMcp(entry: McpCatalogEntry) {
		if (entry.envKeys && Object.keys(entry.envKeys).length > 0) {
			envDialogEntry = entry;
			envDialogOpen = true;
		} else {
			executeInstallMcp(entry, {});
		}
	}

	async function executeInstallMcp(entry: McpCatalogEntry, envVars: Record<string, string>) {
		installingId = entry.id;
		try {
			// Tell Orchestrator to run it via the SSE proxy
			const orchestratorUrl = getBaseUrl('orchestrator');
			const response = await fetch(`${orchestratorUrl}/api/mcp`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name: entry.name,
					cmd: [entry.command, ...entry.args],
					env: envVars,
					is_stdio: true
				})
			});

			if (!response.ok) {
				const errorTxt = await response.text();
				throw new Error(`Failed to install MCP on backend: ${errorTxt}`);
			}

			const data = await response.json();
			const port = data.port;
			if (!port) {
				throw new Error('Backend did not return a port for the new MCP server');
			}

			// Register it in the UI's mcpStore
			const newServerId = uuid() ?? `${MCP_SERVER_ID_PREFIX}-${Date.now()}`;
			const serverUrl = `http://127.0.0.1:${port}/sse`;

			mcpStore.addServer({
				id: newServerId,
				enabled: true,
				name: entry.name,
				url: serverUrl
			});

			conversationsStore.setMcpServerOverride(newServerId, true);
		} catch (error) {
			console.error('Failed to install MCP:', error);
			alert(error instanceof Error ? error.message : 'Failed to install MCP server');
		} finally {
			installingId = null;
		}
	}
</script>

<div class="flex flex-col h-full space-y-4">
	<div class="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
		<div>
			<h2 class="text-lg font-bold">MCP Plugin Catalog</h2>
			<p class="text-sm text-muted-foreground">
				Browse and install highly capable agentic tools from the community.
			</p>
		</div>
		<div class="relative w-full md:w-64">
			<Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Search tools..."
				class="pl-9 bg-background/50"
				bind:value={searchQuery}
			/>
		</div>
	</div>

	{#if isCatalogLoading}
		<div class="flex flex-col items-center justify-center flex-grow opacity-50 py-12">
			<Loader2 class="w-8 h-8 animate-spin mb-4" />
			<p>Fetching remote catalog...</p>
		</div>
	{:else}
		<div class="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
			<Badge
				variant={selectedCategory === null ? 'default' : 'secondary'}
				class="cursor-pointer whitespace-nowrap"
				onclick={() => (selectedCategory = null)}
			>
				All
			</Badge>
			{#each categories as category}
				<Badge
					variant={selectedCategory === category ? 'default' : 'secondary'}
					class="cursor-pointer whitespace-nowrap"
					onclick={() => (selectedCategory = category)}
				>
					{category}
				</Badge>
			{/each}
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2 pb-4">
			{#each filteredCatalog as entry (entry.id)}
				<div
					class="group relative flex flex-col rounded-xl border border-border bg-card/40 p-5 hover:bg-accent/10 transition-colors"
				>
					<div class="flex justify-between items-start mb-3">
						<div class="flex items-center gap-3">
							<div
								class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20"
							>
								<Server class="w-5 h-5" />
							</div>
							<div>
								<h3 class="font-semibold text-foreground flex items-center gap-2">
									{entry.name}
								</h3>
								<p class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
									{entry.publisher}
								</p>
							</div>
						</div>
						{#if entry.githubUrl}
							<a
								href={entry.githubUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="text-muted-foreground hover:text-primary transition-colors"
								aria-label="View Source"
							>
								<ExternalLink class="w-4 h-4" />
							</a>
						{/if}
					</div>

					<p class="text-xs text-muted-foreground line-clamp-3 mb-4 flex-grow">
						{entry.description}
					</p>

					<div class="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
						<div class="flex gap-1.5 flex-wrap">
							{#each entry.categories as cat}
								<span class="text-[10px] px-2 py-0.5 rounded-full bg-secondary/50 text-secondary-foreground border border-border/50">
									{cat}
								</span>
							{/each}
						</div>
						<Button
							variant="default"
							size="sm"
							class="h-8 rounded-full px-4 text-xs font-semibold shadow-sm"
							disabled={installingId !== null}
							onclick={() => requestInstallMcp(entry)}
						>
							{#if installingId === entry.id}
								<Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />
								Installing...
							{:else}
								<Download class="w-3.5 h-3.5 mr-1.5" />
								Install
							{/if}
						</Button>
					</div>
				</div>
			{/each}

			{#if filteredCatalog.length === 0}
				<div class="col-span-full flex flex-col items-center justify-center py-12 text-center">
					<Search class="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
					<p class="text-sm text-muted-foreground">No tools found matching your search.</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<McpEnvDialog
	bind:open={envDialogOpen}
	entry={envDialogEntry}
	onConfirm={(envVars) => executeInstallMcp(envDialogEntry!, envVars)}
/>
