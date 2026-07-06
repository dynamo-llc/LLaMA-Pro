<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Trash2, AlertCircle, RefreshCw } from '@lucide/svelte';
	import { DialogConfirmation } from '$lib/components/app';
	import { getDaemonUrl } from '$lib/utils/get-base-url';

	let entries = $state<Array<{timestamp: string, prompt: string, chosen: string, rejected: string}>>([]);
	let loading = $state(true);
	let showClearDialog = $state(false);
	let activeTrainingSource: EventSource | null = null;

	// Training state
	let isTraining = $state(false);
	let trainingComplete = $state(false);
	let trainingStats = $state({ epoch: 0, maxEpochs: 20, loss: '0.0000', message: '' });
	let lossHistory = $state<number[]>([]);

	const TARGET_PAIRS = 100;
	let progressPercentage = $derived(Math.min(Math.round((entries.length / TARGET_PAIRS) * 100), 100));

	// Calculate points for the SVG sparkline based on lossHistory
	let sparklinePoints = $derived(lossHistory.map((loss, i) => {
		const x = (i / (trainingStats.maxEpochs || 1)) * 100;
		// Normalize loss (assuming max loss is ~2.5, min is ~0)
		const y = 100 - ((loss / 2.5) * 100);
		return `${x},${y}`;
	}).join(' '));

	async function fetchDataset() {
		loading = true;
		try {
			const res = await fetch(`${getDaemonUrl('echo')}/feedback`);
			const data = await res.json();
			entries = data.entries || [];
		} catch (err) {
			console.error('Failed to fetch dataset', err);
		} finally {
			loading = false;
		}
	}

	async function clearDataset() {
		try {
			await fetch(`${getDaemonUrl('echo')}/feedback`, { method: 'DELETE' });
			entries = [];
			trainingComplete = false;
			lossHistory = [];
		} catch (err) {
			console.error('Failed to clear dataset', err);
		}
	}

	function startTraining() {
		if (entries.length < 5) return;
		isTraining = true;
		trainingComplete = false;
		lossHistory = [];
		trainingStats = { epoch: 0, maxEpochs: 20, loss: '2.4500', message: 'Initializing training pipeline...' };

		if (activeTrainingSource) activeTrainingSource.close();
		const source = new EventSource(`${getDaemonUrl('echo')}/train`);
		activeTrainingSource = source;

		source.onmessage = (event) => {
			const data = JSON.parse(event.data);
			
			if (data.error) {
				console.error('Training error:', data.error);
				trainingStats.message = data.error;
				isTraining = false;
				source.close();
				return;
			}

			if (data.status === 'complete') {
				trainingStats.message = data.message;
				isTraining = false;
				trainingComplete = true;
				source.close();
				return;
			}

			trainingStats = {
				epoch: data.epoch,
				maxEpochs: data.maxEpochs,
				loss: data.loss,
				message: `Optimizing adapter weights...`
			};
			lossHistory = [...lossHistory, parseFloat(data.loss)];
		};

		source.onerror = (err) => {
			console.error('EventSource failed:', err);
			isTraining = false;
			source.close();
		};
	}

	onMount(() => {
		fetchDataset();
	});

	onDestroy(() => {
		if (activeTrainingSource) {
			activeTrainingSource.close();
			activeTrainingSource = null;
		}
	});
</script>

