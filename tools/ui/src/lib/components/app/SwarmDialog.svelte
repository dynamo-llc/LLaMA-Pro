<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { slide, fly } from 'svelte/transition';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import { Trash2, Plus, Network, Cpu, Copy, Star, Bot, Brain, Workflow, Settings2 } from '@lucide/svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { getBaseUrl } from '$lib/utils/get-base-url';
	import DialogConfirmation from '$lib/components/app/dialogs/DialogConfirmation.svelte';

	let { open = $bindable(false), onsaved } = $props();

	interface SwarmNode {
		id: string;
		role: string;
		url: string;
		modelName: string;
		temperature: number;
		persona: string;
		sourceType: 'local' | 'custom';
	}

	interface SwarmConfig {
		id: string;
		name: string;
		nodes: SwarmNode[];
	}

	let configs = $state<SwarmConfig[]>([]);
	let selectedConfigId = $state<string>('');
	let activeConfigId = $state<string>('');
	let loading = $state(false);
	let confirmDeleteOpen = $state(false);
	let swarmEndpoint = $derived(`${getBaseUrl('orchestrator')}/v1/swarm/chat/completions`);

	let selectedConfigIndex = $derived(configs.findIndex((c) => c.id === selectedConfigId));

	// Fetch current configuration
	async function loadConfig() {
		try {
			const res = await fetch(`${getBaseUrl('orchestrator')}/v1/swarm/config`);
			if (res.ok) {
				const data = await res.json();
				configs = data.configs || [];
				activeConfigId = data.active_config_id || '';

				if (configs.length > 0) {
					if (activeConfigId && configs.some((c) => c.id === activeConfigId)) {
						selectedConfigId = activeConfigId;
					} else {
						selectedConfigId = configs[0].id;
					}
				} else {
					createNewConfig();
				}
			}
		} catch (e) {
			console.error('Failed to fetch Swarm config', e);
		}
	}

	$effect(() => {
		if (open) {
			loadConfig();
		}
	});

	function createNewConfig() {
		if (configs.length >= 20) {
			toast.error('Maximum of 20 Swarm configurations allowed.');
			return;
		}

		const id = `config-${Date.now()}`;
		configs = [
			...configs,
			{
				id,
				name: `Swarm Config ${configs.length + 1}`,
				nodes: [
					{
						id: `node-${Date.now()}`,
						role: 'worker',
						url: `${getBaseUrl('llama')}/v1`,
						modelName: '',
						temperature: 0.8,
						persona: 'You are a helpful assistant.',
						sourceType: 'local'
					}
				]
			}
		];
		selectedConfigId = id;
	}

	function deleteConfig() {
		if (configs.length <= 1) {
			toast.error('You must keep at least one Swarm configuration.');
			return;
		}
		const idToDelete = selectedConfigId;
		const index = configs.findIndex((c) => c.id === idToDelete);
		configs = configs.filter((c) => c.id !== idToDelete);

		if (activeConfigId === idToDelete) {
			activeConfigId = configs[0].id;
		}

		if (configs.length > 0) {
			const nextIndex = Math.max(0, index - 1);
			selectedConfigId = configs[nextIndex].id;
		} else {
			selectedConfigId = '';
		}
		toast.success('Configuration deleted.');
	}

	function addNode() {
		if (selectedConfigIndex === -1) return;
		const currentNodes = configs[selectedConfigIndex].nodes;
		if (currentNodes.length >= 6) {
			toast.error('Maximum of 6 nodes allowed.');
			return;
		}

		const id = `node-${Date.now()}`;
		configs[selectedConfigIndex].nodes = [
			...currentNodes,
			{
				id,
				role: 'worker',
				url: `${getBaseUrl('llama')}/v1`,
				modelName: '',
				temperature: 0.7,
				persona: 'You are a helpful assistant.',
				sourceType: 'local'
			}
		];
	}

	function removeNode(id: string) {
		if (selectedConfigIndex === -1) return;
		configs[selectedConfigIndex].nodes = configs[selectedConfigIndex].nodes.filter(
			(n) => n.id !== id
		);
	}

	async function saveConfig() {
		loading = true;
		try {
			const res = await fetch(`${getBaseUrl('orchestrator')}/v1/swarm/config`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ configs, active_config_id: activeConfigId || null })
			});
			if (res.ok) {
				toast.success('Successfully updated Swarm configurations!');
				open = false;
				onsaved?.();
			} else {
				toast.error('Failed to update config');
			}
		} catch (e) {
			toast.error('Error connecting to orchestrator.');
		} finally {
			loading = false;
		}
	}

	function copyEndpoint() {
		navigator.clipboard.writeText(swarmEndpoint);
		toast.success('Swarm Endpoint copied to clipboard!');
	}

	let activeModels = $derived(
		modelsStore.loadedModelIds
			.map((id, index) => {
				if (!id) return null;
				let parts = id.split('/');
				let name = parts.length > 1 ? parts[1] : id;
				return { label: `Slot ${index + 1} - ${name}`, value: id };
			})
			.filter(Boolean)
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-4xl max-h-[90vh] overflow-y-auto text-foreground border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl">
		<Dialog.Header class="pb-4 border-b border-border/30">
			<Dialog.Title class="flex items-center gap-2 text-2xl font-bold">
				<div class="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
					<Network class="w-6 h-6 text-primary" />
				</div>
				Mixture of Agents (MoA) Pipeline
			</Dialog.Title>
			<Dialog.Description class="text-base mt-2">
				Design dynamic swarms by chaining up to 6 models into a unified endpoint. Configure Worker nodes to generate diverse perspectives, and cap it with a Synthesizer to forge the final response.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4 space-y-8">
			<!-- Configuration Selector -->
			<div class="p-5 border border-border/50 rounded-2xl bg-muted/10 shadow-sm relative overflow-hidden">
				<!-- Decorative background element -->
				<div class="absolute top-0 right-0 -mt-16 -mr-16 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
				
				<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-6 relative z-10">
					<div class="flex-1 space-y-3">
						<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1.5">
							<Settings2 class="w-3.5 h-3.5" />
							Active Pipeline Profile
						</Label>
						<select
							bind:value={selectedConfigId}
							class="w-full bg-background border border-border/50 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground shadow-sm"
						>
							{#each configs as conf}
								<option value={conf.id}>
									{conf.name}
									{activeConfigId === conf.id ? ' ★ (Active)' : ''}
								</option>
							{/each}
						</select>
					</div>
					<div class="flex items-center gap-2 mt-7">
						<Button
							variant="outline"
							size="sm"
							onclick={createNewConfig}
							disabled={configs.length >= 20}
							class="border-dashed border-border/50 hover:bg-primary/5 hover:text-primary transition-colors"
						>
							<Plus class="w-4 h-4 mr-1.5" />
							New Pipeline
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => confirmDeleteOpen = true}
							disabled={configs.length <= 1}
							class="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
						>
							<Trash2 class="w-4 h-4 mr-1.5" />
							Delete
						</Button>
					</div>
				</div>

				{#if selectedConfigIndex !== -1}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 mt-4 border-t border-border/20 relative z-10">
						<div class="space-y-2">
							<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Profile Name</Label>
							<Input
								bind:value={configs[selectedConfigIndex].name}
								placeholder="e.g. Creative Coding Swarm"
								class="bg-background/50 border-border/50 rounded-lg focus-visible:ring-primary/50"
							/>
						</div>
						<div class="flex items-end pb-2">
							<label class="flex items-center gap-3 cursor-pointer select-none group">
								<div class="relative flex items-center justify-center w-5 h-5 rounded border {activeConfigId === selectedConfigId ? 'border-primary bg-primary' : 'border-border/50 bg-background'} transition-colors">
									{#if activeConfigId === selectedConfigId}
										<Star class="w-3 h-3 text-primary-foreground fill-primary-foreground" />
									{/if}
									<input
										type="checkbox"
										checked={activeConfigId === selectedConfigId}
										onchange={(e) => {
											if (e.currentTarget.checked) {
												activeConfigId = selectedConfigId;
											} else {
												activeConfigId = '';
											}
										}}
										class="absolute inset-0 opacity-0 cursor-pointer"
									/>
								</div>
								<span class="text-sm font-semibold text-foreground group-hover:text-primary transition-colors"
									>Set as active pipeline configuration</span
								>
							</label>
						</div>
					</div>
				{/if}
			</div>

			{#if selectedConfigIndex !== -1}
				{@const currentNodes = configs[selectedConfigIndex].nodes}

				<div class="space-y-6 relative">
					<!-- Visual Pipeline Connector Line -->
					{#if currentNodes.length > 1}
						<div class="absolute left-6 top-8 bottom-12 w-0.5 bg-gradient-to-b from-primary/30 via-primary/20 to-transparent z-0"></div>
					{/if}

					{#if currentNodes.length === 0}
						<div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-muted/5 rounded-2xl border-2 border-border/20 border-dashed m-2 relative z-10" transition:slide={{ duration: 300 }}>
							<div class="w-16 h-16 mb-5 rounded-full bg-background flex items-center justify-center border border-border/50 shadow-sm">
								<Workflow class="h-8 w-8 text-muted-foreground/60" />
							</div>
							<h4 class="text-lg font-bold text-foreground mb-2 tracking-tight">Empty Pipeline</h4>
							<p class="text-sm text-muted-foreground max-w-sm mx-auto mb-0 leading-relaxed">
								No nodes are currently configured. Add your first agent below to begin building your swarm.
							</p>
						</div>
					{/if}

					{#each currentNodes as node, i (node.id)}
						{@const isSynthesizer = node.role === 'synthesizer'}
						<div class="relative z-10 pl-14" transition:slide={{ duration: 300 }}>
							<!-- Node Step Indicator -->
							<div class="absolute left-0 top-6 w-12 flex justify-center">
								<div class="w-12 h-12 rounded-full border-4 border-background {isSynthesizer ? 'bg-purple-500' : 'bg-cyan-500'} flex items-center justify-center text-white shadow-md z-10">
									{#if isSynthesizer}
										<Brain class="w-5 h-5" />
									{:else}
										<Bot class="w-5 h-5" />
									{/if}
								</div>
							</div>

							<!-- Node Card -->
							<div class="p-5 border {isSynthesizer ? 'border-purple-500/30 bg-purple-500/5' : 'border-cyan-500/30 bg-cyan-500/5'} rounded-2xl shadow-sm relative group transition-all duration-300 hover:shadow-md">
								<div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
									<Button
										variant="ghost"
										size="icon"
										onclick={() => removeNode(node.id)}
										class="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8"
										disabled={currentNodes.length <= 1}
									>
										<Trash2 class="w-4 h-4" />
									</Button>
								</div>

								<div class="flex items-center gap-3 mb-5">
									<div class="font-bold text-lg {isSynthesizer ? 'text-purple-500 dark:text-purple-400' : 'text-cyan-600 dark:text-cyan-400'}">
										Node {i + 1}: {isSynthesizer ? 'Synthesizer' : 'Worker'}
									</div>
									{#if isSynthesizer}
										<Badge variant="outline" class="bg-purple-500/10 text-purple-500 border-purple-500/20 text-[10px] uppercase tracking-wider">Final Output</Badge>
									{:else}
										<Badge variant="outline" class="bg-cyan-500/10 text-cyan-600 border-cyan-500/20 text-[10px] uppercase tracking-wider dark:text-cyan-400">Generator</Badge>
									{/if}
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
									<div class="space-y-2">
										<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Role</Label>
										<select
											bind:value={node.role}
											class="flex-1 w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 {isSynthesizer ? 'focus:ring-purple-500/50' : 'focus:ring-cyan-500/50'} font-medium text-foreground transition-all"
										>
											<option value="worker">Worker (Generates distinct response)</option>
											<option value="synthesizer">Synthesizer (Combines previous outputs)</option>
										</select>
									</div>

									<div class="space-y-2">
										<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Source Type</Label>
										<select
											bind:value={node.sourceType}
											class="flex-1 w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 {isSynthesizer ? 'focus:ring-purple-500/50' : 'focus:ring-cyan-500/50'} font-medium text-foreground transition-all"
											onchange={(e) => {
												if (e.currentTarget.value === 'local') {
													node.url = `${getBaseUrl('llama')}/v1`;
													node.modelName = '';
												} else {
													node.url = '';
												}
											}}
										>
											<option value="local">Local (Active Model Slot)</option>
											<option value="custom">Custom Remote Endpoint</option>
										</select>
									</div>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
									{#if node.sourceType === 'local'}
										<div class="space-y-2 md:col-span-2">
											<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Select Local Model</Label>
											<select
												bind:value={node.modelName}
												class="flex-1 w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 {isSynthesizer ? 'focus:ring-purple-500/50' : 'focus:ring-cyan-500/50'} font-medium text-foreground transition-all"
											>
												<option value="">Select an active slot...</option>
												{#each activeModels as am}
													{#if am}
														<option value={am.value}>{am.label}</option>
													{/if}
												{/each}
											</select>
										</div>
									{:else}
										<div class="space-y-2">
											<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">API Base URL</Label>
											<Input bind:value={node.url} placeholder="e.g. http://127.0.0.1:8080/v1" class="bg-background/80 border-border/50 rounded-xl focus-visible:ring-2 {isSynthesizer ? 'focus-visible:ring-purple-500/50' : 'focus-visible:ring-cyan-500/50'}"/>
										</div>
										<div class="space-y-2">
											<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Model Identifier</Label>
											<Input bind:value={node.modelName} placeholder="e.g. gpt-4" class="bg-background/80 border-border/50 rounded-xl focus-visible:ring-2 {isSynthesizer ? 'focus-visible:ring-purple-500/50' : 'focus-visible:ring-cyan-500/50'}" />
										</div>
									{/if}
								</div>

								<div class="space-y-4 mb-5 border-t border-border/10 pt-5">
									<div class="flex flex-col gap-2">
										<div class="flex items-center justify-between">
											<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">Creativity (Temperature)</Label>
											<Badge variant="outline" class="font-mono text-xs bg-background">{node.temperature.toFixed(2)}</Badge>
										</div>
										<div class="flex items-center gap-4 w-full">
											<span class="text-xs text-muted-foreground font-mono">0.0</span>
											<input
												type="range"
												min="0"
												max="2"
												step="0.05"
												bind:value={node.temperature}
												class="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer {isSynthesizer ? 'accent-purple-500' : 'accent-cyan-500'}"
											/>
											<span class="text-xs text-muted-foreground font-mono">2.0</span>
										</div>
									</div>
								</div>

								<div class="space-y-2 border-t border-border/10 pt-5">
									<Label class="text-xs uppercase tracking-widest text-muted-foreground font-bold">System Prompt / Persona</Label>
									<Textarea
										bind:value={node.persona}
										placeholder="You are a helpful assistant..."
										rows={3}
										class="resize-none bg-background/80 border-border/50 rounded-xl focus-visible:ring-2 {isSynthesizer ? 'focus-visible:ring-purple-500/50' : 'focus-visible:ring-cyan-500/50'} text-sm leading-relaxed"
									/>
								</div>
							</div>
						</div>
					{/each}

					{#if currentNodes.length < 6}
						<div class="pl-14 pt-2 relative z-10" transition:slide={{ duration: 300 }}>
							<Button variant="outline" class="w-full h-14 border-2 border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all rounded-xl" onclick={addNode}>
								<Plus class="w-5 h-5 mr-2" />
								<span class="font-bold tracking-wide">Add Next Node</span>
							</Button>
						</div>
					{/if}
				</div>
			{/if}

			<div class="mt-8 p-5 bg-[#0f111a] rounded-xl border border-border/50 shadow-inner flex flex-col gap-3 group relative overflow-hidden">
				<div class="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#0f111a] to-transparent z-0 pointer-events-none"></div>
				<div class="flex items-center justify-between relative z-10">
					<div class="text-xs uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-2">
						<Network class="w-3.5 h-3.5" />
						Swarm API Endpoint
					</div>
					<Button variant="ghost" size="sm" onclick={copyEndpoint} class="h-8 text-muted-foreground hover:text-white hover:bg-white/10 -mr-2 transition-colors">
						<Copy class="w-3.5 h-3.5 mr-1.5" />
						Copy
					</Button>
				</div>
				<div class="text-sm font-mono text-green-400 break-all relative z-10 bg-black/30 p-3 rounded-lg border border-white/5">
					{swarmEndpoint}
				</div>
			</div>
		</div>

		<Dialog.Footer class="pt-4 border-t border-border/30">
			<Button variant="ghost" onclick={() => (open = false)} class="rounded-xl">Cancel</Button>
			<Button onclick={saveConfig} disabled={loading || selectedConfigIndex === -1} class="rounded-xl font-bold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
				{loading ? 'Saving...' : 'Save Pipeline'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<DialogConfirmation
	bind:open={confirmDeleteOpen}
	title="Delete Pipeline"
	description="Are you sure you want to permanently delete this MoA pipeline configuration?"
	confirmText="Delete Pipeline"
	confirmVariant="destructive"
	onConfirm={() => {
		deleteConfig();
		confirmDeleteOpen = false;
	}}
/>
