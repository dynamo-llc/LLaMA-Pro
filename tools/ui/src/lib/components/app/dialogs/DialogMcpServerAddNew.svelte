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
			name: 'Puppeteer Browser',
			url: 'http://localhost:8006/sse',
			description: 'Automate web browsing and capture screenshots'
		},
		{
			name: 'Ghidra (Headless)',
			url: 'http://localhost:8081/sse',
			description: 'Analyze binaries, batch write, and run custom Python scripts headlessly using PyGhidra'
		},
		{
			name: 'IDA Pro',
			url: 'http://localhost:8082/sse',
			description: 'Decompile, read memory, and rename variables inside IDA Pro'
		},
		{
			name: 'Memory',
			url: 'http://localhost:8021/sse',
			description: 'Local semantic memory graph database that persists facts and entities across sessions'
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
