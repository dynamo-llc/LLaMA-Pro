<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { FileText, Loader2, RefreshCw } from '@lucide/svelte';
	import { getBaseUrl } from '$lib/utils/get-base-url';
	import { onMount } from 'svelte';

	interface Props {
		open: boolean;
		port: string;
		serverName: string;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), port, serverName, onOpenChange }: Props = $props();
	
	let logs = $state<string>('');
	let isLoading = $state<boolean>(true);
	let error = $state<string | null>(null);

	async function fetchLogs() {
		if (!port) return;
		isLoading = true;
		error = null;
		
		try {
			const orchestratorUrl = getBaseUrl('orchestrator');
			const res = await fetch(`${orchestratorUrl}/api/mcp/${port}/logs`);
			
			if (!res.ok) {
				throw new Error(`Failed to fetch logs: ${res.statusText}`);
			}
			
			const data = await res.json();
			logs = data.logs || 'No logs available.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
			logs = '';
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (open && port) {
			fetchLogs();
		} else {
			logs = '';
		}
	});

	function handleOpenChange(value: boolean) {
		open = value;
		onOpenChange?.(value);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-2xl max-h-[80vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<FileText class="w-5 h-5 text-primary" />
					Logs: {serverName}
				</div>
				<Button variant="ghost" size="icon" class="h-8 w-8 mr-6" onclick={fetchLogs} disabled={isLoading}>
					<RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
				</Button>
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex-grow overflow-auto bg-black rounded-md border border-border p-4 relative min-h-[300px]">
			{#if isLoading && !logs}
				<div class="absolute inset-0 flex items-center justify-center">
					<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
				</div>
			{:else if error}
				<div class="text-destructive font-mono text-sm">{error}</div>
			{:else}
				<pre class="text-green-400 font-mono text-xs whitespace-pre-wrap font-medium break-all">{logs}</pre>
			{/if}
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="secondary" onclick={() => handleOpenChange(false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
