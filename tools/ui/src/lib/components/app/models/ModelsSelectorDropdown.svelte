<script lang="ts">
	import { ChevronDown, Loader2, Package } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { KeyboardKey, ServerModelStatus } from '$lib/enums';
	import { useModelsSelector } from '$lib/hooks/use-models-selector.svelte';
	import { modelsStore, routerModels } from '$lib/stores/models.svelte';
	import { modelLoadFraction } from '$lib/utils';
	import {
		DialogModelInformation,
		DropdownMenuSearchable,
		ModelId,
		ModelsSelectorList,
		ModelsSelectorOption
	} from '$lib/components/app';
	import ModelLoadHighlight from './ModelLoadHighlight.svelte';
	import type { ModelItem } from './utils';

	interface Props {
		class?: string;
		currentModel?: string | null;
		disabled?: boolean;
		forceForegroundText?: boolean;
		onModelChange?: (modelId: string, modelName: string) => Promise<boolean> | boolean | void;
		useGlobalSelection?: boolean;
	}

	let {
		class: className = '',
		currentModel = null,
		disabled = false,
		forceForegroundText = false,
		onModelChange,
		useGlobalSelection = false
	}: Props = $props();

	let isOpen = $state(false);
	let highlightedIndex = $state<number>(-1);

	const ms = useModelsSelector({
		currentModel: () => currentModel,
		useGlobalSelection: () => useGlobalSelection,
		onModelChange: () => onModelChange,
		onOpenChange: (open) => {
			isOpen = open;
			highlightedIndex = -1;
		}
	});

	$effect(() => {
		void ms.searchTerm;
		highlightedIndex = -1;
	});

	export function open() {
		ms.handleOpenChange(true);
	}

	function handleSearchKeyDown(event: KeyboardEvent) {
		if (event.isComposing) return;

		if (event.key === KeyboardKey.ARROW_DOWN) {
			event.preventDefault();

			if (ms.filteredOptions.length === 0) return;

			if (highlightedIndex === -1 || highlightedIndex === ms.filteredOptions.length - 1) {
				highlightedIndex = 0;
			} else {
				highlightedIndex += 1;
			}
		} else if (event.key === KeyboardKey.ARROW_UP) {
			event.preventDefault();

			if (ms.filteredOptions.length === 0) return;

			if (highlightedIndex === -1 || highlightedIndex === 0) {
				highlightedIndex = ms.filteredOptions.length - 1;
			} else {
				highlightedIndex -= 1;
			}
		} else if (event.key === KeyboardKey.ENTER) {
			event.preventDefault();

			if (highlightedIndex >= 0 && highlightedIndex < ms.filteredOptions.length) {
				const option = ms.filteredOptions[highlightedIndex];

				ms.handleSelect(option.id);
			} else if (ms.filteredOptions.length > 0) {
				highlightedIndex = 0;
			}
		}
	}

	let customModelPath = $state('');
	let isCustomModelLoading = $state(false);

	async function handleLoadCustomModel(event: Event) {
		event.preventDefault();
		const path = customModelPath.trim();
		if (!path) return;

		isCustomModelLoading = true;
		try {
			await modelsStore.loadModel(path);
			const foundOption = modelsStore.models.find((m) => m.model === path || m.id === path);
			if (foundOption) {
				await ms.handleSelect(foundOption.id);
			} else {
				await modelsStore.fetchRouterModels();
				const refreshedOption = modelsStore.models.find((m) => m.model === path || m.id === path);
				if (refreshedOption) {
					await ms.handleSelect(refreshedOption.id);
				}
			}
			customModelPath = '';
			isOpen = false;
		} catch (err) {
			console.error('Failed to load custom model:', err);
		} finally {
			isCustomModelLoading = false;
		}
	}
</script>

