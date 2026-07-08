<script lang="ts">
	import { serverStore } from '$lib/stores/server.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { ModelsService } from '$lib/services/models.service';
	import { BrainCircuit, Code2, Lock, ArrowRight, Download, Loader2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { goto } from '$app/navigation';
	import { ROUTES } from '$lib/constants';
	import { toast } from 'svelte-sonner';

	interface Props {
		isEmpty: boolean;
	}

	let { isEmpty = false }: Props = $props();

	const hasNoModels = $derived(modelsStore.models.length === 0);
	const isRouter = $derived(serverStore.isRouterMode);

	const RECOMMENDED_MODELS = [
		{ id: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', name: 'Qwen-2.5-Coder-7B', desc: 'Exceptional at code generation, IDE servicing, and tool use.', specs: ['7B Params', '32K Context'] },
		{ id: 'QuantFactory/Meta-Llama-3-8B-Instruct-GGUF', name: 'Llama-3-8B-Instruct', desc: 'The gold standard for general-purpose reasoning.', specs: ['8B Params', '8K Context'] },
		{ id: 'THUDM/glm-4-9b-chat-GGUF', name: 'GLM-4-9B-Chat', desc: 'Highly capable multi-lingual model with strong agentic tool-calling.', specs: ['9B Params', '128K Context'] },
		{ id: 'microsoft/Phi-3-mini-4k-instruct-gguf', name: 'Phi-3-Mini (3.8B)', desc: 'Extremely lightweight; perfect for older hardware.', specs: ['3.8B Params', '4K Context'] },
		{ id: 'QuantFactory/Mistral-Nemo-Instruct-2407-GGUF', name: 'Mistral-Nemo-12B', desc: 'A fantastic balance of high-end capability and manageable size.', specs: ['12B Params', '128K Context'] }
	];

	let downloadingModelId = $state<string | null>(null);

	async function handleQuickDownload(modelId: string) {
		try {
			downloadingModelId = modelId;
			await ModelsService.download(modelId);
			toast.success(`Started downloading ${modelId}`);
		} catch (e: any) {
			toast.error(`Failed to start download: ${e.message}`);
			downloadingModelId = null;
		}
	}
</script>

{#if isEmpty}
	<div
		class={[
			'mb-4 px-4 text-center text-balance',
			'mb-[calc(50dvh-8rem)] md:mb-6 pointer-events-auto block!'
		]}
	>
		{#if hasNoModels && !isRouter}
			<div class="mx-auto max-w-4xl pt-8 pb-12 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-700">
				<h1 class="mb-3 text-3xl font-bold tracking-tight md:text-4xl bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">Welcome to LLaMA Pro</h1>
				<p class="text-muted-foreground md:text-lg max-w-2xl mx-auto mb-10">
					Your personal AI environment is ready. To unleash its full potential—including serving external IDEs and executing agentic tools—you need to give it a brain.
				</p>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-12 text-left">
					<div class="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
						<div class="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
							<BrainCircuit class="h-5 w-5 text-primary" />
						</div>
						<h3 class="font-semibold mb-2 text-foreground">Agentic AI</h3>
						<p class="text-sm text-muted-foreground leading-relaxed">Equip capable models with tools to execute complex, multi-step tasks autonomously.</p>
					</div>
					<div class="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both">
						<div class="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
							<Code2 class="h-5 w-5 text-primary" />
						</div>
						<h3 class="font-semibold mb-2 text-foreground">IDE Servicing</h3>
						<p class="text-sm text-muted-foreground leading-relaxed">Power external editors like VS Code with inline completions and chat via our local API.</p>
					</div>
					<div class="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both">
						<div class="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
							<Lock class="h-5 w-5 text-primary" />
						</div>
						<h3 class="font-semibold mb-2 text-foreground">Local Privacy</h3>
						<p class="text-sm text-muted-foreground leading-relaxed">Everything runs directly on your machine. No telemetry, no data collection, pure privacy.</p>
					</div>
				</div>

				<div class="bg-muted/30 border border-border/40 rounded-2xl p-6 md:p-8 w-full max-w-2xl mb-8 backdrop-blur-md">
					<h3 class="font-semibold text-lg mb-6 flex items-center gap-2 justify-center text-foreground">
						<Download class="h-5 w-5 text-muted-foreground" />
						Recommended Models
					</h3>
					<div class="flex flex-col gap-3 text-left">
						{#each RECOMMENDED_MODELS as model}
							{@const progress = modelsStore.getDownloadProgress(model.id)}
							{@const isDownloading = downloadingModelId === model.id || (progress && progress.total > 0)}
							<div class="group flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-lg bg-background/60 border border-border/40 hover:bg-accent/40 transition-colors">
								<div class="flex flex-col flex-1 pr-4">
									<div class="flex items-center gap-2">
										<span class="font-mono font-medium text-sm text-foreground">{model.name}</span>
										{#each model.specs as spec}
											<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium tracking-wide">{spec}</span>
										{/each}
									</div>
									<span class="text-xs text-muted-foreground leading-relaxed mt-1">{model.desc}</span>
								</div>
								
								{#if isDownloading}
									<div class="mt-3 sm:mt-0 flex items-center justify-center min-w-[100px]">
										{#if progress && progress.total > 0}
											{@const percent = Math.round((progress.done / progress.total) * 100)}
											<div class="flex items-center text-xs font-medium text-primary">
												<Loader2 class="mr-2 h-3.5 w-3.5 animate-spin" />
												{percent}%
											</div>
										{:else}
											<div class="flex items-center text-xs font-medium text-muted-foreground animate-pulse">
												<Loader2 class="mr-2 h-3.5 w-3.5 animate-spin" />
												Starting...
											</div>
										{/if}
									</div>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										class="mt-3 sm:mt-0 opacity-0 sm:group-hover:opacity-100 transition-opacity whitespace-nowrap"
										onclick={() => handleQuickDownload(model.id)}
									>
										<Download class="mr-2 h-4 w-4" />
										Download
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<div class="relative group">
					<div class="absolute -inset-1 bg-primary/20 rounded-full blur-md opacity-75 group-hover:opacity-100 animate-pulse transition duration-1000"></div>
					<Button 
						size="lg" 
						class="relative rounded-full shadow-lg hover:shadow-primary/25 transition-all duration-300 font-semibold px-8 h-12 text-base"
						onclick={() => goto('#/settings/models')}
					>
						Open Model Management
						<ArrowRight class="ml-2 h-5 w-5" />
					</Button>
				</div>
			</div>
		{:else}
			<div class="pointer-events-none">
				<h1 class="mb-2 text-2xl font-semibold tracking-tight md:text-3xl">Hello there</h1>
				<p class="text-muted-foreground md:text-lg">
					{serverStore.props?.modalities?.audio ? 'Record audio, type a message ' : 'Type a message'} or upload
					files to get started
				</p>
			</div>
		{/if}
	</div>
{/if}
