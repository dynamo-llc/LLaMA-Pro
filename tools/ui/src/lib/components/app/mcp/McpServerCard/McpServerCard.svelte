<script lang="ts">
	import { tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { MCPServerSettingsEntry, HealthCheckState, MCPPromptInfo } from '$lib/types';
	import { HealthCheckStatus } from '$lib/enums';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { mcpResourceStore } from '$lib/stores/mcp-resources.svelte';
	import { toast } from 'svelte-sonner';
	import {
		McpServerCardActions,
		McpServerCardDeleteDialog,
		McpServerCardEditForm,
		McpServerCardHeader,
		McpServerCardToolsList,
		McpConnectionLogs,
		McpServerInfo
	} from '$lib/components/app/mcp';
	import McpLogsDialog from '$lib/components/app/mcp/McpLogsDialog.svelte';
	import McpToolPlayground from '$lib/components/app/mcp/McpToolPlayground.svelte';
	import McpResourceViewer from '$lib/components/app/mcp/McpResourceViewer.svelte';
	import McpPromptViewer from '$lib/components/app/mcp/McpPromptViewer.svelte';
	import McpServerCardResourcesList from '$lib/components/app/mcp/McpServerCard/McpServerCardResourcesList.svelte';
	import McpServerCardPromptsList from '$lib/components/app/mcp/McpServerCard/McpServerCardPromptsList.svelte';
	import { getBaseUrl } from '$lib/utils/get-base-url';

	interface Props {
		server: MCPServerSettingsEntry;
		processStatus?: 'running' | 'crashed' | 'unknown';
		enabled?: boolean;
		onToggle: (enabled: boolean) => void;
		onUpdate: (updates: Partial<MCPServerSettingsEntry>) => void;
		onDelete: () => void;
	}

	let { server, processStatus = 'unknown', enabled, onToggle, onUpdate, onDelete }: Props = $props();

	let healthState = $derived<HealthCheckState>(mcpStore.getHealthCheckState(server.id));
	let displayName = $derived(mcpStore.getServerLabel(server));
	let faviconUrl = $derived(mcpStore.getServerFavicon(server.id));
	let isIdle = $derived(healthState.status === HealthCheckStatus.IDLE);
	let isHealthChecking = $derived(healthState.status === HealthCheckStatus.CONNECTING);
	let isConnected = $derived(healthState.status === HealthCheckStatus.SUCCESS);
	let isError = $derived(healthState.status === HealthCheckStatus.ERROR);
	let showSkeleton = $derived(isIdle || isHealthChecking);
	let errorMessage = $derived(
		healthState.status === HealthCheckStatus.ERROR ? healthState.message : undefined
	);
	let tools = $derived(healthState.status === HealthCheckStatus.SUCCESS ? healthState.tools : []);

	let prompts = $state<MCPPromptInfo[]>([]);

	$effect(() => {
		if (healthState.status === HealthCheckStatus.SUCCESS && healthState.capabilities?.server?.prompts) {
			mcpStore.getServerPrompts(server.id).then(p => {
				prompts = p;
			});
		} else {
			prompts = [];
		}
	});

	let resources = $derived.by(() => {
		const serverResources = mcpResourceStore.serverResources.get(server.id);
		return serverResources?.resources || [];
	});

	let connectionLogs = $derived(
		healthState.status === HealthCheckStatus.CONNECTING ||
			healthState.status === HealthCheckStatus.SUCCESS ||
			healthState.status === HealthCheckStatus.ERROR
			? healthState.logs
			: []
	);

	let successState = $derived(
		healthState.status === HealthCheckStatus.SUCCESS ? healthState : null
	);
	let serverInfo = $derived(successState?.serverInfo);
	let capabilities = $derived(successState?.capabilities);
	let transportType = $derived(successState?.transportType);
	let protocolVersion = $derived(successState?.protocolVersion);
	let connectionTimeMs = $derived(successState?.connectionTimeMs);
	let instructions = $derived(successState?.instructions);

	let isEditing = $state(false);
	let showDeleteDialog = $state(false);
	let editFormRef: McpServerCardEditForm | null = $state(null);
	let showLogsDialog = $state(false);
	let showPlaygroundDialog = $state(false);
	let selectedToolForPlayground = $state<{name: string, schema?: any} | null>(null);
	let showResourceViewerDialog = $state(false);
	let selectedResourceForViewer = $state<{name: string, uri: string} | null>(null);
	let showPromptViewerDialog = $state(false);
	let selectedPromptForViewer = $state<MCPPromptInfo | null>(null);

	let isLocal = $derived.by(() => {
		try {
			const u = new URL(server.url);
			return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
		} catch (e) {
			return false;
		}
	});

	let localPort = $derived.by(() => {
		try {
			const u = new URL(server.url);
			if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
				return u.port;
			}
		} catch (e) {}
		return null;
	});

	async function handleRestart() {
		if (!localPort) return;
		try {
			toast.info(`Restarting ${displayName}...`);
			const orchestratorUrl = getBaseUrl('orchestrator');
			await fetch(`${orchestratorUrl}/api/mcp/${localPort}/restart`, { method: 'POST' });
			toast.success(`${displayName} restarted successfully.`);
		} catch (e) {
			toast.error(`Failed to restart ${displayName}`);
			console.error("Failed to restart server:", e);
		}
	}

	function handleHealthCheck() {
		toast.info(`Checking health for ${displayName}...`);
		mcpStore.runHealthCheck(server);
	}

	async function startEditing() {
		isEditing = true;
		await tick();
		editFormRef?.setInitialValues(
			server.url,
			server.headers || '',
			server.useProxy || false,
			server.name || ''
		);
	}

	function cancelEditing() {
		if (server.url.trim()) {
			isEditing = false;
		} else {
			onDelete();
		}
	}

	function saveEditing(url: string, headers: string, useProxy: boolean, name?: string) {
		onUpdate({
			url: url,
			headers: headers || undefined,
			useProxy: useProxy,
			name: name || undefined
		});
		isEditing = false;

		if (server.enabled && url) {
			setTimeout(() => mcpStore.runHealthCheck({ ...server, url, useProxy }), 100);
		}
	}

	function handleDeleteClick() {
		showDeleteDialog = true;
	}

	async function handleConfirmDelete() {
		try {
			await onDelete();
			toast.success(`${displayName} deleted.`);
		} catch (e) {
			toast.error(`Failed to delete ${displayName}.`);
		}
		showDeleteDialog = false;
	}
