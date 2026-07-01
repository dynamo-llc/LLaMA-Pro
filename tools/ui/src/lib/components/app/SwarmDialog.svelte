<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Trash2, Plus, Network, Cpu, Copy, Star } from '@lucide/svelte';
	import { modelsStore } from '$lib/stores/models.svelte';

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
	let swarmEndpoint = 'http://127.0.0.1:8000/v1/swarm/chat/completions';

	let selectedConfigIndex = $derived(configs.findIndex((c) => c.id === selectedConfigId));

	// Fetch current configuration
	async function loadConfig() {
		try {
			const res = await fetch('http://127.0.0.1:8000/v1/swarm/config');
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
						url: 'http://127.0.0.1:8080/v1',
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
				url: 'http://127.0.0.1:8080/v1',
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
			const res = await fetch('http://127.0.0.1:8000/v1/swarm/config', {
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
	<Dialog.Content class="max-w-3xl max-h-[90vh] overflow-y-auto text-foreground">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Network class="w-5 h-5 text-primary" />
				Configure Agent Swarm
			</Dialog.Title>
			<Dialog.Description>
				Chain up to 6 models into a single endpoint. Assign roles (Worker or Synthesizer), personas,
				and temperatures. Create up to 20 configurations.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4 space-y-6">
			<!-- Configuration Selector -->
			<div class="p-4 border rounded-xl bg-muted/20 space-y-4">
				<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
					<div class="flex-1 space-y-2">
						<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
							>Select Configuration</Label
						>
						<select
							bind:value={selectedConfigId}
							class="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
						>
							{#each configs as conf}
								<option value={conf.id}>
									{conf.name}
									{activeConfigId === conf.id ? '★ (Active)' : ''}
								</option>
							{/each}
						</select>
					</div>
					<div class="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onclick={createNewConfig}
							disabled={configs.length >= 20}
						>
							<Plus class="w-3.5 h-3.5 mr-1" />
							New Swarm
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onclick={deleteConfig}
							disabled={configs.length <= 1}
						>
							<Trash2 class="w-3.5 h-3.5 mr-1" />
							Delete
						</Button>
					</div>
				</div>

				{#if selectedConfigIndex !== -1}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
						<div class="space-y-1.5">
							<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
								>Swarm Name</Label
							>
							<Input
								bind:value={configs[selectedConfigIndex].name}
								placeholder="Swarm Name (e.g. Coding Swarm)"
							/>
						</div>
						<div class="flex items-end pb-1.5">
							<label class="flex items-center gap-2 cursor-pointer select-none">
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
									class="accent-primary h-4 w-4 rounded border-border"
								/>
								<span class="text-xs font-semibold text-foreground"
									>Set as active Swarm configuration</span
								>
							</label>
						</div>
					</div>
				{/if}
			</div>

			{#if selectedConfigIndex !== -1}
				{@const currentNodes = configs[selectedConfigIndex].nodes}

				{#if currentNodes.length === 0}
					<div class="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
						No nodes configured. Add your first node below!
					</div>
				{/if}

				{#each currentNodes as node, i (node.id)}
					<div class="p-4 border rounded-xl bg-card space-y-4 shadow-sm relative">
						<div class="absolute top-4 right-4">
							<Button
								variant="ghost"
								size="icon"
								onclick={() => removeNode(node.id)}
								class="text-destructive hover:bg-destructive/10"
								disabled={currentNodes.length <= 1}
							>
								<Trash2 class="w-4 h-4" />
							</Button>
						</div>

						<div class="flex items-center gap-2 mb-2 font-semibold">
							<div
								class="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs"
							>
								{i + 1}
							</div>
							Node {i + 1}
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
									>Role</Label
								>
								<select
									bind:value={node.role}
									class="flex-1 w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary truncate font-medium text-foreground"
								>
									<option value="worker">Worker (Agent)</option>
									<option value="synthesizer">Synthesizer (Judge)</option>
								</select>
							</div>

							<div class="space-y-2">
								<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
									>Source Type</Label
								>
								<select
									bind:value={node.sourceType}
									class="flex-1 w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary truncate font-medium text-foreground"
									onchange={(e) => {
										if (e.currentTarget.value === 'local') {
											node.url = 'http://127.0.0.1:8080/v1';
											node.modelName = '';
										} else {
											node.url = '';
										}
									}}
								>
									<option value="local">Local (Active Slot)</option>
									<option value="custom">Custom URL</option>
								</select>
							</div>
						</div>

						{#if node.sourceType === 'local'}
							<div class="space-y-2">
								<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
									>Select Model</Label
								>
								<select
									bind:value={node.modelName}
									class="flex-1 w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary truncate font-medium text-foreground"
								>
									<option value="">Select active slot...</option>
									{#each activeModels as am}
										{#if am}
											<option value={am.value}>{am.label}</option>
										{/if}
									{/each}
								</select>
							</div>
						{:else}
							<div class="space-y-2">
								<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
									>Model URL</Label
								>
								<Input bind:value={node.url} placeholder="http://127.0.0.1:8080/v1" />
							</div>
							<div class="space-y-2">
								<Label class="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
									>Model Name</Label
								>
								<Input bind:value={node.modelName} placeholder="model-name" />
							</div>
						{/if}

						<div class="space-y-3 pt-2">
							<div class="flex justify-between">
								<Label>Temperature</Label>
								<div class="flex items-center gap-4 w-full mt-2">
									<input
										type="range"
										min="0"
										max="2"
										step="0.05"
										bind:value={node.temperature}
										class="flex-1 accent-primary"
									/>
									<span class="text-xs font-mono w-8 text-right">{node.temperature}</span>
								</div>
							</div>
						</div>

						<div class="space-y-1.5 pt-2">
							<Label>System Prompt / Persona</Label>
							<Textarea
								bind:value={node.persona}
								placeholder="You are a helpful assistant..."
								rows={3}
								class="resize-none"
							/>
						</div>
					</div>
				{/each}

				{#if currentNodes.length < 6}
					<Button variant="outline" class="w-full border-dashed" onclick={addNode}>
						<Plus class="w-4 h-4 mr-2" />
						Add Node
					</Button>
				{/if}
			{/if}

			<div class="mt-6 p-4 bg-muted rounded-lg flex items-center justify-between border">
				<div class="space-y-1">
					<div class="text-sm font-semibold flex items-center gap-2">
						<Cpu class="w-4 h-4" />
						Swarm API Endpoint
					</div>
					<div class="text-xs text-muted-foreground font-mono">
						{swarmEndpoint}
					</div>
				</div>
				<Button variant="secondary" size="sm" onclick={copyEndpoint}>
					<Copy class="w-4 h-4 mr-2" />
					Copy URL
				</Button>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={saveConfig} disabled={loading || selectedConfigIndex === -1}>
				{loading ? 'Saving...' : 'Save Swarm Configuration'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
