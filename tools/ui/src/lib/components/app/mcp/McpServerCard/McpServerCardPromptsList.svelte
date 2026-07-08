<script lang="ts">
	import { ChevronDown, ChevronRight, Terminal } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Badge } from '$lib/components/ui/badge';
	import type { MCPPromptInfo } from '$lib/types';

	interface Props {
		prompts: MCPPromptInfo[];
		onGetPrompt?: (prompt: MCPPromptInfo) => void;
	}

	let { prompts, onGetPrompt }: Props = $props();

	let isExpanded = $state(false);
	let promptsCount = $derived(prompts.length);
</script>

<Collapsible.Root bind:open={isExpanded}>
	<Collapsible.Trigger
		class="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2"
	>
		{#if isExpanded}
			<ChevronDown class="h-3.5 w-3.5" />
		{:else}
			<ChevronRight class="h-3.5 w-3.5" />
		{/if}

		<span>{promptsCount} prompts available · Show details</span>
	</Collapsible.Trigger>

	<Collapsible.Content class="mt-2">
		<div class="max-h-64 space-y-3 overflow-y-auto pl-1 pr-2">
			{#each prompts as prompt (prompt.name)}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<div>
							<Badge variant="outline" class="mb-1 text-purple-500 border-purple-500/30 bg-purple-500/5">
								<Terminal class="w-3 h-3 mr-1" />
								{prompt.name}
							</Badge>
							{#if prompt.description}
								<p class="mt-1 text-xs text-muted-foreground">{prompt.description}</p>
							{/if}
						</div>
						
						{#if onGetPrompt}
							<button 
								class="shrink-0 p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded-md transition-colors"
								title="Get Prompt"
								onclick={() => onGetPrompt(prompt)}
							>
								<Terminal class="w-4 h-4" />
							</button>
						{/if}
					</div>
					{#if prompt.arguments && prompt.arguments.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each prompt.arguments as arg}
								<span class="text-[10px] font-mono bg-muted px-1 rounded text-muted-foreground border border-border">
									{arg.name}{arg.required ? '*' : ''}
								</span>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
