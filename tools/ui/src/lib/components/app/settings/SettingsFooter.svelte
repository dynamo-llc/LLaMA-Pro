<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { RotateCcw } from '@lucide/svelte';

	interface Props {
		onReset?: () => void;
		onSave?: () => void;
	}

	let { onReset, onSave }: Props = $props();

	let showResetDialog = $state(false);

	function handleResetClick() {
		showResetDialog = true;
	}

	function handleConfirmReset() {
		settingsStore.forceSyncWithServerDefaults();
		onReset?.();

		showResetDialog = false;
	}

	function handleSave() {
		onSave?.();
	}
</script>

<div class="sticky bottom-4 z-50 mx-auto mt-8 flex w-full max-w-5xl items-center justify-between overflow-hidden rounded-2xl border border-border/40 bg-background/60 p-4 shadow-2xl shadow-black/5 backdrop-blur-xl transition-all dark:border-white/5 dark:bg-background/40 dark:shadow-black/20">
	<!-- Aesthetic decorative gradient background for Cyberpunk/Modern feel -->
	<div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 opacity-50"></div>
	
	<div class="flex items-center gap-3 pl-2">
		<div class="h-9 w-1.5 rounded-full bg-gradient-to-b from-primary to-primary/50"></div>
		<div class="flex flex-col">
			<span class="text-[11px] font-bold uppercase tracking-widest text-foreground/90">Action Center</span>
			<span class="text-[10px] font-medium text-muted-foreground/80">Pending changes will not apply until saved</span>
		</div>
	</div>

	<div class="flex items-center gap-3 pr-2">
		<Button 
			variant="outline" 
			onclick={handleResetClick} 
			class="group h-10 rounded-xl border-dashed border-muted-foreground/30 bg-transparent transition-all duration-300 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
		>
			<RotateCcw class="mr-2 h-4 w-4 transition-transform duration-500 ease-out group-hover:-rotate-[360deg]" />
			Reset to default
		</Button>

		<Button 
			onclick={handleSave} 
			class="h-10 rounded-xl px-8 font-semibold shadow-lg shadow-primary/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40 active:translate-y-0"
		>
			Save settings
		</Button>
	</div>
</div>

<AlertDialog.Root bind:open={showResetDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Reset Settings to Default</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to reset all settings to their default values? This will reset all
				parameters to the values provided by the server's /props endpoint and remove all your custom
				configurations.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleConfirmReset}>Reset to Default</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
