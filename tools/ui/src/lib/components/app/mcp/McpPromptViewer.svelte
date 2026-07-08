<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Loader2, Terminal } from '@lucide/svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import type { MCPPromptInfo } from '$lib/types';

	interface Props {
		open: boolean;
		prompt: MCPPromptInfo;
		serverName: string;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), prompt, serverName, onOpenChange }: Props = $props();

	let isExecuting = $state(false);
	let result = $state<any | null>(null);
	let error = $state<string | null>(null);

	let formValues = $state<Record<string, string>>({});

	// Initialize form
	$effect(() => {
		if (open && prompt.arguments) {
			const defaults: Record<string, string> = {};
			for (const arg of prompt.arguments) {
				defaults[arg.name] = '';
			}
			formValues = { ...defaults };
			
			result = null;
			error = null;
		} else if (open) {
			formValues = {};
			result = null;
			error = null;
		}
	});

	async function handleExecute() {
		isExecuting = true;
		error = null;
		result = null;
		
		try {
			const response = await mcpStore.getPrompt(serverName, prompt.name, formValues);
			result = JSON.stringify(response, null, 2);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown execution error';
		} finally {
			isExecuting = false;
		}
	}

	function handleOpenChange(value: boolean) {
		open = value;
		onOpenChange?.(value);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-3xl max-h-[85vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Terminal class="w-5 h-5 text-purple-500" />
				Get Prompt: <span class="text-purple-500 font-mono bg-purple-500/10 px-1 rounded">{prompt.name}</span>
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex flex-col md:flex-row gap-4 mt-2 flex-grow min-h-0">
			<!-- Input Panel -->
			<div class="flex-1 flex flex-col gap-2 min-w-[50%]">
				<div class="flex items-center justify-between">
					<label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Arguments</label>
				</div>

				{#if prompt.arguments && prompt.arguments.length > 0}
					<div class="flex-1 overflow-y-auto space-y-3 p-1">
						{#each prompt.arguments as arg (arg.name)}
							<div class="space-y-1">
								<Label class="text-xs">{arg.name} {#if arg.required}<span class="text-destructive">*</span>{/if}</Label>
								<Input type="text" bind:value={formValues[arg.name]} disabled={isExecuting} placeholder={arg.description} class="h-8 text-xs" />
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-md border border-border/50">
						No arguments required
					</div>
				{/if}
				
				<Button class="w-full mt-2 bg-purple-600 hover:bg-purple-700 text-white" onclick={handleExecute} disabled={isExecuting}>
					{#if isExecuting}
						<Loader2 class="w-4 h-4 mr-2 animate-spin" />
						Fetching...
					{:else}
						<Terminal class="w-4 h-4 mr-2" />
						Get Prompt
					{/if}
				</Button>
			</div>

			<!-- Output Panel -->
			<div class="flex-1 flex flex-col gap-2">
				<label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response</label>
				<div class="flex-grow bg-black rounded-md border border-border p-3 overflow-auto relative h-[250px] md:h-full">
					{#if error}
						<div class="text-destructive font-mono text-sm">{error}</div>
					{:else if result}
						<pre class="text-green-400 font-mono text-xs whitespace-pre-wrap break-all">{result}</pre>
					{:else}
						<div class="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50">
							<Terminal class="w-8 h-8 mb-2" />
							<p class="text-sm">Click Get Prompt to see output</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<Dialog.Footer class="mt-4">
			<Button variant="secondary" onclick={() => handleOpenChange(false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
