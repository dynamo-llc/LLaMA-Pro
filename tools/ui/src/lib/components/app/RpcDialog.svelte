<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Users, Server, Shield, Loader2, Play, CheckCircle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';

	import { modelsStore } from '$lib/stores/models.svelte';

	let { open = $bindable(false) } = $props();

	let peers = $state<Record<string, any>>({});
	let pendingRequests = $state<any[]>([]);
	let isSharingEnabled = $state(false);
	let alwaysShare = $state(false);
	let loading = $state(false);

	let pollInterval: ReturnType<typeof setInterval>;

	const ORCHESTRATOR_URL = 'http://localhost:8000';

	async function fetchSettings() {
		try {
			const res = await fetch(`${ORCHESTRATOR_URL}/api/rpc/settings`);
			if (res.ok) {
				const data = await res.json();
				isSharingEnabled = data.is_sharing_enabled;
				alwaysShare = data.always_share;
			}
		} catch (e) {
			console.error('Failed to fetch RPC settings', e);
		}
	}

	async function saveSettings() {
		try {
			await fetch(`${ORCHESTRATOR_URL}/api/rpc/settings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					is_sharing_enabled: isSharingEnabled,
					always_share: alwaysShare
				})
			});
			toast.success('RPC settings saved');
		} catch (e) {
			toast.error('Failed to save settings');
		}
	}

	async function fetchPeers() {
		try {
			const res = await fetch(`${ORCHESTRATOR_URL}/api/rpc/peers`);
			if (res.ok) {
				const data = await res.json();
				peers = data.peers || {};
			}
		} catch (e) {
			console.error('Failed to fetch peers', e);
		}
	}

	async function fetchPendingRequests() {
		try {
			const res = await fetch(`${ORCHESTRATOR_URL}/api/rpc/pending-requests`);
			if (res.ok) {
				const data = await res.json();
				pendingRequests = data.requests || [];
			}
		} catch (e) {
			console.error('Failed to fetch requests', e);
		}
	}

	async function authorizeRequest(reqId: string, accept: boolean) {
		try {
			const res = await fetch(`${ORCHESTRATOR_URL}/api/rpc/authorize/${reqId}?accept=${accept}`, {
				method: 'POST'
			});
			if (res.ok) {
				toast.success(accept ? 'Request Accepted' : 'Request Rejected');
				await fetchPendingRequests();
			}
		} catch (e) {
			toast.error('Failed to authorize request');
		}
	}

	async function connectToPeer(peerId: string) {
		loading = true;
		try {
			toast.info('Connecting to peer...');
			const res = await fetch(`${ORCHESTRATOR_URL}/api/rpc/connect/${peerId}`, { method: 'POST' });
			const data = await res.json();
			if (data.status === 'success') {
				const existing = modelsStore.activeRpcPeers.find((p) => p.id === peerId);
				if (!existing) {
					const peerName = peers[peerId]?.hostname || peerId;
					modelsStore.activeRpcPeers.push({
						id: peerId,
						name: peerName,
						endpoint: data.rpc_endpoint
					});
				}
				toast.success('Added to Compute Pool! New models will use this node.');
			} else {
				toast.error(`Connection failed: ${data.message}`);
			}
		} catch (e) {
			toast.error('Connection error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchSettings();
		pollInterval = setInterval(() => {
			if (open) {
				fetchPeers();
				fetchPendingRequests();
			}
		}, 2000);
	});

	onDestroy(() => {
		clearInterval(pollInterval);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[600px] h-full max-h-[90vh] overflow-hidden flex flex-col p-0">
		<div class="px-6 py-4 border-b">
			<Dialog.Title class="flex items-center gap-2">
				<Server class="w-5 h-5 text-primary" />
				Distributed Inference
			</Dialog.Title>
			<Dialog.Description>
				Share resources or connect to other machines on your local network.
			</Dialog.Description>
		</div>

		<div class="flex-1 overflow-y-auto p-6 space-y-6">
			<!-- Settings Section -->
			<div class="space-y-4">
				<h3 class="text-sm font-medium flex items-center gap-2">
					<Shield class="w-4 h-4 text-muted-foreground" />
					Local Machine Settings
				</h3>

				<div class="p-4 bg-muted/30 rounded-lg space-y-4 border">
					<div class="flex items-center justify-between">
						<div class="space-y-1">
							<Label>Share Local Resources</Label>
							<p class="text-xs text-muted-foreground">Allow other machines to use your GPU/CPU</p>
						</div>
						<Switch bind:checked={isSharingEnabled} onCheckedChange={saveSettings} />
					</div>

					<div class="flex items-center justify-between">
						<div class="space-y-1">
							<Label>Auto-Accept Requests</Label>
							<p class="text-xs text-muted-foreground">
								Automatically accept incoming connection requests
							</p>
						</div>
						<Switch
							bind:checked={alwaysShare}
							onCheckedChange={saveSettings}
							disabled={!isSharingEnabled}
						/>
					</div>
				</div>
			</div>

			<!-- Pending Requests -->
			{#if pendingRequests.length > 0}
				<div class="space-y-3" transition:fade>
					<h3 class="text-sm font-medium text-amber-500">Pending Requests</h3>
					<div class="space-y-2">
						{#each pendingRequests as req}
							<div
								class="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-md"
							>
								<div>
									<p class="text-sm font-medium">{req.hostname}</p>
									<p class="text-xs text-muted-foreground">{req.ip}</p>
								</div>
								<div class="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onclick={() => authorizeRequest(req.id, false)}>Reject</Button
									>
									<Button size="sm" onclick={() => authorizeRequest(req.id, true)}>Accept</Button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Discovered Peers -->
			<div class="space-y-3">
				<h3 class="text-sm font-medium flex items-center gap-2">
					<Users class="w-4 h-4 text-muted-foreground" />
					Network Peers
				</h3>

				<div class="space-y-2">
					{#each Object.entries(peers) as [id, peer]}
						<div
							class="flex items-center justify-between p-4 bg-card border rounded-lg hover:border-primary/50 transition-colors"
						>
							<div class="flex items-center gap-3">
								<div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
									<Server class="w-5 h-5 text-primary" />
								</div>
								<div>
									<p class="text-sm font-medium">{peer.hostname}</p>
									<p class="text-xs text-muted-foreground">{peer.ip}</p>
								</div>
							</div>

							{#if peer.rpc_active}
								{#if modelsStore.activeRpcPeers.find((p) => p.id === id)}
									<Button size="sm" variant="secondary" disabled>
										<CheckCircle class="w-4 h-4 mr-2" />
										Added
									</Button>
								{:else}
									<Button
										size="sm"
										variant="secondary"
										onclick={() => connectToPeer(id)}
										disabled={loading}
									>
										{#if loading}
											<Loader2 class="w-4 h-4 mr-2 animate-spin" />
											Connecting...
										{:else}
											Add to Pool
										{/if}
									</Button>
								{/if}
							{:else}
								<span class="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full"
									>Not Sharing</span
								>
							{/if}
						</div>
					{:else}
						<div
							class="p-8 text-center text-muted-foreground text-sm border border-dashed rounded-lg"
						>
							No peers found on the local network. Make sure other machines have this app running.
						</div>
					{/each}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
