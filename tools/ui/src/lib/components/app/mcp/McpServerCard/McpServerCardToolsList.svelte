<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Badge } from '$lib/components/ui/badge';

	interface Tool {
		name: string;
		description?: string;
		inputSchema?: any;
	}

	interface Props {
		tools: Tool[];
		onTestTool?: (tool: Tool) => void;
	}

	let { tools, onTestTool }: Props = $props();

	let isExpanded = $state(false);
	let toolsCount = $derived(tools.length);
</script>

<Collapsible.Root bind:open={isExpanded}>
	<Collapsible.Trigger
		class="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
	>
		{#if isExpanded}
			<ChevronDown class="h-3.5 w-3.5" />
		{:else}
			<ChevronRight class="h-3.5 w-3.5" />
		{/if}

		<span>{toolsCount} tools available · Show details</span>
	</Collapsible.Trigger>

	<Collapsible.Content class="mt-2">
		<div class="max-h-64 space-y-3 overflow-y-auto">
			{#each tools as tool (tool.name)}
				<div class="flex items-start justify-between gap-2 group">
					<div class="flex-grow">
						<Badge variant="secondary" class="mb-1">{tool.name}</Badge>
						{#if tool.description}
							<p class="text-xs text-muted-foreground line-clamp-3">{tool.description}</p>
						{/if}
					</div>
					{#if onTestTool}
					<button
						onclick={(e) => { e.stopPropagation(); onTestTool(tool); }}
						class="shrink-0 text-[10px] uppercase font-semibold tracking-wider text-primary opacity-0 group-hover:opacity-100 transition-opacity bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20"
					>
						Test
					</button>
					{/if}
				</div>
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
