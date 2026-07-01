<script lang="ts">
	import { Wrench, Database, MessageSquare, FileText, Sparkles, ListChecks } from '@lucide/svelte';
	import type { MCPCapabilitiesInfo } from '$lib/types';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		capabilities?: MCPCapabilitiesInfo;
	}

	let { capabilities }: Props = $props();
</script>

{#if capabilities}
	{#if capabilities.server.tools}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<Wrench class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Tools
		</Badge>
	{/if}

	{#if capabilities.server.resources}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<Database class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Resources
		</Badge>
	{/if}

	{#if capabilities.server.prompts}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<MessageSquare class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Prompts
		</Badge>
	{/if}

	{#if capabilities.server.logging}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<FileText class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Logging
		</Badge>
	{/if}

	{#if capabilities.server.completions}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<Sparkles class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Completions
		</Badge>
	{/if}

	{#if capabilities.server.tasks}
		<Badge
			variant="outline"
			class="h-5 gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 px-1.5 text-[10px] text-muted-foreground border-border/40"
		>
			<ListChecks class="h-3 w-3 text-neutral-600 dark:text-neutral-400" />

			Tasks
		</Badge>
	{/if}
{/if}
