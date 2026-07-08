<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Database, Loader2, RefreshCw } from '@lucide/svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import type { MCPResourceContent } from '$lib/types';

	interface Props {
		open: boolean;
		uri: string;
		resourceName: string;
		serverName: string;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), uri, resourceName, serverName, onOpenChange }: Props = $props();

	let content = $state<MCPResourceContent[] | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	async function loadResource() {
		if (!uri || !serverName) return;
		isLoading = true;
		error = null;
		content = null;

		try {
			// readResourceByUri requires serverName and uri
			const result = await mcpStore.readResourceByUri(serverName, uri);
			if (result) {
				content = result;
			} else {
				error = "No content returned.";
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error occurred while fetching resource.';
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (open && uri) {
			loadResource();
		} else {
			content = null;
			error = null;
		}
	});

	function handleOpenChange(value: boolean) {
		open = value;
		onOpenChange?.(value);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-3xl max-h-[85vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center justify-between">
				<div class="flex items-center gap-2 overflow-hidden">
					<Database class="w-5 h-5 shrink-0 text-primary" />
					<span class="truncate font-mono">{resourceName}</span>
				</div>
				<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0 mr-6" onclick={loadResource} disabled={isLoading}>
					<RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
				</Button>
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex-grow flex flex-col min-h-0 mt-2">
			<div class="bg-muted/50 p-2 text-xs font-mono text-muted-foreground break-all rounded-t-md border border-b-0 border-border">
				{uri}
			</div>
			<div class="flex-grow bg-black rounded-b-md border border-border p-4 overflow-auto relative min-h-[300px]">
				{#if isLoading && !content}
					<div class="absolute inset-0 flex items-center justify-center">
						<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
					</div>
				{:else if error}
					<div class="text-destructive font-mono text-sm">{error}</div>
				{:else if content && content.length > 0}
					<div class="space-y-4">
						{#each content as item, i}
							<div class="bg-white/5 p-3 rounded">
								{#if item.mimeType}
									<div class="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">{item.mimeType}</div>
								{/if}
								{#if 'text' in item && item.text}
									<pre class="text-green-400 font-mono text-xs whitespace-pre-wrap break-all">{item.text}</pre>
								{:else if 'blob' in item && item.blob}
									<div class="text-blue-400 font-mono text-xs italic">[Binary Blob Data: {item.blob.substring(0, 50)}...]</div>
								{:else}
									<div class="text-yellow-400 font-mono text-xs italic">Unsupported content format</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-muted-foreground font-mono text-sm">Resource is empty.</div>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="secondary" onclick={() => handleOpenChange(false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
