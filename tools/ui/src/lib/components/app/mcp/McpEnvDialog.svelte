<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { McpCatalogEntry, McpEnvKey } from '$lib/constants/mcp-catalog';
	import { Shield } from '@lucide/svelte';

	interface Props {
		open: boolean;
		entry: McpCatalogEntry | null;
		onOpenChange?: (open: boolean) => void;
		onConfirm: (env: Record<string, string>) => void;
	}

	let { open = $bindable(), entry, onOpenChange, onConfirm }: Props = $props();

	let envValues = $state<Record<string, string>>({});

	// Initialize envValues when dialog opens and entry is provided
	$effect(() => {
		if (open && entry && entry.envKeys) {
			const newValues: Record<string, string> = {};
			for (const [key, details] of Object.entries(entry.envKeys)) {
				newValues[key] = details.default || '';
			}
			envValues = newValues;
		}
	});

	let envKeysList = $derived.by(() => {
		if (!entry || !entry.envKeys) return [];
		return Object.entries(entry.envKeys).map(([key, details]) => ({ key, details }));
	});

	let isFormValid = $derived.by(() => {
		for (const { key, details } of envKeysList) {
			if (details.required && !envValues[key]?.trim()) {
				return false;
			}
		}
		return true;
	});

	function handleConfirm() {
		if (!isFormValid) return;
		onConfirm(envValues);
		handleOpenChange(false);
	}

	function handleOpenChange(value: boolean) {
		open = value;
		onOpenChange?.(value);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Shield class="w-5 h-5 text-primary" />
				Configure {entry?.name}
			</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<p class="text-sm text-muted-foreground">
				This MCP server requires environment variables to function correctly (e.g. API keys or tokens).
				These are passed securely to the local proxy process.
			</p>
			
			{#each envKeysList as { key, details }}
				<div class="space-y-2">
					<Label for={key} class="flex justify-between">
						<span>{key}</span>
						{#if !details.required}
							<span class="text-xs text-muted-foreground font-normal">(Optional)</span>
						{/if}
					</Label>
					<Input 
						id={key} 
						type="password" 
						placeholder={details.description}
						bind:value={envValues[key]} 
					/>
					<p class="text-[10px] text-muted-foreground">{details.description}</p>
				</div>
			{/each}
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={() => handleOpenChange(false)}>Cancel</Button>
			<Button variant="default" size="sm" onclick={handleConfirm} disabled={!isFormValid}>
				Install Server
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
