<script lang="ts">
	import { Trash2, RefreshCw, Pencil, FileText, Power } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		isHealthChecking: boolean;
		isLocal: boolean;
		onEdit: () => void;
		onRefresh: () => void;
		onViewLogs: () => void;
		onRestart: () => void;
		onDelete: () => void;
	}

	let { isHealthChecking, isLocal, onEdit, onRefresh, onViewLogs, onRestart, onDelete }: Props = $props();
</script>

<div class="flex shrink-0 items-center gap-1">
	<Button variant="ghost" size="icon" class="h-7 w-7" onclick={onEdit} aria-label="Edit">
		<Pencil class="h-3.5 w-3.5" />
	</Button>

	<Button
		variant="ghost"
		size="icon"
		class="h-7 w-7"
		onclick={onRefresh}
		disabled={isHealthChecking}
		aria-label="Refresh"
	>
		<RefreshCw class="h-3.5 w-3.5" />
	</Button>

	{#if isLocal}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
			onclick={onRestart}
			aria-label="Restart Server"
		>
			<Power class="h-3.5 w-3.5" />
		</Button>
		
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
			onclick={onViewLogs}
			aria-label="View Logs"
		>
			<FileText class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<Button
		variant="ghost"
		size="icon"
		class="hover:text-destructive-foreground h-7 w-7 text-destructive hover:bg-destructive/10"
		onclick={onDelete}
		aria-label="Delete"
	>
		<Trash2 class="h-3.5 w-3.5" />
	</Button>
</div>
