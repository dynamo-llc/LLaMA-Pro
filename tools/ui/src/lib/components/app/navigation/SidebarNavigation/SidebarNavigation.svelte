<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PanelLeftClose, PanelLeftOpen, X } from '@lucide/svelte';
	import {
		ActionIcon,
		Logo,
		SidebarNavigationConversationList,
		SidebarNavigationActions
	} from '$lib/components/app';
	import { ROUTES } from '$lib/constants';
	import { fade } from 'svelte/transition';

	import { base } from '$app/paths';
	import { useKeyboardShortcuts } from '$lib/hooks/use-keyboard-shortcuts.svelte';
	import { conversationsStore, conversations } from '$lib/stores/conversations.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { RouterService } from '$lib/services/router.service';
	import { isMobile } from '$lib/stores/viewport.svelte';
	import { TooltipSide } from '$lib/enums';
	import { device } from '$lib/stores/device.svelte';
	import { circIn } from 'svelte/easing';
	import { serverStore } from '$lib/stores/server.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { copyToClipboard } from '$lib/utils';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Server, Copy } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { getDaemonUrl } from '$lib/utils/get-base-url';

	let isServerAlive = $state(false);
	let healthCheckFailed = $state(false);
	let activeInferenceCount = $state(0);
	
	let latticaPeerCount = $state(0);
	let isContributingCompute = $state(false);
	let isUsingMeshInference = $state(false);
	let isBackendRestarting = $state(false);

	async function checkServerHealth() {
		try {
			const res = await fetch(`${base}/telemetry/app`, { cache: 'no-store' });
			if (res.ok) {
				isServerAlive = true;
				healthCheckFailed = false;
				const data = await res.json();
				activeInferenceCount = data.inferProcessing || 0;
			} else {
				isServerAlive = false;
				healthCheckFailed = true;
				activeInferenceCount = 0;
			}
		} catch (e) {
			isServerAlive = false;
			healthCheckFailed = true;
			activeInferenceCount = 0;
		}

		try {
			const latticaRes = await fetch(`${getDaemonUrl('lattica')}/peers`);
			if (latticaRes.ok) {
				const data = await latticaRes.json();
				latticaPeerCount = data.count || 0;
			}
		} catch (e) {
			// Lattica daemon might not be running
			latticaPeerCount = 0;
		}
	}

	async function toggleComputeContribution() {
		if (typeof window !== 'undefined' && (window as any).electronAPI) {
			isContributingCompute = !isContributingCompute;
			if (isContributingCompute) {
				await (window as any).electronAPI.startRpcServer();
			} else {
				await (window as any).electronAPI.stopRpcServer();
			}
		} else {
			alert('Compute contribution requires the desktop application.');
		}
	}

	async function toggleMeshInference() {
		if (typeof window !== 'undefined' && (window as any).electronAPI) {
			isUsingMeshInference = !isUsingMeshInference;
			isBackendRestarting = true;
			try {
				await (window as any).electronAPI.restartBackend({ useMesh: isUsingMeshInference });
			} finally {
				// Wait a few seconds for the health checks to naturally recover after backend comes online
				setTimeout(() => isBackendRestarting = false, 3000);
			}
		} else {
			alert('Mesh Inference requires the desktop application.');
		}
	}

	onMount(() => {
		checkServerHealth();
		const interval = setInterval(checkServerHealth, 5000);
		return () => clearInterval(interval);
	});

	const serverStatus = $derived.by(() => {
		if (healthCheckFailed) {
			return 'Offline';
		}
		if (serverStore.error) {
			return 'Error';
		}
		if (!isServerAlive) {
			return 'Offline';
		}
		const isGenerating =
			chatStore.isLoading || chatStore.chatStreamingStates.size > 0 || activeInferenceCount > 0;
		const isModelLoading =
			modelsStore.updating || modelsStore.loading || modelsStore.loadingModelIds.length > 0;
		if (isGenerating || isModelLoading) {
			return 'Online';
		}
		return 'Idle';
	});

	const serverHost = $derived.by(() => {
		if (typeof window !== 'undefined') {
			let host = window.location.hostname;
			if (!host || host === '-') {
				host = '127.0.0.1';
			}
			let port = window.llamaPort || window.location.port || '8080';
			return `${window.location.protocol === 'app:' ? 'http:' : window.location.protocol}//${host}:${port}`;
		}
		return `http://localhost:8080`;
	});

	const orchestratorHost = $derived.by(() => {
		if (typeof window !== 'undefined') {
			let host = window.location.hostname;
			if (!host || host === '-') {
				host = '127.0.0.1';
			}
			let port = window.orchestratorPort || '8000';
			return `${window.location.protocol === 'app:' ? 'http:' : window.location.protocol}//${host}:${port}`;
		}
		return `http://localhost:8000`;
	});

	const loadedSlots = $derived.by(() => {
		const slots = ['<None>', '<None>', '<None>', '<None>'];
		if (serverStatus === 'Offline') {
			return slots;
		}
		if (!serverStore.isRouterMode) {
			const name = modelsStore.singleModelName;
			if (name) {
				slots[0] = name;
			}
		} else {
			const loaded = modelsStore.loadedModelIds;
			const loading = modelsStore.loadingModelIds;

			for (let i = 0; i < Math.min(loaded.length, 4); i++) {
				slots[i] = loaded[i];
			}

			// Fill remaining slots with currently loading models
			let nextSlot = loaded.length;
			for (let i = 0; i < Math.min(loading.length, 4 - nextSlot); i++) {
				slots[nextSlot + i] = loading[i];
			}
		}
		return slots;
	});

	const endpoint1 = $derived(`${serverHost}/v1/chat/completions`);
	const endpoint2 = $derived(`${orchestratorHost}/v1/orchestra/chat/completions`);
	const endpoint3 = $derived(`${orchestratorHost}/v1/swarm/chat/completions`);

	const dotStyle = $derived.by(() => {
		switch (serverStatus) {
			case 'Online':
				return 'background-color: #00d2ff; box-shadow: 0 0 8px #00d2ff;'; // Electric Blue
			case 'Idle':
				return 'background-color: #4ade80; box-shadow: 0 0 8px #4ade80;'; // Green
			default:
				return 'background-color: #9ca3af;'; // Grey
		}
	});

	const statusPulseClass = $derived(
		serverStatus === 'Offline' || serverStatus === 'Error' ? 'blink-slow' : ''
	);

	interface Props {
		onSearchClick?: () => void;
	}

	let { onSearchClick = () => {} }: Props = $props();

	const { handleKeydown } = useKeyboardShortcuts({ activateSearchMode: () => onSearchClick() });

	let isExpandedMode = $state(false);
	let hoveredTooltip = $state<string | null>(null);
	let logoHovered = $state(false);

	let isMonitorOpen = $state(false);
	let monitorTimeout: ReturnType<typeof setTimeout> | null = null;

	function showMonitor() {
		if (monitorTimeout) {
			clearTimeout(monitorTimeout);
			monitorTimeout = null;
		}
		isMonitorOpen = true;
	}

	function hideMonitor() {
		if (monitorTimeout) {
			clearTimeout(monitorTimeout);
		}
		monitorTimeout = setTimeout(() => {
			isMonitorOpen = false;
			monitorTimeout = null;
		}, 200);
	}

	function toggleMonitor(e: MouseEvent) {
		e.stopPropagation();
		if (monitorTimeout) {
			clearTimeout(monitorTimeout);
			monitorTimeout = null;
		}
		isMonitorOpen = !isMonitorOpen;
	}

	function handleGlobalClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.server-monitor-trigger') && !target.closest('.server-monitor-card')) {
			isMonitorOpen = false;
		}
	}

	const isStripExpanded = $derived(isExpandedMode || hoveredTooltip !== null);
	const isOnMobile = $derived(isMobile.current);
	const alwaysShowOnDesktop = $derived(config().alwaysShowSidebarOnDesktop as boolean);

	// Keep the sidebar expanded on desktop when the user pins it open
	$effect(() => {
		if (alwaysShowOnDesktop && !isOnMobile) {
			isExpandedMode = true;
		}
	});

	function toggleExpandedMode() {
		isExpandedMode = !isExpandedMode;
		if (!isExpandedMode) {
			hoveredTooltip = null;
		}
	}

	$effect(() => {
		if (!isExpandedMode) {
			isSearchModeActive = false;
			searchQuery = '';
			cancelMobileCollapse();
		}
	});

	// On mobile the dedicated /search route hides the sidebar (see the aside
	// render guard below). Collapse it as we enter /search so it doesn't
	// reappear expanded when the user navigates back via the back button.
	$effect(() => {
		if (isMobile.current && page.url.hash.includes(ROUTES.SEARCH)) {
			isExpandedMode = false;
		}
	});

	let currentChatId = $derived(page.params.id);
	let isSearchModeActive = $state(false);
	let searchQuery = $state('');

	let filteredConversations = $derived.by(() => {
		if (isSearchModeActive) {
			if (searchQuery.trim().length > 0) {
				return conversations().filter((conversation: { name: string }) =>
					conversation.name.toLowerCase().includes(searchQuery.toLowerCase())
				);
			}

			return [];
		}

		return conversations();
	});

	async function selectConversation(id: string) {
		if (isMobile.current) {
			scheduleMobileCollapse();
		}
		await goto(RouterService.chat(id));
	}

	async function handleEditConversation(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (!conversation) return;

		const newName = window.prompt('Rename conversation', conversation.name);
		if (newName && newName.trim()) {
			await conversationsStore.updateConversationName(id, newName.trim());
		}
	}

	async function handleDeleteConversation(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (!conversation) return;

		const confirmed = window.confirm(
			`Delete "${conversation.name}"? This action cannot be undone.`
		);
		if (!confirmed) return;

		await conversationsStore.deleteConversation(id, { deleteWithForks: false });
	}

	function handleStopGeneration(id: string) {
		chatStore.stopGenerationForChat(id);
	}

	let innerWidth = $state(0);
	let pendingCollapse = $state<ReturnType<typeof setTimeout> | null>(null);

	function scheduleMobileCollapse() {
		if (pendingCollapse) {
			clearTimeout(pendingCollapse);
		}
		pendingCollapse = setTimeout(() => {
			isExpandedMode = false;
			pendingCollapse = null;
		}, 100);
	}

	function cancelMobileCollapse() {
		if (pendingCollapse) {
			clearTimeout(pendingCollapse);
			pendingCollapse = null;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleGlobalClick} bind:innerWidth />

{#if innerWidth > 768 || (!page.url.hash.includes(ROUTES.SETTINGS) && !page.url.hash.includes(ROUTES.MCP_SERVERS) && !page.url.hash.includes(ROUTES.SEARCH))}
	<aside
		onmouseenter={() => (isExpandedMode = true)}
		onmouseleave={() => (isExpandedMode = false)}
		class={[
			// Layout & positioning
			'fixed md:sticky top-2 left-2 md:left-0 md:ml-2 md:mt-2 pt-2 z-10 w-[calc(100dvw-1rem)]',
			// Dimensions & overflow
			'md:h-[calc(100dvh-1.125rem)]',
			isExpandedMode &&
				(device.isStandalone
					? 'h-[calc(100dvh-2rem)]'
					: device.isIOSDevice
						? 'h-[calc(100dvh-0.5rem)]'
						: 'h-[calc(100dvh-1rem)]'),
			// Shape & depth
			'rounded-3xl md:rounded-2xl',
			// Flex layout
			'flex flex-col justify-between',
			// Transition
			'md:transition-[width,padding] duration-200 ease-out',
			// Expanded state: width, surface, depth
			isStripExpanded && 'md:w-72 md:bg-muted/60 md:backdrop-blur-xl border-border shadow-md',
			// Collapsed state
			!isStripExpanded && 'md:w-12',
			// Expanded mode flag (for mobile ::before overlay)
			isExpandedMode && 'is-expanded'
		]}
	>
		<div class="mt-2 flex min-h-0 flex-1 flex-col gap-4 md:gap-1 overflow-y-auto">
			<div
				class="flex min-h-0 flex-1 flex-col gap-4 md:gap-1 {isMobile.current
					? 'transition-[opacity,height] duration-200 ease-out'
					: ''} {isMobile.current && !isExpandedMode ? 'opacity-0 !h-0' : ''}"
				in:fade={{ duration: 200 }}
				out:fade={{ duration: 200 }}
			>
				<SidebarNavigationActions
					isExpandedMode={innerWidth > 768 ? isExpandedMode : true}
					class="px-2"
					bind:isSearchModeActive
					bind:searchQuery
					onSearchDeactivated={() => {
						isSearchModeActive = false;
						searchQuery = '';
					}}
					onSearchClick={() => {
						isExpandedMode = true;
						isSearchModeActive = true;
					}}
					onNewChat={() => {
						if (isMobile.current) {
							scheduleMobileCollapse();
						}
					}}
				/>

				{#if (isExpandedMode || isOnMobile) && (!page.url.hash || page.url.hash === '#/' || page.url.hash.startsWith('#/chat') || page.url.hash.includes('new_chat='))}
					<SidebarNavigationConversationList
						class="px-2"
						{filteredConversations}
						{currentChatId}
						{isSearchModeActive}
						{searchQuery}
						onSelect={selectConversation}
						onEdit={handleEditConversation}
						onDelete={handleDeleteConversation}
						onStop={handleStopGeneration}
					/>
				{/if}
			</div>
		</div>

		<!-- Server Info & Status Section (spacer only - panel is rendered as fixed overlay below) -->
		<div class="w-full pb-2 mt-auto"></div>
	</aside>
{/if}

{#snippet statusCard()}
	<div
		class="w-64 bg-card/95 backdrop-blur-md border border-border/60 rounded-2xl p-4 shadow-lg text-card-foreground text-xs flex flex-col gap-3 font-sans select-none"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border/40 pb-2">
			<span class="font-semibold text-xs tracking-wider uppercase opacity-85">Server Monitor</span>
			<div class="flex items-center gap-1.5 font-medium">
				<span class="h-2 w-2 rounded-full {statusPulseClass}" style={dotStyle}></span>
				<span class="text-[11px] capitalize">{serverStatus}</span>
			</div>
		</div>

		<!-- Address -->
		<div class="flex flex-col gap-1">
			<span class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
				>Address</span
			>
			<div
				class="flex items-center justify-between bg-muted/50 rounded-lg p-1.5 font-mono text-[11px] border border-border/30"
			>
				<span class="truncate pr-1">{serverHost}</span>
				<button
					onclick={() => copyToClipboard(serverHost)}
					class="hover:text-foreground text-muted-foreground p-0.5 rounded transition-colors"
					aria-label="Copy server address"
				>
					<Copy class="h-3 w-3" />
				</button>
			</div>
		</div>

		<!-- Loaded Models -->
		<div class="flex flex-col gap-1">
			<span class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
				>Loaded Models</span
			>
			<div
				class="flex flex-col gap-1 bg-muted/30 rounded-lg p-2 border border-border/20 font-mono text-[10px]"
			>
				{#each loadedSlots as slotModel, i}
					{@const isModelLoading =
						slotModel !== '<None>' && modelsStore.isModelOperationInProgress(slotModel)}
					{@const loadProgressInfo = isModelLoading ? modelsStore.getLoadProgress(slotModel) : null}
					<div class="flex flex-col gap-1 {isModelLoading ? 'mb-1' : ''}">
						<div class="flex items-center justify-between gap-2">
							<span class="text-muted-foreground font-semibold">Slot #{i + 1}:</span>
							<span
								class="truncate text-right flex-1 {slotModel === '<None>'
									? 'italic text-muted-foreground/50'
									: isModelLoading
										? 'text-primary animate-pulse'
										: 'text-foreground'}"
								title={slotModel}
							>
								{slotModel}
							</span>
						</div>
						{#if isModelLoading && loadProgressInfo}
							{@const val = Math.round(loadProgressInfo.value * 100)}
							<div
								class="flex items-center justify-between text-[8.5px] text-muted-foreground font-semibold tracking-wider mt-0.5"
							>
								<span>LOADING...</span>
								<span>{val}%</span>
							</div>
							<div class="h-1 w-full bg-muted overflow-hidden rounded-full">
								<div
									class="h-full bg-primary transition-all duration-300"
									style="width: {val}%"
								></div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Active Endpoints -->
		<div class="flex flex-col gap-1.5">
			<span class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
				>Active Endpoints</span
			>
			<div class="flex flex-col gap-1">
				<!-- Endpoint 1 -->
				<div class="flex flex-col bg-muted/40 rounded-lg p-1.5 border border-border/20">
					<div
						class="flex items-center justify-between text-[9px] text-muted-foreground font-semibold uppercase"
					>
						<span>Loaded Local Models</span>
					</div>
					<div class="flex items-center justify-between font-mono text-[10px] mt-0.5">
						<span class="truncate text-foreground/80">{endpoint1}</span>
						<button
							onclick={() => copyToClipboard(endpoint1)}
							class="hover:text-foreground text-muted-foreground p-0.5 rounded transition-colors"
							aria-label="Copy local endpoint"
						>
							<Copy class="h-3 w-3" />
						</button>
					</div>
				</div>

				<!-- Endpoint 2 -->
				<div class="flex flex-col bg-muted/40 rounded-lg p-1.5 border border-border/20">
					<div
						class="flex items-center justify-between text-[9px] text-muted-foreground font-semibold uppercase"
					>
						<span>Agent Swarms (MoA)</span>
					</div>
					<div class="flex items-center justify-between font-mono text-[10px] mt-0.5">
						<span class="truncate text-foreground/80">{endpoint3}</span>
						<button
							onclick={() => copyToClipboard(endpoint3)}
							class="hover:text-foreground text-muted-foreground p-0.5 rounded transition-colors"
							aria-label="Copy swarm endpoint"
						>
							<Copy class="h-3 w-3" />
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Lattica Network -->
		<div class="flex flex-col gap-1.5 pt-2 border-t border-border/40">
			<span class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
				>Lattica Network</span
			>
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between bg-muted/40 rounded-lg p-1.5 border border-border/20">
					<span class="text-[10px] font-semibold text-foreground/80">Active Peers</span>
					<span class="font-mono text-[10px] bg-primary/20 text-primary px-1.5 rounded">{latticaPeerCount}</span>
				</div>
				
				<div class="flex items-center justify-between bg-muted/40 rounded-lg p-1.5 border border-border/20">
					<span class="text-[10px] font-semibold text-foreground/80" title="Serve your GPU compute to the network">Contribute Compute</span>
					<button 
						onclick={toggleComputeContribution}
						class="relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 {isContributingCompute ? 'bg-primary' : 'bg-muted-foreground/30'}"
						role="switch"
						aria-checked={isContributingCompute}
					>
						<span class="sr-only">Contribute Compute</span>
						<span
							aria-hidden="true"
							class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out {isContributingCompute ? 'translate-x-3.5' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				<div class="flex items-center justify-between bg-muted/40 rounded-lg p-1.5 border border-border/20">
					<span class="text-[10px] font-semibold text-foreground/80" title="Distribute inference across Lattica peers">
						Use Mesh Inference
						{#if isBackendRestarting}
							<span class="ml-1 opacity-70 animate-pulse text-[8px]">(restarting...)</span>
						{/if}
					</span>
					<button 
						onclick={toggleMeshInference}
						disabled={isBackendRestarting}
						class="relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 {isUsingMeshInference ? 'bg-primary' : 'bg-muted-foreground/30'} disabled:opacity-50 disabled:cursor-not-allowed"
						role="switch"
						aria-checked={isUsingMeshInference}
					>
						<span class="sr-only">Use Mesh Inference</span>
						<span
							aria-hidden="true"
							class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out {isUsingMeshInference ? 'translate-x-3.5' : 'translate-x-0'}"
						></span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/snippet}

<!-- Fixed lower-left Server Monitor trigger + popover -->
<div
	role="region"
	aria-label="Server monitor controls"
	class="fixed bottom-3 left-3 z-50 flex flex-col items-start gap-2"
	onmouseleave={hideMonitor}
>
	{#if isMonitorOpen}
		<div
			role="region"
			aria-label="Server monitor status"
			class="server-monitor-card mb-1"
			onmouseenter={showMonitor}
			transition:fade={{ duration: 120 }}
		>
			{@render statusCard()}
		</div>
	{/if}
	<button
		class="server-monitor-trigger relative h-9 w-9 rounded-full bg-card border border-border/60 shadow-md flex items-center justify-center hover:bg-muted transition-colors"
		onclick={toggleMonitor}
		onmouseenter={showMonitor}
		aria-label="Toggle server monitor"
		title="Server Monitor"
	>
		<Server class="h-4 w-4 text-muted-foreground" />
		<span
			class="absolute top-1 right-1 h-2 w-2 rounded-full border border-card {statusPulseClass}"
			style={dotStyle}
		></span>
	</button>
</div>

<style>
	aside {
		@media (max-width: 768px) {
			--size: 1.125rem;
		}
	}

	@media (max-width: 768px) {
		aside {
			&:not(.is-expanded) {
				pointer-events: none;
			}
		}

		aside.is-expanded::before {
			content: '';
			position: fixed;
			top: -0.5rem;
			bottom: -0.25rem;
			left: -0.5rem;
			right: -0.5rem;
			z-index: -1;
			background: var(--background);
			backdrop-filter: blur(1rem);
			pointer-events: none;
		}
	}

	.blink-slow {
		animation: blink-slow-anim 2.2s ease-in-out infinite;
	}

	@keyframes blink-slow-anim {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.25;
			transform: scale(0.9);
		}
	}
</style>
