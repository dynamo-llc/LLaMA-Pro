<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Activity, Globe, Network, Server, Zap, RefreshCw } from '@lucide/svelte';
	import { getDaemonUrl } from '$lib/utils/get-base-url';

	interface Peer {
		id: string;
		ip: string;
		endpoint: string;
		latency: number;
		geo: { lat: number; lng: number };
		status: string;
	}

	let peers = $state<Peer[]>([]);
	let loading = $state(true);
	let refreshInterval: ReturnType<typeof setInterval>;

	let totalVRAM = $derived(peers.length * 24); // mock 24GB per node
	let avgLatency = $derived(
		peers.length > 0 
		? Math.round(peers.reduce((acc, p) => acc + p.latency, 0) / peers.length) 
		: 0
	);

	async function fetchPeers() {
		try {
			const res = await fetch(`${getDaemonUrl('lattica')}/peers`);
			if (res.ok) {
				const data = await res.json();
				peers = data.peers || [];
			}
		} catch (err) {
			console.error('Failed to fetch Lattica peers', err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchPeers();
		refreshInterval = setInterval(fetchPeers, 5000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
	});

	// Map coordinates: lng (-180 to 180) -> x (0 to 100), lat (-90 to 90) -> y (100 to 0)
	function getX(lng: number) {
		return ((lng + 180) / 360) * 100;
	}

	function getY(lat: number) {
		return 100 - (((lat + 90) / 180) * 100);
	}
</script>

<div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
	<div>
		<h2 class="text-3xl font-bold tracking-tight flex items-center gap-3 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
			<Globe class="w-8 h-8 text-primary animate-[spin_10s_linear_infinite]" />
			Lattica Mesh Network
		</h2>
		<p class="text-sm text-muted-foreground mt-2 max-w-2xl">
			Real-time telemetry and visualization of your decentralized sovereign AI cluster. The network routes tensor computations dynamically based on node latency and availability.
		</p>
	</div>

	<!-- Stats Row -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<div class="rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/50 backdrop-blur-md p-5 shadow-lg hover:shadow-primary/5 transition-all duration-300 flex flex-col gap-1 group">
			<div class="flex items-center gap-2 text-muted-foreground/80 mb-2 group-hover:text-primary transition-colors">
				<Network class="w-4 h-4" />
				<span class="text-xs font-bold uppercase tracking-widest">Active Peers</span>
			</div>
			<span class="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-br from-foreground to-foreground/70">{peers.length}</span>
		</div>
		
		<div class="rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/50 backdrop-blur-md p-5 shadow-lg hover:shadow-green-500/5 transition-all duration-300 flex flex-col gap-1 group">
			<div class="flex items-center gap-2 text-muted-foreground/80 mb-2 group-hover:text-green-400 transition-colors">
				<Activity class="w-4 h-4" />
				<span class="text-xs font-bold uppercase tracking-widest">Avg Latency</span>
			</div>
			<div class="flex items-baseline gap-1">
				<span class="text-3xl font-black text-green-500">{avgLatency}</span>
				<span class="text-sm font-bold text-green-500/70">ms</span>
			</div>
		</div>
		
		<div class="rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/50 backdrop-blur-md p-5 shadow-lg hover:shadow-blue-500/5 transition-all duration-300 flex flex-col gap-1 group">
			<div class="flex items-center gap-2 text-muted-foreground/80 mb-2 group-hover:text-blue-400 transition-colors">
				<Server class="w-4 h-4" />
				<span class="text-xs font-bold uppercase tracking-widest">Compute Nodes</span>
			</div>
			<span class="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-br from-foreground to-foreground/70">{peers.length + 1}</span>
		</div>

		<div class="rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/50 backdrop-blur-md p-5 shadow-lg hover:shadow-primary/10 transition-all duration-300 flex flex-col gap-1 relative overflow-hidden group">
			<div class="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
			<div class="flex items-center gap-2 text-primary/80 mb-2">
				<Zap class="w-4 h-4" />
				<span class="text-xs font-bold uppercase tracking-widest">Est. Mesh VRAM</span>
			</div>
			<div class="flex items-baseline gap-1">
				<span class="text-3xl font-black text-primary">{totalVRAM}</span>
				<span class="text-sm font-bold text-primary/70">GB</span>
			</div>
		</div>
	</div>

	<!-- Network Visualizer -->
	<div class="rounded-2xl border border-border/40 bg-black overflow-hidden shadow-2xl relative h-[450px] group">
		<div class="absolute inset-0 bg-gradient-to-b from-transparent to-background/20 pointer-events-none z-10"></div>
		<div class="absolute inset-0 bg-black pointer-events-none">
			<!-- Abstract Grid / Map Background -->
			<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse" x="0" y="0">
						<path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
						<!-- Animate the pattern offset to create a panning effect -->
						<animate attributeName="x" from="0" to="50" dur="10s" repeatCount="indefinite" />
						<animate attributeName="y" from="0" to="50" dur="10s" repeatCount="indefinite" />
					</pattern>
					<radialGradient id="glow" cx="50%" cy="50%" r="50%">
						<stop offset="0%" stop-color="rgba(0, 210, 255, 0.5)" />
						<stop offset="100%" stop-color="rgba(0, 210, 255, 0)" />
					</radialGradient>
					<radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
						<stop offset="0%" stop-color="rgba(74, 222, 128, 0.4)" />
						<stop offset="100%" stop-color="rgba(74, 222, 128, 0)" />
					</radialGradient>
				</defs>
				
				<!-- Grid Background with animated panning -->
				<rect width="100%" height="100%" fill="url(#grid)" />
				
				<!-- Connection Lines & Traveling Packets -->
				{#each peers as peer}
					<!-- Pulsing connection line -->
					<line 
						x1="50%" y1="50%" 
						x2="{getX(peer.geo.lng)}%" y2="{getY(peer.geo.lat)}%" 
						stroke="rgba(0, 210, 255, 0.25)" 
						stroke-width="1.5"
						stroke-dasharray="6 6"
						class="animate-[dash_3s_linear_infinite]"
					/>
					
					<!-- Traveling Data Packet (Peer -> Orchestrator) -->
					<circle r="2.5" fill="#fff" filter="drop-shadow(0 0 5px #00d2ff)">
						<animate attributeName="cx" values="{getX(peer.geo.lng)}%;50%" dur="{Math.max(1, peer.latency / 20)}s" repeatCount="indefinite" />
						<animate attributeName="cy" values="{getY(peer.geo.lat)}%;50%" dur="{Math.max(1, peer.latency / 20)}s" repeatCount="indefinite" />
						<animate attributeName="opacity" values="0;1;1;0" dur="{Math.max(1, peer.latency / 20)}s" repeatCount="indefinite" />
					</circle>
					
					<!-- Traveling Data Packet (Orchestrator -> Peer) -->
					<circle r="2.5" fill="#4ade80" filter="drop-shadow(0 0 5px #4ade80)">
						<animate attributeName="cx" values="50%;{getX(peer.geo.lng)}%" dur="{Math.max(1.5, peer.latency / 15)}s" repeatCount="indefinite" />
						<animate attributeName="cy" values="50%;{getY(peer.geo.lat)}%" dur="{Math.max(1.5, peer.latency / 15)}s" repeatCount="indefinite" />
						<animate attributeName="opacity" values="0;1;1;0" dur="{Math.max(1.5, peer.latency / 15)}s" repeatCount="indefinite" />
					</circle>
				{/each}

				<!-- Local Node -->
				<circle cx="50%" cy="50%" r="40" fill="url(#glow)" class="animate-pulse" />
				<circle cx="50%" cy="50%" r="20" fill="url(#glow)" class="animate-ping" style="animation-duration: 3s;" />
				<circle cx="50%" cy="50%" r="8" fill="#00d2ff" filter="drop-shadow(0 0 10px #00d2ff)" />
				<text x="50%" y="50%" dy="28" fill="#00d2ff" font-size="11" font-weight="bold" text-anchor="middle" class="tracking-widest uppercase filter drop-shadow-md">Orchestrator</text>

				<!-- Peers -->
				{#each peers as peer}
					<circle cx="{getX(peer.geo.lng)}%" cy="{getY(peer.geo.lat)}%" r="24" fill="url(#nodeGlow)" class="animate-pulse" style="animation-delay: {peer.latency}ms;" />
					<circle cx="{getX(peer.geo.lng)}%" cy="{getY(peer.geo.lat)}%" r="5" fill="#4ade80" filter="drop-shadow(0 0 6px #4ade80)" />
					<text x="{getX(peer.geo.lng)}%" y="{getY(peer.geo.lat)}%" dy="20" fill="#fff" font-size="10" font-weight="600" text-anchor="middle" class="opacity-90 font-mono tracking-wider">
						{peer.ip}
					</text>
				{/each}
			</svg>
		</div>
	</div>

	<!-- Peer Statistics Table -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h3 class="text-xl font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
				<Network class="w-5 h-5 text-primary" /> Connected Nodes
			</h3>
			<Button variant="outline" size="sm" onclick={fetchPeers} disabled={loading} class="h-9 hover:bg-primary/10 hover:text-primary transition-colors border-border/50 bg-card/50 backdrop-blur-sm shadow-sm rounded-full px-4">
				<RefreshCw class="w-4 h-4 mr-2 {loading ? 'animate-spin' : ''}" /> {loading ? 'Syncing...' : 'Refresh Topology'}
			</Button>
		</div>

		<div class="rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 to-card/30 backdrop-blur-xl overflow-hidden shadow-xl">
			<div class="overflow-x-auto">
				<table class="w-full text-sm text-left">
					<thead class="text-xs uppercase bg-muted/20 text-muted-foreground/80 border-b border-border/40">
						<tr>
							<th class="px-6 py-4 font-bold tracking-wider">Node Identity</th>
							<th class="px-6 py-4 font-bold tracking-wider">IP Address</th>
							<th class="px-6 py-4 font-bold tracking-wider">Latency</th>
							<th class="px-6 py-4 font-bold tracking-wider text-right">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/40">
						{#if peers.length === 0 && !loading}
							<tr>
								<td colspan="4" class="px-6 py-12 text-center text-muted-foreground/70 flex flex-col items-center justify-center gap-3">
									<Globe class="w-8 h-8 opacity-20" />
									<span>No peers connected to the mesh network.</span>
								</td>
							</tr>
						{:else}
							{#each peers as peer}
								<tr class="hover:bg-primary/5 transition-all duration-200 group">
									<td class="px-6 py-4 font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors flex items-center gap-3">
										<div class="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center border border-border/50 group-hover:border-primary/30 group-hover:bg-primary/10 transition-colors shadow-inner">
											<Server class="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
										</div>
										{peer.id.substring(0, 24)}...
									</td>
									<td class="px-6 py-4 font-mono font-medium text-foreground/90 group-hover:text-primary transition-colors">{peer.ip}</td>
									<td class="px-6 py-4">
										<div class="flex items-center gap-2.5">
											<span class="relative flex h-2.5 w-2.5">
												<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 {peer.latency < 50 ? 'bg-green-400' : peer.latency < 100 ? 'bg-yellow-400' : 'bg-red-400'}"></span>
												<span class="relative inline-flex rounded-full h-2.5 w-2.5 {peer.latency < 50 ? 'bg-green-500' : peer.latency < 100 ? 'bg-yellow-500' : 'bg-red-500'} shadow-[0_0_8px_currentColor]"></span>
											</span>
											<span class="font-bold tracking-wide {peer.latency < 50 ? 'text-green-500' : peer.latency < 100 ? 'text-yellow-500' : 'text-red-500'}">
												{peer.latency} ms
											</span>
										</div>
									</td>
									<td class="px-6 py-4 text-right">
										<span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase bg-green-500/10 text-green-500 border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)] group-hover:bg-green-500/20 transition-colors">
											{peer.status}
										</span>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes dash {
		to {
			stroke-dashoffset: -12;
		}
	}
</style>
