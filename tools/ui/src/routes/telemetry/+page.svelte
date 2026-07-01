<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { base } from '$app/paths';
	import { Cpu, HardDrive, Activity, Network, Server, Database, Gauge } from '@lucide/svelte';
	import { serverStore } from '$lib/stores/server.svelte';

	// RAM / VRAM Info from serverProps (Fallback)

	let avgTokenSpeed = $state<number>(0);

	function formatBytes(bytes: number): string {
		if (!bytes) return '0 GB';
		const gb = bytes / (1024 * 1024 * 1024);
		return gb.toFixed(1) + ' GB';
	}

	function formatSpeed(bps: number): string {
		if (!bps) return '0 Mbps';
		return (bps / 1000000).toFixed(0) + ' Mbps';
	}

	let appTelemetry = $state<any>({ requestsRouted: 0, requestsSuccess: 0, latencyMs: 0 });
	let sysInfo = $state<any>({});
	let tokenSpeed = $state<number>(0);
	let promptSpeed = $state<number>(0);

	let lastPredictedTokens = $state<number>(0);
	let lastPredictedSeconds = $state<number>(0);
	let lastPromptTokens = $state<number>(0);
	let lastPromptSeconds = $state<number>(0);

	async function fetchMetrics() {
		try {
			const res = await fetch(`${base}/metrics`);
			if (!res.ok) return;

			const text = await res.text();
			if (!text) return;

			let totalTokenSpeedAccumulator = 0;
			let totalPromptSpeedAccumulator = 0;
			let totalPredictedTokens = 0;
			let totalPredictedSeconds = 0;
			let totalPromptTokens = 0;
			let totalPromptSeconds = 0;

			const predictedMatch = [
				...text.matchAll(/llamacpp:predicted_tokens_seconds\s+([\d.]+)/g)
			];
			const promptMatch = [...text.matchAll(/llamacpp:prompt_tokens_seconds\s+([\d.]+)/g)];
			const tokensTotalMatch = [
				...text.matchAll(/llamacpp:tokens_predicted_total\s+([\d.]+)/g)
			];
			const secondsTotalMatch = [
				...text.matchAll(/llamacpp:tokens_predicted_seconds_total\s+([\d.]+)/g)
			];
			const promptTokensTotalMatch = [
				...text.matchAll(/llamacpp:prompt_tokens_total\s+([\d.]+)/g)
			];
			const promptSecondsTotalMatch = [
				...text.matchAll(/llamacpp:prompt_seconds_total\s+([\d.]+)/g)
			];

			if (predictedMatch.length > 0) {
				totalTokenSpeedAccumulator = predictedMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
			}
			if (promptMatch.length > 0) {
				totalPromptSpeedAccumulator = promptMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
			}
			if (tokensTotalMatch.length > 0 && secondsTotalMatch.length > 0) {
				totalPredictedTokens = tokensTotalMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
				totalPredictedSeconds = secondsTotalMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
			}
			if (promptTokensTotalMatch.length > 0 && promptSecondsTotalMatch.length > 0) {
				totalPromptTokens = promptTokensTotalMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
				totalPromptSeconds = promptSecondsTotalMatch.reduce(
					(sum, match) => sum + parseFloat(match[1]),
					0
				);
			}

			const processingMatch = [
				...text.matchAll(/llamacpp:requests_processing\s+([\d.]+)/g)
			];
			const totalRequestsProcessing = processingMatch.length > 0
				? processingMatch.reduce((sum, match) => sum + parseFloat(match[1]), 0)
				: 0;

			// Calculate deltas for idle periods
			const deltaPredictedTokens = totalPredictedTokens - lastPredictedTokens;
			const deltaPredictedSeconds = totalPredictedSeconds - lastPredictedSeconds;
			const deltaPromptTokens = totalPromptTokens - lastPromptTokens;
			const deltaPromptSeconds = totalPromptSeconds - lastPromptSeconds;

			let currentTokenSpeed = 0;
			if (totalRequestsProcessing > 0) {
				currentTokenSpeed = totalTokenSpeedAccumulator;
			} else if (lastPredictedSeconds > 0 && deltaPredictedSeconds > 0.005) {
				currentTokenSpeed = deltaPredictedTokens / deltaPredictedSeconds;
			}
			tokenSpeed = currentTokenSpeed;

			let currentPromptSpeed = 0;
			if (totalRequestsProcessing > 0) {
				currentPromptSpeed = totalPromptSpeedAccumulator;
			} else if (lastPromptSeconds > 0 && deltaPromptSeconds > 0.005) {
				currentPromptSpeed = deltaPromptTokens / deltaPromptSeconds;
			}
			promptSpeed = currentPromptSpeed;

			avgTokenSpeed =
				totalPredictedSeconds > 0 ? totalPredictedTokens / totalPredictedSeconds : 0;

			// Store current values for the next poll
			lastPredictedTokens = totalPredictedTokens;
			lastPredictedSeconds = totalPredictedSeconds;
			lastPromptTokens = totalPromptTokens;
			lastPromptSeconds = totalPromptSeconds;
		} catch (e) {
			console.error('Error fetching metrics', e);
		}
	}

	async function fetchAppTelemetry() {
		try {
			const res = await fetch(`${base}/telemetry/app`);
			if (res.ok) {
				appTelemetry = await res.json();
			}
		} catch (e) {
			// ignore
		}
	}

	async function fetchSysInfo() {
		try {
			const res = await fetch(`${base}/telemetry/sysinfo`);
			if (res.ok) {
				sysInfo = await res.json();
			}
		} catch (e) {
			// ignore
		}
	}

	let pollInterval: any;

	onMount(() => {
		void serverStore.fetch();
		void fetchMetrics();
		void fetchAppTelemetry();
		void fetchSysInfo();

		pollInterval = setInterval(() => {
			void serverStore.fetch();
			void fetchMetrics();
			void fetchAppTelemetry();
			void fetchSysInfo();
		}, 2000);

		return () => {
			if (pollInterval) clearInterval(pollInterval);
		};
	});
