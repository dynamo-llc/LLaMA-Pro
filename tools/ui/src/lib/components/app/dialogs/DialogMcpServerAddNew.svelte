<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { McpServerForm } from '$lib/components/app/mcp';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { uuid } from '$lib/utils';
	import { MCP_SERVER_ID_PREFIX } from '$lib/constants';
	import McpMarketplace from '$lib/components/app/mcp/McpMarketplace.svelte';
	import { Store, Plus } from '@lucide/svelte';

	interface Props {
		open: boolean;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), onOpenChange }: Props = $props();

	let activeTab = $state<'marketplace' | 'custom'>('marketplace');

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
	<Dialog.Content class="sm:max-w-4xl h-[85vh] flex flex-col p-0 overflow-hidden bg-background">
		<div class="flex border-b border-border/50 bg-card/40 px-6 pt-6">
			<button
				class="flex items-center gap-2 px-4 py-3 border-b-2 font-medium transition-colors text-sm
					{activeTab === 'marketplace' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeTab = 'marketplace')}
			>
				<Store class="w-4 h-4" />
				Marketplace
			</button>
			<button
				class="flex items-center gap-2 px-4 py-3 border-b-2 font-medium transition-colors text-sm
					{activeTab === 'custom' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeTab = 'custom')}
			>
				<Plus class="w-4 h-4" />
				Custom URL
			</button>
		</div>

		<div class="flex-1 overflow-hidden">
			{#if activeTab === 'marketplace'}
				<div class="h-full p-6 bg-muted/10">
					<McpMarketplace />
				</div>
			{:else}
				<div class="h-full p-6 overflow-y-auto max-w-2xl mx-auto w-full">
					<div class="mb-6">
						<h3 class="text-lg font-semibold">Add Custom Server</h3>
						<p class="text-sm text-muted-foreground">
							Connect to an existing MCP server using Server-Sent Events (SSE) or WebSockets.
						</p>
					</div>

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
					
					<div class="mt-8 flex justify-end gap-3">
						<Button variant="secondary" onclick={() => handleOpenChange(false)}>Cancel</Button>
						<Button
							variant="default"
							onclick={saveNewServer}
							disabled={!!newServerUrlError || !newServerUrl.trim()}
						>
							Add Server
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