<div class="space-y-8 relative animate-in fade-in slide-in-from-bottom-4 duration-500">
	<div>
		<h2 class="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/50">Echo Alignment</h2>
		<p class="text-sm text-muted-foreground mt-2 max-w-2xl">
			Review and manage your local Direct Preference Optimization (DPO) dataset. Fine-tune your local model on this dataset to align its outputs perfectly to your preferences.
		</p>
	</div>

	<!-- Progress Card -->
	<div class="rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 to-card/30 backdrop-blur-xl p-6 shadow-xl flex flex-col md:flex-row gap-6 md:items-center">
		<div class="flex-1 space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-semibold">Dataset Progress</h3>
				<span class="text-sm font-bold text-primary px-3 py-1 bg-primary/10 rounded-full">{entries.length} / {TARGET_PAIRS} Pairs</span>
			</div>
			
			<div class="w-full h-4 bg-muted rounded-full overflow-hidden shadow-inner relative">
				<div 
					class="absolute top-0 left-0 h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-700 ease-out" 
					style="width: {progressPercentage}%"
				></div>
				{#if progressPercentage >= 100}
					<div class="absolute inset-0 bg-white/20 animate-[pulse_2s_ease-in-out_infinite]"></div>
				{/if}
			</div>
			
			<p class="text-xs text-muted-foreground">
				Collect at least 5 preference pairs to unlock local fine-tuning. For optimal results, aim for {TARGET_PAIRS}.
			</p>
		</div>
		
		<div class="flex flex-col gap-3 min-w-[160px]">
			<Button variant="default" class="w-full h-11 font-bold shadow-lg transition-all {trainingComplete ? 'bg-green-500 hover:bg-green-600 text-white' : ''}" disabled={entries.length < 5 || isTraining} onclick={startTraining}>
				{trainingComplete ? 'Retrain Adapter' : isTraining ? 'Training...' : 'Train Local LoRA'}
			</Button>
			<Button variant="outline" class="w-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" onclick={() => showClearDialog = true} disabled={entries.length === 0 || isTraining}>
				<Trash2 class="w-4 h-4 mr-2" />
				Clear Dataset
			</Button>
		</div>
	</div>

	<!-- Training Overlay / Inline View -->
	{#if isTraining || trainingComplete}
		<div class="rounded-2xl border {trainingComplete ? 'border-green-500/50 bg-gradient-to-b from-green-500/10 to-transparent' : 'border-primary/50 bg-gradient-to-b from-primary/10 to-transparent'} p-6 shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-500">
			{#if isTraining}
				<div class="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.05)_50%,transparent_75%)] bg-[length:250%_250%] animate-[shimmer_2s_linear_infinite] pointer-events-none"></div>
			{/if}
			
			<div class="relative z-10 space-y-6">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="text-2xl font-black tracking-tight {trainingComplete ? 'text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.4)]'}">
							{trainingComplete ? 'LoRA Adapter Ready ✨' : 'Training LoRA Adapter...'}
						</h3>
						<p class="text-sm font-mono text-muted-foreground mt-2">
							{trainingStats.message}
						</p>
					</div>
					{#if isTraining}
						<RefreshCw class="w-8 h-8 text-primary animate-spin drop-shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
					{/if}
				</div>

				{#if isTraining || (trainingComplete && lossHistory.length > 0)}
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div class="md:col-span-1 grid grid-rows-2 gap-4">
							<div class="bg-background/90 backdrop-blur-md rounded-xl p-5 border border-border/50 shadow-inner">
								<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-2">Epoch</span>
								<span class="text-4xl font-black font-mono text-foreground">{trainingStats.epoch} <span class="text-xl text-muted-foreground">/ {trainingStats.maxEpochs}</span></span>
							</div>
							<div class="bg-background/90 backdrop-blur-md rounded-xl p-5 border border-border/50 shadow-inner">
								<span class="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-2">Loss</span>
								<span class="text-4xl font-black font-mono {trainingComplete ? 'text-green-500' : 'text-primary'}">{trainingStats.loss}</span>
							</div>
						</div>

						<!-- Dynamic Loss Curve Sparkline -->
						<div class="md:col-span-2 bg-black/40 rounded-xl border border-border/30 p-4 relative overflow-hidden flex flex-col justify-end h-[200px]">
							<span class="absolute top-4 left-4 text-xs font-bold uppercase tracking-widest text-muted-foreground/50 z-10">Gradient Descent Curve</span>
							<svg viewBox="0 -10 100 120" class="w-full h-full drop-shadow-[0_0_12px_rgba(var(--primary),0.8)]" preserveAspectRatio="none">
								<defs>
									<linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="{trainingComplete ? '#22c55e' : 'hsl(var(--primary))'}" />
										<stop offset="100%" stop-color="{trainingComplete ? '#16a34a' : 'hsl(var(--primary))'}" />
									</linearGradient>
									<linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="{trainingComplete ? '#22c55e' : 'hsl(var(--primary))'}" stop-opacity="0.3" />
										<stop offset="100%" stop-color="{trainingComplete ? '#22c55e' : 'hsl(var(--primary))'}" stop-opacity="0" />
									</linearGradient>
								</defs>
								{#if sparklinePoints}
									<polygon points="0,100 {sparklinePoints} 100,100" fill="url(#fillGrad)" class="transition-all duration-300" />
									<polyline 
										fill="none" 
										stroke="url(#lineGrad)" 
										stroke-width="2" 
										points={sparklinePoints}
										stroke-linecap="round"
										stroke-linejoin="round"
										class="transition-all duration-300"
									/>
								{/if}
							</svg>
						</div>
					</div>
					
					{#if isTraining}
						<div class="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden mt-4">
							<div 
								class="h-full bg-primary transition-all duration-300 ease-linear shadow-[0_0_10px_rgba(var(--primary),0.8)]" 
								style="width: {(trainingStats.epoch / trainingStats.maxEpochs) * 100}%"
							></div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- Dataset List -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-medium">Collected Preferences</h3>
			<Button variant="ghost" size="sm" onclick={fetchDataset} class="h-8">
				<RefreshCw class="w-4 h-4 mr-2 {loading ? 'animate-spin' : ''}" /> Refresh
			</Button>
		</div>

		{#if loading}
			<div class="py-12 text-center text-muted-foreground animate-pulse">
				Loading your dataset...
			</div>
		{:else if entries.length === 0}
			<div class="rounded-xl border border-dashed border-border p-12 text-center">
				<AlertCircle class="w-8 h-8 mx-auto text-muted-foreground mb-4 opacity-50" />
				<h4 class="text-md font-medium mb-1">No preferences collected yet</h4>
				<p class="text-sm text-muted-foreground max-w-sm mx-auto">
					Upvote or downvote assistant messages in the chat to build your local alignment dataset.
				</p>
			</div>
		{:else}
			<div class="space-y-6">
				{#each entries.slice().reverse() as entry}
					<div class="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
						<!-- Header -->
						<div class="bg-muted/50 px-4 py-3 border-b border-border flex justify-between items-center">
							<span class="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</span>
						</div>
						
						<div class="p-4 space-y-4">
							<!-- Prompt -->
							<div>
								<span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Prompt</span>
								<div class="bg-muted/30 p-3 rounded-lg text-sm border border-border/50 text-foreground">
									{entry.prompt}
								</div>
							</div>
							
							<!-- Side-by-side comparison -->
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div class="flex flex-col">
									<div class="flex items-center gap-2 mb-2">
										<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
											Chosen (Preferred)
										</span>
									</div>
									<div class="flex-1 bg-green-500/5 p-3 rounded-lg text-sm border border-green-500/10 whitespace-pre-wrap text-foreground">
										{entry.chosen}
									</div>
								</div>

								{#if entry.rejected}
									<div class="flex flex-col">
										<div class="flex items-center gap-2 mb-2">
											<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
												Rejected
											</span>
										</div>
										<div class="flex-1 bg-red-500/5 p-3 rounded-lg text-sm border border-red-500/10 whitespace-pre-wrap text-muted-foreground line-through decoration-red-500/30">
											{entry.rejected}
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<DialogConfirmation
	bind:open={showClearDialog}
	title="Clear Echo Dataset"
	description="Are you sure you want to permanently delete your collected preference dataset? This action cannot be undone and will reset your progress."
	confirmText="Clear Dataset"
	cancelText="Cancel"
	variant="destructive"
	icon={Trash2}
	onConfirm={clearDataset}
	onCancel={() => showClearDialog = false}
/>
