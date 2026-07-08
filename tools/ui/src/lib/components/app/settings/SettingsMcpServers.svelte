<script lang="ts">
	import { X, Plus, Network } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { toolsStore } from '$lib/stores/tools.svelte';
	import { ActionIcon, McpServerCard, McpServerCardSkeleton } from '$lib/components/app';
	import { DialogMcpServerAddNew } from '$lib/components/app/dialogs';
	import { HealthCheckStatus } from '$lib/enums';
	import { ROUTES } from '$lib/constants';
	import { fade, slide, fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';
	import McpLogo from '../mcp/McpLogo.svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();

	let servers = $derived(mcpStore.getServersSorted());

	let initialLoadComplete = $state(false);
	let isAddingServer = $state(false);

	let previousRouteId = $state<string | null>(null);

	$effect(() => {
		const currentId = page.route.id;
		return () => {
			previousRouteId = currentId;
		};
	});

	function handleClose() {
		const prevIsMcpServers = previousRouteId === '/mcp-servers';
		if (browser && window.history.length > 1 && !prevIsMcpServers) {
			history.back();
		} else {
			goto(ROUTES.START);
		}
	}

	onMount(() => {
		if (page.url.searchParams.has('add')) {
			isAddingServer = true;

			const newUrl = new URL(page.url);
			newUrl.searchParams.delete('add');

			replaceState(newUrl, {});
		}
	});

	$effect(() => {
		if (initialLoadComplete) return;

		const allChecked =
			servers.length > 0 &&
			servers.every((server) => {
				const isEnabled = conversationsStore.isMcpServerEnabledForChat(server.id);
				if (!isEnabled) return true; // Disabled servers don't block initial load

				const state = mcpStore.getHealthCheckState(server.id);

				return (
					state.status === HealthCheckStatus.SUCCESS || state.status === HealthCheckStatus.ERROR
				);
			});

		if (allChecked) {
			initialLoadComplete = true;
		}
	});
</script>

<div in:fade={{ duration: 150 }}>
	<div class="fixed top-4.5 right-4 z-50 md:hidden">
		<ActionIcon icon={X} tooltip="Close" onclick={handleClose} />
	</div>

	<div class="flex justify-end mb-2 px-4 md:px-8 mt-2">
		<Button
			variant="outline"
			size="lg"
			class="shrink-0 fixed md:static bottom-6 right-6 z-10 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 rounded-xl font-bold transition-all hover:scale-[1.02] active:scale-95"
			onclick={() => (isAddingServer = true)}
		>
			<Plus class="h-5 w-5 mr-1" />
			Add New Server
		</Button>
	</div>

	<DialogMcpServerAddNew bind:open={isAddingServer} />

	<div class="grid gap-5 md:space-y-4 {className}">
		{#if servers.length === 0 && !isAddingServer}
			<div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-muted/5 rounded-2xl border-2 border-border/20 border-dashed m-2" transition:slide={{ duration: 300 }}>
				<div class="w-16 h-16 mb-5 rounded-full bg-background flex items-center justify-center border border-border/50 shadow-sm">
					<Network class="h-8 w-8 text-muted-foreground/60" />
				</div>
				<h3 class="text-xl font-bold tracking-tight mb-2">No MCP Servers Connected</h3>
				<p class="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
					Connect your LLMs to external APIs and tools. Add your first server to enable powerful agentic workflows.
				</p>
			</div>
		{/if}

		{#if servers.length > 0}
			<div
				class="grid gap-3"
				style="grid-template-columns: repeat(auto-fill, minmax(min(32rem, calc(100dvw - 2rem)), 1fr));"
			>
				{#each servers as server (server.id)}
					<div animate:flip={{ duration: 300 }}>
						{#if !initialLoadComplete}
							<McpServerCardSkeleton />
						{:else}
							<div transition:slide|local={{ duration: 300 }}>
								<McpServerCard
									{server}
									processStatus={mcpStore.getProcessStatus(server.id)}
									enabled={conversationsStore.isMcpServerEnabledForChat(server.id)}
									onToggle={async () => {
										const wasEnabled = conversationsStore.isMcpServerEnabledForChat(server.id);
										await conversationsStore.toggleMcpServerForChat(server.id);
										if (!wasEnabled) {
											toolsStore.enableAllToolsForServer(server.id);
										}
									}}
									onUpdate={(updates) => mcpStore.updateServer(server.id, updates)}
									onDelete={() => mcpStore.removeServer(server.id)}
								/>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
