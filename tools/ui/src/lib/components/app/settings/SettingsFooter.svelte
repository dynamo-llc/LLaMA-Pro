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

<div class="static mx-auto mt-12 mb-8 flex w-full max-w-5xl items-center justify-between overflow-hidden rounded-2xl border border-primary/20 bg-card p-6 shadow-[0_0_40px_-15px_rgba(0,0,0,0.3)] shadow-primary/10 transition-all dark:border-primary/10 dark:bg-card/60">
	<!-- Aesthetic decorative gradient background for Cyberpunk/Modern feel -->
	<div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 opacity-60"></div>
	
	<div class="flex items-center gap-4 pl-2">
		<div class="h-10 w-2 rounded-full bg-gradient-to-b from-primary to-primary/30 shadow-[0_0_10px_rgba(var(--primary),0.5)]"></div>
		<div class="flex flex-col">
			<span class="text-[14px] font-bold uppercase tracking-widest text-foreground">Action Center</span>
			<span class="text-[11px] font-medium text-muted-foreground mt-0.5">Pending changes will not apply until saved</span>
		</div>
	</div>

	<div class="flex items-center gap-4 pr-2">
		<Button 
			variant="outline" 
			onclick={handleResetClick} 
			class="group h-11 px-6 rounded-xl border-dashed border-muted-foreground/30 bg-transparent transition-all duration-300 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
		>
			<RotateCcw class="mr-2 h-4 w-4 transition-transform duration-500 ease-out group-hover:-rotate-[360deg]" />
			Reset to default
		</Button>

		<Button 
			onclick={handleSave} 
			class="h-11 rounded-xl px-10 text-[13px] font-bold uppercase tracking-wider shadow-[0_0_20px_-5px_rgba(var(--primary),0.5)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_25px_-2px_rgba(var(--primary),0.6)] active:translate-y-0"
		>
			Save Settings
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
