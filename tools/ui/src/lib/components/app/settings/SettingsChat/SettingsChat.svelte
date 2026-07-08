<script lang="ts">
	import {
		SettingsChatDesktopSidebar,
		SettingsChatFields,
		SettingsChatImportExportTab,
		SettingsChatMobileHeader,
		SettingsChatToolsTab,
		SettingsChatEchoTab,
		SettingsLatticaTab,
		SettingsTunnelTab,
		SettingsFooter,
		SettingsMcpServers
	} from '$lib/components/app/settings';
	import ModelsScreen from '$lib/components/app/models/ModelsScreen.svelte';
	import TelemetryScreen from '$lib/components/app/telemetry/TelemetryScreen.svelte';
	import TerminalScreen from '$lib/components/app/terminal/TerminalScreen.svelte';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import {
		NUMERIC_FIELDS,
		POSITIVE_INTEGER_FIELDS,
		SETTINGS_CHAT_SECTIONS,
		SETTINGS_SECTION_TITLES,
		type SettingsSection
	} from '$lib/constants';
	import { RouterService } from '$lib/services/router.service';
	import { applyThemeMode } from '$lib/stores/settings.svelte';
	import { ColorMode } from '$lib/enums/ui.enums';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { RefreshCw } from '@lucide/svelte';
	import { page } from '$app/state';
	import { setChatSettingsConfigContext } from '$lib/contexts';
	import { settingsReferrer } from '$lib/stores/settings-referrer.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	interface Props {
		initialSection?: string;
		getSectionHref?: (section: SettingsSection) => string;
	}

	let { initialSection, getSectionHref }: Props = $props();

	let activeSlug = $derived(
		initialSection ?? (page.params as Record<string, string | undefined>).section ?? 'general'
	);

	let currentSection = $derived(
		SETTINGS_CHAT_SECTIONS.find((section) => section.slug === activeSlug) ||
			SETTINGS_CHAT_SECTIONS[0]
	);

	let localConfig: SettingsConfigType = $state({ ...config() });

	let isFullWidthSection = $derived(
		[
			SETTINGS_SECTION_TITLES.MODELS,
			SETTINGS_SECTION_TITLES.TELEMETRY,
			SETTINGS_SECTION_TITLES.TERMINAL,
			SETTINGS_SECTION_TITLES.MCP
		].includes(currentSection.title)
	);

	let mobileHeader: { updateCarousel: () => void } | undefined;

	let fetchInitiated = false;

	$effect(() => {
		if (isRouterMode() && currentSection.fields && !fetchInitiated) {
			fetchInitiated = true;

			void modelsStore
				.fetch()
				.then(() => modelsStore.fetchRouterModels())
				.then(() => modelsStore.fetchModalitiesForLoadedModels())
				.then(() => modelsStore.ensureFirstModelSelected());
		}
	});

	function handleThemeChange(newTheme: string) {
		localConfig.theme = newTheme;
		applyThemeMode(newTheme as ColorMode);
	}

	function handleConfigChange(key: string, value: string | boolean) {
		localConfig[key] = value;
	}

	function handleReset() {
		localConfig = { ...config() };
		applyThemeMode(localConfig.theme as ColorMode);
		mobileHeader?.updateCarousel();
	}

	function handleSave() {
		if (
			localConfig.customJson &&
			typeof localConfig.customJson === 'string' &&
			localConfig.customJson.trim()
		) {
			try {
				JSON.parse(localConfig.customJson);
			} catch (error) {
				alert('Invalid JSON in custom parameters. Please check the format and try again.');
				console.error(error);
				return;
			}
		}

		const processedConfig = { ...localConfig };

		for (const field of NUMERIC_FIELDS) {
			if (processedConfig[field] !== undefined && processedConfig[field] !== '') {
				const numValue = Number(processedConfig[field]);
				if (!isNaN(numValue)) {
					if ((POSITIVE_INTEGER_FIELDS as readonly string[]).includes(field)) {
						processedConfig[field] = Math.max(1, Math.round(numValue));
					} else {
						processedConfig[field] = numValue;
					}
				} else {
					alert(`Invalid numeric value for ${field}. Please enter a valid number.`);
					return;
				}
			}
		}

		settingsStore.updateMultipleConfig(processedConfig);
		goto(settingsReferrer.url);
	}

	export function reset() {
		localConfig = { ...config() };
	}

	setChatSettingsConfigContext({
		get localConfig() {
			return localConfig;
		},
		handleConfigChange,
		handleThemeChange
	});
</script>

<div class="mx-auto flex h-full w-full flex-col md:pl-8" in:fade={{ duration: 150 }}>
	<div class="flex flex-1 flex-col gap-4 md:flex-row">
		<SettingsChatDesktopSidebar
			sections={SETTINGS_CHAT_SECTIONS}
			isActive={(section: SettingsSection) => section.slug === activeSlug}
			getHref={getSectionHref ??
				((section: SettingsSection) => RouterService.settings(section.slug))}
		/>

		<SettingsChatMobileHeader
			sections={SETTINGS_CHAT_SECTIONS}
			isActive={(section: SettingsSection) => section.slug === activeSlug}
			getHref={getSectionHref ??
				((section: SettingsSection) => RouterService.settings(section.slug))}
			bind:this={mobileHeader}
		/>

		<div class="mx-auto {isFullWidthSection ? 'w-full max-w-[1920px]' : 'max-w-3xl'} flex-1">
			<div class="{isFullWidthSection ? '' : 'space-y-6 p-4 md:p-6 md:pt-8'}">
				<div class="grid h-full">
					{#if currentSection.title === SETTINGS_SECTION_TITLES.TOOLS}
						<SettingsChatToolsTab />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.IMPORT_EXPORT}
						<SettingsChatImportExportTab />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.ECHO}
						<SettingsChatEchoTab />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.MESH}
						<SettingsLatticaTab />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.TUNNEL}
						<SettingsTunnelTab />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.MODELS}
						<ModelsScreen />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.TELEMETRY}
						<TelemetryScreen />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.TERMINAL}
						<TerminalScreen />
					{:else if currentSection.title === SETTINGS_SECTION_TITLES.MCP}
						<SettingsMcpServers class="mx-auto w-full px-4 pb-4 pt-2 md:px-8 md:pb-8 md:pt-2" />
					{:else if currentSection.fields}
						<div class="space-y-6">
							<SettingsChatFields
								fields={currentSection.fields}
								{localConfig}
								onConfigChange={handleConfigChange}
								onThemeChange={handleThemeChange}
							/>

							{#if currentSection.title === SETTINGS_SECTION_TITLES.GENERAL}
								<div class="flex justify-end">
									<Button variant="outline" onclick={() => window.location.reload()}>
										<RefreshCw class="h-3 w-3" />
										Reload app
									</Button>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				{#if !isFullWidthSection}
					<div class="mt-8 border-t border-border/30 pt-6">
						<p class="text-xs text-muted-foreground">Settings are saved in browser's localStorage</p>
					</div>
				{/if}
			</div>

			{#if !isFullWidthSection}
				<SettingsFooter onReset={handleReset} onSave={handleSave} />
			{/if}
		</div>
	</div>
</div>
