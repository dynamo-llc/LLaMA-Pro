<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Badge } from '$lib/components/ui/badge';

	interface Resource {
		name: string;
		uri: string;
		description?: string;
	}

	interface Props {
		resources: Resource[];
		onReadResource?: (resource: Resource) => void;
	}

	let { resources, onReadResource }: Props = $props();

	let isExpanded = $state(false);
	let resourcesCount = $derived(resources.length);
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

		<span>{resourcesCount} resources available · Show details</span>
	</Collapsible.Trigger>

	<Collapsible.Content class="mt-2">
		<div class="max-h-64 space-y-3 overflow-y-auto pl-1 pr-2">
			{#each resources as resource (resource.uri)}
				<div class="flex items-start justify-between gap-2 group">
					<div class="flex-grow overflow-hidden">
						<Badge variant="outline" class="mb-1 truncate max-w-full text-blue-500 border-blue-500/30 bg-blue-500/5">{resource.name}</Badge>
						<p class="text-[10px] font-mono text-muted-foreground truncate">{resource.uri}</p>
						{#if resource.description}
							<p class="mt-1 text-xs text-muted-foreground line-clamp-3">{resource.description}</p>
						{/if}
					</div>
					{#if onReadResource}
					<button
						onclick={(e) => { e.stopPropagation(); onReadResource(resource); }}
						class="shrink-0 text-[10px] uppercase font-semibold tracking-wider text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-500/10 hover:bg-blue-500/20 px-2 py-1 rounded border border-blue-500/20 mt-1"
					>
						Read
					</button>
					{/if}
				</div>
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