<div class={['relative inline-flex flex-col items-end gap-1', className]}>
	{#if ms.loading && ms.options.length === 0 && ms.isRouter}
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<Loader2 class="h-3.5 w-3.5 animate-spin" />

			Loading models…
		</div>
	{:else}
		{@const selectedOption = ms.getDisplayOption()}
		{@const triggerModel = selectedOption?.model}
		{@const triggerStatus = triggerModel
			? routerModels().find((m) => m.id === triggerModel)?.status?.value
			: undefined}
		{@const triggerLoading =
			!!triggerModel &&
			(triggerStatus === ServerModelStatus.LOADING ||
				modelsStore.isModelOperationInProgress(triggerModel))}
		{@const triggerLoadPercent = triggerLoading
			? Math.round(modelLoadFraction(modelsStore.getLoadProgress(triggerModel)) * 100)
			: 0}

		{#if ms.isRouter}
			<DropdownMenu.Root bind:open={isOpen} onOpenChange={ms.handleOpenChange}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						<!-- prevent another nested button element -->
						{#snippet child({ props })}
							<DropdownMenu.Trigger
								{...props}
								class={[
									`relative inline-grid cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-1.5 rounded-sm bg-background px-1.5 py-1 text-xs shadow-sm transition hover:bg-muted-foreground/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-muted-foreground/15 dark:text-secondary-foreground`,
									!ms.isCurrentModelInCache
										? 'bg-neutral-400/10 !text-neutral-500 hover:bg-neutral-400/20 hover:text-neutral-500'
										: forceForegroundText
											? 'text-foreground'
											: ms.isHighlightedCurrentModelActive
												? 'text-foreground'
												: 'text-foreground',
									isOpen && 'text-foreground',
									'max-w-[min(calc(100vw-4rem) md:max-w-[min(calc(100cqw-9rem),25rem)]'
								]}
								disabled={disabled || ms.updating}
							>
								<Package class="h-3.5 w-3.5 shrink-0" />

								{#if selectedOption}
									<ModelId
										modelId={selectedOption.model}
										class="min-w-0 overflow-hidden"
										hideOrgName={false}
										hideQuantization
									/>
								{:else}
									<span class="min-w-0 font-medium">Select model</span>
								{/if}

								{#if ms.updating || ms.isLoadingModel}
									<Loader2 class="h-3 w-3.5 shrink-0 animate-spin" />
								{:else}
									<ChevronDown class="h-3 w-3.5 shrink-0" />
								{/if}

								{#if triggerLoading}
									<ModelLoadHighlight percent={triggerLoadPercent} />
								{/if}
							</DropdownMenu.Trigger>
						{/snippet}
					</Tooltip.Trigger>

					{#if selectedOption}
						<Tooltip.Content>
							<p class="font-mono">{selectedOption.model}</p>
						</Tooltip.Content>
					{/if}
				</Tooltip.Root>

				<DropdownMenu.Content
					align="end"
					class="w-full max-w-[100vw] pt-0 sm:w-max sm:max-w-[calc(100vw-2rem)]"
				>
					<DropdownMenuSearchable
						searchValue={ms.searchTerm}
						onSearchChange={(v) => ms.setSearchTerm(v)}
						placeholder="Search models..."
						onSearchKeyDown={handleSearchKeyDown}
						emptyMessage="No models found."
						isEmpty={ms.filteredOptions.length === 0 && ms.isCurrentModelInCache}
					>
						{#snippet footer()}
							<div class="p-2.5 flex flex-col gap-1.5 border-t bg-muted/20">
								<div
									class="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider px-1"
								>
									Load local GGUF model
								</div>
								<form onsubmit={handleLoadCustomModel} class="flex gap-1.5 items-center">
									<input
										type="text"
										placeholder="C:/path/to/model.gguf"
										bind:value={customModelPath}
										class="flex h-8 w-64 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
										disabled={isCustomModelLoading}
									/>
									<button
										type="submit"
										class="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 px-3 whitespace-nowrap"
										disabled={!customModelPath.trim() || isCustomModelLoading}
									>
										{#if isCustomModelLoading}
											<Loader2 class="h-3 w-3 animate-spin mr-1" />
											Loading
										{:else}
											Load
										{/if}
									</button>
								</form>
							</div>
						{/snippet}

						<div class="models-list">
							{#if !ms.isCurrentModelInCache && currentModel}
								<!-- Show unavailable model as first option (disabled) -->
								<button
									type="button"
									class="flex w-full cursor-not-allowed items-center bg-neutral-400/10 p-2 text-left text-sm text-neutral-500"
									role="option"
									aria-selected="true"
									aria-disabled="true"
									disabled
								>
									<ModelId modelId={currentModel} class="flex-1" hideQuantization />

									<span class="ml-2 text-xs whitespace-nowrap opacity-70">(not available)</span>
								</button>
							{/if}

							{#if ms.filteredOptions.length === 0}
								<p class="px-4 py-3 text-sm text-muted-foreground">No models found.</p>
							{/if}

							{#snippet modelOption(item: ModelItem, hideOrgName: boolean)}
								{@const { option, flatIndex } = item}
								{@const isSelected = currentModel === option.model || ms.activeId === option.id}
								{@const isHighlighted = flatIndex === highlightedIndex}
								{@const isFav = ms.isFavorite(option.model)}

								<ModelsSelectorOption
									{option}
									{isSelected}
									{isHighlighted}
									{isFav}
									{hideOrgName}
									onSelect={ms.handleSelect}
									onInfoClick={ms.handleInfoClick}
									onMouseEnter={() => (highlightedIndex = flatIndex)}
									onKeyDown={(event) => {
										if (event.key === KeyboardKey.ENTER || event.key === KeyboardKey.SPACE) {
											event.preventDefault();
											ms.handleSelect(option.id);
										}
									}}
								/>
							{/snippet}

							<ModelsSelectorList
								groups={ms.groupedFilteredOptions}
								{currentModel}
								activeId={ms.activeId}
								sectionHeaderClass="my-1.5 px-2 py-2 text-[13px] font-semibold text-muted-foreground/70 select-none"
								onSelect={ms.handleSelect}
								onInfoClick={ms.handleInfoClick}
								renderOption={modelOption}
							/>
						</div>
					</DropdownMenuSearchable>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<!-- prevent another nested button element -->
					{#snippet child({ props })}
						<button
							{...props}
							class={[
								`inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-background px-1.5 py-1 text-xs shadow-sm transition hover:bg-muted-foreground/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-muted-foreground/15 dark:text-secondary-foreground`,
								!ms.isCurrentModelInCache
									? 'bg-neutral-400/10 !text-neutral-500 hover:bg-neutral-400/20 hover:text-neutral-500'
									: forceForegroundText
										? 'text-foreground'
										: ms.isHighlightedCurrentModelActive
											? 'text-foreground'
											: 'text-foreground',
								isOpen && 'text-foreground'
							]}
							style="max-width: min(calc(100cqw - 6.5rem), 32rem)"
							onclick={() => ms.handleOpenChange(true)}
							disabled={disabled || ms.updating}
						>
							<Package class="h-3.5 w-3.5 shrink-0" />

							{#if selectedOption}
								<ModelId
									modelId={selectedOption.model}
									class="min-w-0 overflow-hidden"
									hideOrgName={false}
									hideQuantization
								/>
							{/if}

							{#if ms.updating}
								<Loader2 class="h-3 w-3.5 shrink-0 animate-spin" />
							{/if}
						</button>
					{/snippet}
				</Tooltip.Trigger>

				{#if selectedOption}
					<Tooltip.Content>
						<p class="font-mono">{selectedOption.model}</p>
					</Tooltip.Content>
				{/if}
			</Tooltip.Root>
		{/if}
	{/if}
</div>

{#if ms.showModelDialog}
	<DialogModelInformation
		open={ms.showModelDialog}
		onOpenChange={(v) => ms.setShowModelDialog(v)}
		modelId={ms.infoModelId}
	/>
{/if}