</script>

<div class="mx-auto w-full p-4 md:p-8 md:py-8" in:fade={{ duration: 150 }}>

	<div class="grid gap-6">
		<!-- Application Telemetry -->
		<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
			<h3
				class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"
			>
				<Gauge class="w-4 h-4" /> Application Telemetry
			</h3>
			<div class="grid grid-cols-2 md:grid-cols-6 gap-4">
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Infer Requests</div>
					<div class="text-2xl font-bold text-blue-500">
						{appTelemetry.inferRouted ?? appTelemetry.requestsRouted ?? 0}
					</div>
				</div>
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Infer Success</div>
					<div class="text-2xl font-bold text-emerald-500">
						{#if appTelemetry.inferRouted != null}
							{appTelemetry.inferRouted
								? Math.round((appTelemetry.inferSuccess / appTelemetry.inferRouted) * 100)
								: 100}%
						{:else}
							{appTelemetry.requestsRouted
								? Math.round((appTelemetry.requestsSuccess / appTelemetry.requestsRouted) * 100)
								: 100}%
						{/if}
					</div>
				</div>
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Avg Latency</div>
					<div class="text-2xl font-bold text-amber-500">
						{appTelemetry.requestsRouted
							? Math.round(appTelemetry.latencyMs / appTelemetry.requestsRouted)
							: 0} ms
					</div>
				</div>
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Prompt Speed</div>
					<div class="text-2xl font-bold text-sky-500">{promptSpeed.toFixed(1)} t/s</div>
				</div>
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Token Speed</div>
					<div class="text-2xl font-bold text-purple-500">{tokenSpeed.toFixed(1)} t/s</div>
				</div>
				<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40 text-center">
					<div class="text-xs text-muted-foreground uppercase mb-1">Avg Token Speed</div>
					<div class="text-2xl font-bold text-pink-500">{avgTokenSpeed.toFixed(1)} t/s</div>
				</div>
			</div>
		</div>

		<!-- Memory Tiles (RAM / VRAM) - compact instrument-panel design -->
		<div class="grid gap-6 md:grid-cols-2">
			<!-- RAM Tile -->
			{#if sysInfo.ram}
				{@const percent =
					sysInfo.ram.load ?? (sysInfo.ram.usedBytes / sysInfo.ram.totalBytes) * 100}
				{@const freeBytes = sysInfo.ram.freeBytes ?? sysInfo.ram.totalBytes - sysInfo.ram.usedBytes}
				<div
					class="rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-card p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-neutral-300 dark:hover:border-neutral-700"
				>
					<!-- header -->
					<div
						class="flex items-center justify-between pb-3 mb-4 border-b border-neutral-100 dark:border-neutral-800/80"
					>
						<div class="flex items-center gap-1.5">
							<Server class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
							<span
								class="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
								>System RAM</span
							>
						</div>
						<span
							class="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800/60 px-2 py-0.5 rounded border border-neutral-200/40 dark:border-neutral-700/40 text-neutral-600 dark:text-neutral-300"
						>
							{sysInfo.ram.type || 'RAM'}
						</span>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
						<!-- Left Side: Main percentage and total -->
						<div class="sm:col-span-2 flex flex-col justify-center">
							<div
								class="text-[10px] uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500 mb-1"
							>
								Current Load
							</div>
							<div
								class="text-2xl font-mono font-black text-neutral-800 dark:text-neutral-200 tracking-tight leading-none"
							>
								{percent.toFixed(1)}%
							</div>
							<div class="text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-2">
								{formatBytes(sysInfo.ram.usedBytes ?? 0)}
								<span class="text-neutral-400 dark:text-neutral-500"
									>/ {formatBytes(sysInfo.ram.totalBytes)}</span
								>
							</div>
						</div>

						<!-- Middle: Vertical Divider -->
						<div
							class="hidden sm:block self-stretch w-px bg-neutral-100 dark:bg-neutral-800/80 justify-self-center"
						></div>

						<!-- Right Side: Clean grid of secondary stats -->
						<div class="sm:col-span-2 grid grid-cols-1 gap-2 text-xs">
							<div class="flex justify-between items-center py-0.5">
								<span class="text-neutral-400 dark:text-neutral-500">Available</span>
								<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
									>{formatBytes(freeBytes)}</span
								>
							</div>
							<div class="flex justify-between items-center py-0.5">
								<span class="text-neutral-400 dark:text-neutral-500">Clock Speed</span>
								<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
									>{sysInfo.ram.speed ? sysInfo.ram.speed + ' MHz' : 'N/A'}</span
								>
							</div>
							{#if sysInfo.ram.virtualTotalBytes}
								<div class="flex justify-between items-center py-0.5">
									<span class="text-neutral-400 dark:text-neutral-500">Committed</span>
									<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300">
										{formatBytes(sysInfo.ram.virtualUsedBytes)}
										<span class="text-neutral-400 dark:text-neutral-500"
											>/ {formatBytes(sysInfo.ram.virtualTotalBytes)}</span
										>
									</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Thin elegant progress bar at the bottom -->
					<div class="mt-4 pt-1">
						<div
							class="h-1 w-full rounded-full bg-neutral-100 dark:bg-neutral-800/60 overflow-hidden"
						>
							<div
								class="h-full bg-neutral-700 dark:bg-neutral-300 rounded-full transition-all duration-500"
								style="width: {percent}%"
							></div>
						</div>
					</div>
				</div>
			{/if}

			<!-- VRAM Tile -->
			{#if sysInfo.gpu && sysInfo.gpu.length > 0 && sysInfo.gpu[sysInfo.gpu.length - 1].vramTotalBytes !== undefined && sysInfo.gpu[sysInfo.gpu.length - 1].vramTotalBytes !== null}
				{@const primaryGpu = sysInfo.gpu[sysInfo.gpu.length - 1]}
				{@const vramPercent =
					primaryGpu.vramLoad !== undefined && primaryGpu.vramLoad !== null
						? primaryGpu.vramLoad
						: primaryGpu.vramUsedBytes
							? (primaryGpu.vramUsedBytes / primaryGpu.vramTotalBytes) * 100
							: 0}
				{@const vramFree =
					primaryGpu.vramFreeBytes ?? primaryGpu.vramTotalBytes - (primaryGpu.vramUsedBytes || 0)}
				<div
					class="rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-card p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-neutral-300 dark:hover:border-neutral-700"
				>
					<!-- header -->
					<div
						class="flex items-center justify-between pb-3 mb-4 border-b border-neutral-100 dark:border-neutral-800/80"
					>
						<div class="flex items-center gap-1.5">
							<Database class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
							<span
								class="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
								>Video RAM</span
							>
						</div>
						<span
							class="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800/60 px-2 py-0.5 rounded border border-neutral-200/40 dark:border-neutral-700/40 text-neutral-600 dark:text-neutral-300 max-w-[150px] truncate"
							title={primaryGpu.type}
						>
							{primaryGpu.type || 'GPU'}
						</span>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
						<!-- Left Side: Main percentage and total -->
						<div class="sm:col-span-2 flex flex-col justify-center">
							<div
								class="text-[10px] uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500 mb-1"
							>
								VRAM Load
							</div>
							<div
								class="text-2xl font-mono font-black text-neutral-800 dark:text-neutral-200 tracking-tight leading-none"
							>
								{vramPercent.toFixed(1)}%
							</div>
							<div class="text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-2">
								{formatBytes(primaryGpu.vramUsedBytes || 0)}
								<span class="text-neutral-400 dark:text-neutral-500"
									>/ {formatBytes(primaryGpu.vramTotalBytes)}</span
								>
							</div>
						</div>

						<!-- Middle: Vertical Divider -->
						<div
							class="hidden sm:block h-20 w-px bg-neutral-100 dark:bg-neutral-800/80 justify-self-center"
						></div>

						<!-- Right Side: Clean grid of secondary stats -->
						<div class="sm:col-span-2 grid grid-cols-1 gap-1 text-xs">
							<div class="flex justify-between items-center py-0.5">
								<span class="text-neutral-400 dark:text-neutral-500">Available</span>
								<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
									>{formatBytes(vramFree)}</span
								>
							</div>
							{#if primaryGpu.load !== null && primaryGpu.load !== undefined}
								<div class="flex justify-between items-center py-0.5">
									<span class="text-neutral-400 dark:text-neutral-500">Core Load</span>
									<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
										>{Math.round(primaryGpu.load)}%</span
									>
								</div>
							{/if}
							{#if primaryGpu.speed}
								<div class="flex justify-between items-center py-0.5">
									<span class="text-neutral-400 dark:text-neutral-500">GPU Clock</span>
									<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
										>{primaryGpu.speed} MHz</span
									>
								</div>
							{/if}
							{#if primaryGpu.wattage}
								<div class="flex justify-between items-center py-0.5">
									<span class="text-neutral-400 dark:text-neutral-500">Power Draw</span>
									<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
										>{primaryGpu.wattage.toFixed(1)} W</span
									>
								</div>
							{/if}
							{#if primaryGpu.voltage}
								<div class="flex justify-between items-center py-0.5">
									<span class="text-neutral-400 dark:text-neutral-500">Voltage</span>
									<span class="font-mono font-semibold text-neutral-700 dark:text-neutral-300"
										>{primaryGpu.voltage.toFixed(2)} V</span
									>
								</div>
							{/if}
						</div>
					</div>

					<!-- Thin elegant progress bar at the bottom -->
					<div class="mt-4 pt-1">
						<div
							class="h-1 w-full rounded-full bg-neutral-100 dark:bg-neutral-800/60 overflow-hidden"
						>
							<div
								class="h-full bg-neutral-700 dark:bg-neutral-300 rounded-full transition-all duration-500"
								style="width: {vramPercent}%"
							></div>
						</div>
					</div>
				</div>
			{/if}
		</div>

		{#if sysInfo.cpu}
			<div class="grid gap-6 md:grid-cols-2">
				<!-- CPU -->
				<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm flex flex-col">
					<h3
						class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"
					>
						<Cpu class="w-4 h-4" /> CPU Monitor
					</h3>
					<div class="space-y-3 flex-1">
						<div class="flex justify-between text-sm">
							<span class="text-muted-foreground">Type</span>
							<span class="font-medium text-right">{sysInfo.cpu.type?.trim() || 'Unknown'}</span>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-muted-foreground">Cores</span>
							<span class="font-medium">{sysInfo.cpu.cores}</span>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-muted-foreground">Speed</span>
							<span class="font-medium">{sysInfo.cpu.speed || 0} MHz</span>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-muted-foreground">Voltage</span>
							<span class="font-medium"
								>{sysInfo.cpu.voltage ? sysInfo.cpu.voltage.toFixed(2) + ' V' : 'N/A'}</span
							>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-muted-foreground">Wattage</span>
							<span class="font-medium text-amber-500"
								>{sysInfo.cpu.wattage ? sysInfo.cpu.wattage.toFixed(1) + ' W' : 'N/A'}</span
							>
						</div>

						<div class="mt-4 pt-4 border-t border-border/40">
							<div class="flex justify-between text-xs mb-1 font-medium">
								<span>Load</span> <span>{sysInfo.cpu.load || 0}%</span>
							</div>
							<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
								<div
									class="h-full bg-blue-500 rounded-full transition-all duration-500"
									style="width: {sysInfo.cpu.load || 0}%"
								></div>
							</div>
						</div>
					</div>
				</div>

				<!-- GPU -->
				<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm flex flex-col">
					<h3
						class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"
					>
						<Gauge class="w-4 h-4" /> GPU Monitor
					</h3>
					{#if sysInfo.gpu && sysInfo.gpu.length > 0}
						<!-- Take the last GPU as primary if there are multiple (e.g. iGPU + dGPU) -->
						{@const primaryGpu = sysInfo.gpu[sysInfo.gpu.length - 1]}
						<div class="space-y-3 flex-1">
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">Type</span>
								<span class="font-medium text-right">{primaryGpu.type || 'Unknown'}</span>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">Driver Version</span>
								<span class="font-medium text-right">{primaryGpu.driverVersion || 'Unknown'}</span>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">Speed</span>
								<span class="font-medium"
									>{primaryGpu.speed ? primaryGpu.speed + ' MHz' : 'N/A'}</span
								>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">Voltage</span>
								<span class="font-medium"
									>{primaryGpu.voltage ? primaryGpu.voltage.toFixed(2) + ' V' : 'N/A'}</span
								>
							</div>
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">Wattage</span>
								<span class="font-medium text-amber-500"
									>{primaryGpu.wattage ? primaryGpu.wattage.toFixed(1) + ' W' : 'N/A'}</span
								>
							</div>

							<div class="mt-4 pt-4 border-t border-border/40">
								<div class="flex justify-between text-xs mb-1 font-medium">
									<span>Core Load</span>
									<span
										>{primaryGpu.load !== null && primaryGpu.load !== undefined
											? Math.round(primaryGpu.load) + '%'
											: 'N/A'}</span
									>
								</div>
								<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
									<div
										class="h-full bg-emerald-500 rounded-full transition-all duration-500"
										style="width: {primaryGpu.load || 0}%"
									></div>
								</div>
							</div>
						</div>
					{:else}
						<div class="text-muted-foreground/60 italic text-center py-8">No GPU detected</div>
					{/if}
				</div>
			</div>
		{/if}

		<div class="grid gap-6 md:grid-cols-2">
			<!-- Motherboard & RAM -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<h3
					class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"
				>
					<Server class="w-4 h-4" /> System Board & Memory
				</h3>
				<div class="space-y-4">
					{#if sysInfo.motherboard}
						<div class="bg-black/5 dark:bg-black/20 p-3 rounded border border-border/40">
							<div class="text-[10px] text-muted-foreground uppercase mb-1">Motherboard</div>
							<div class="text-sm font-medium">
								{sysInfo.motherboard.manufacturer}
								{sysInfo.motherboard.model}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Storage -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<h3
					class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"
				>
					<HardDrive class="w-4 h-4" /> Logical Drives
				</h3>
				<div class="space-y-3 overflow-y-auto max-h-[200px] pr-2">
					{#if sysInfo.storage}
						{#each sysInfo.storage as drive}
							{@const percent = Math.round(
								((drive.sizeBytes - drive.freeBytes) / drive.sizeBytes) * 100
							)}
							<div class="bg-black/5 dark:bg-black/20 p-3 rounded border border-border/40">
								<div class="flex justify-between items-center mb-2">
									<div class="font-bold flex items-center gap-1.5">
										<HardDrive class="w-3.5 h-3.5" />
										{drive.name}
										<span class="font-normal text-xs text-muted-foreground">{drive.volumeName}</span
										>
									</div>
									<div class="text-xs font-mono">
										{formatBytes(drive.freeBytes)} free of {formatBytes(drive.sizeBytes)}
									</div>
								</div>
								<div class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
									<div class="h-full bg-purple-500 rounded-full" style="width: {percent}%"></div>
								</div>
							</div>
						{/each}
					{:else}
						<div class="text-muted-foreground/60 italic text-center py-8">Loading drives...</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Network -->
		<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
			<div class="flex items-center justify-between mb-4">
				<h3
					class="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"
				>
					<Network class="w-4 h-4" /> Network Interfaces
				</h3>
				{#if sysInfo.externalIp}
					<div
						class="text-xs font-mono text-muted-foreground bg-black/5 dark:bg-black/20 px-2 py-1 rounded border border-border/40"
						title="External IP Address"
					>
						WAN: {sysInfo.externalIp}
					</div>
				{/if}
			</div>
			<div class="grid gap-3 md:grid-cols-2">
				{#if sysInfo.network}
					{#each sysInfo.network as net}
						<div class="bg-black/5 dark:bg-black/20 p-4 rounded-lg border border-border/40">
							<div class="font-semibold text-sm mb-1 truncate" title={net.description}>
								{net.description}
							</div>
							<div class="text-xs text-muted-foreground mb-3">
								{net.type} • {formatSpeed(net.speed)}
							</div>

							<div class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
								<div class="text-muted-foreground">IP Address:</div>
								<div class="font-mono text-right">{net.ip || 'N/A'}</div>

								<div class="text-muted-foreground">Subnet:</div>
								<div class="font-mono text-right">{net.subnet || 'N/A'}</div>

								<div class="text-muted-foreground">Gateway:</div>
								<div class="font-mono text-right">{net.gateway || 'N/A'}</div>

								<div class="text-muted-foreground">MAC:</div>
								<div class="font-mono text-right">{net.mac || 'N/A'}</div>
							</div>
						</div>
					{/each}
				{:else}
					<div class="text-muted-foreground/60 italic text-center py-8 col-span-2">
						Loading network...
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