</script>

<Card.Root class="!gap-3 p-4 border-l-4 {isConnected ? 'border-l-green-500/80 bg-muted/10' : isError ? 'border-l-destructive/80 bg-destructive/5' : 'border-l-border bg-muted/5'} backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-300">
	{#if isEditing}
		<McpServerCardEditForm
			bind:this={editFormRef}
			serverId={server.id}
			serverUrl={server.url}
			serverName={server.name}
			serverUseProxy={server.useProxy}
			onSave={saveEditing}
			onCancel={cancelEditing}
		/>
	{:else}
		<McpServerCardHeader
			{displayName}
			{faviconUrl}
			enabled={enabled ?? server.enabled}
			disabled={isHealthChecking}
			{onToggle}
			{serverInfo}
			{capabilities}
			{transportType}
			{processStatus}
			uptimeSeconds={mcpStore.getProcessUptime(server.id)}
		/>

		{#if isError && errorMessage}
			<p class="text-xs text-destructive bg-destructive/10 p-2 rounded-md border border-destructive/20 font-medium" transition:slide|local={{ duration: 200 }}>{errorMessage}</p>
		{/if}

		{#if isConnected && serverInfo?.description}
			<p class="line-clamp-2 text-xs text-muted-foreground">
				{serverInfo.description}
			</p>
		{/if}

		<div class="grid gap-3">
			{#if showSkeleton}
				<div class="space-y-2" transition:slide|local={{ duration: 200 }}>
					<div class="flex items-center gap-2">
						<Skeleton class="h-4 w-4 rounded" />
						<Skeleton class="h-3 w-24" />
					</div>
					<div class="flex flex-wrap gap-1.5">
						<Skeleton class="h-5 w-16 rounded-full" />
						<Skeleton class="h-5 w-20 rounded-full" />
						<Skeleton class="h-5 w-14 rounded-full" />
					</div>
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center gap-2">
						<Skeleton class="h-4 w-4 rounded" />
						<Skeleton class="h-3 w-32" />
					</div>
				</div>
			{:else}
				{#if isConnected && instructions}
					<div transition:slide|local={{ duration: 200 }}>
						<McpServerInfo {instructions} />
					</div>
				{/if}

				{#if tools.length > 0}
					<div transition:slide|local={{ duration: 200 }}>
						<McpServerCardToolsList 
							{tools} 
							onTestTool={(tool) => {
								selectedToolForPlayground = tool;
								showPlaygroundDialog = true;
							}}
						/>
					</div>
				{/if}

				{#if resources.length > 0}
					<div transition:slide|local={{ duration: 200 }}>
						<McpServerCardResourcesList 
							{resources} 
							onReadResource={(res) => {
								selectedResourceForViewer = res;
								showResourceViewerDialog = true;
							}}
						/>
					</div>
				{/if}

				{#if prompts.length > 0}
					<div transition:slide|local={{ duration: 200 }}>
						<McpServerCardPromptsList 
							{prompts} 
							onGetPrompt={(prompt) => {
								selectedPromptForViewer = prompt;
								showPromptViewerDialog = true;
							}}
						/>
					</div>
				{/if}

				{#if connectionLogs.length > 0}
					<div transition:slide|local={{ duration: 200 }}>
						<McpConnectionLogs logs={connectionLogs} {connectionTimeMs} />
					</div>
				{/if}
			{/if}
		</div>

		<div class="flex justify-between gap-4">
			{#if showSkeleton}
				<Skeleton class="h-3 w-28" />
			{:else if protocolVersion}
				<div class="flex flex-wrap items-center gap-1">
					<span class="text-[10px] text-muted-foreground">
						Protocol version: {protocolVersion}
					</span>
				</div>
			{/if}

			<McpServerCardActions
				{isHealthChecking}
				{isLocal}
				onEdit={startEditing}
				onRefresh={handleHealthCheck}
				onViewLogs={() => showLogsDialog = true}
				onRestart={handleRestart}
				onDelete={handleDeleteClick}
			/>
		</div>
	{/if}
</Card.Root>

<McpServerCardDeleteDialog
	bind:open={showDeleteDialog}
	{displayName}
	onOpenChange={(open) => (showDeleteDialog = open)}
	onConfirm={handleConfirmDelete}
/>

{#if localPort}
	<McpLogsDialog
		bind:open={showLogsDialog}
		port={localPort}
		serverName={displayName}
	/>
{/if}

{#if selectedToolForPlayground}
	<McpToolPlayground
		bind:open={showPlaygroundDialog}
		toolName={selectedToolForPlayground.name}
		schema={selectedToolForPlayground.schema}
		serverName={displayName}
		onOpenChange={(isOpen) => {
			if (!isOpen) setTimeout(() => selectedToolForPlayground = null, 300);
		}}
	/>
{/if}

{#if selectedResourceForViewer}
	<McpResourceViewer
		bind:open={showResourceViewerDialog}
		resourceName={selectedResourceForViewer.name}
		uri={selectedResourceForViewer.uri}
		serverName={displayName}
		onOpenChange={(isOpen) => {
			if (!isOpen) setTimeout(() => selectedResourceForViewer = null, 300);
		}}
	/>
{/if}

{#if selectedPromptForViewer}
	<McpPromptViewer
		bind:open={showPromptViewerDialog}
		prompt={selectedPromptForViewer}
		serverName={displayName}
		onOpenChange={(isOpen) => {
			if (!isOpen) setTimeout(() => selectedPromptForViewer = null, 300);
		}}
	/>
{/if}
