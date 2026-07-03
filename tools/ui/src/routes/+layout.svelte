<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';

	import { SidebarNavigation, DialogConversationTitleUpdate } from '$lib/components/app';
	import { PwaMetaTags, PwaRefreshAlert } from '$lib/components/pwa';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';

	import CompanionOverlay from '$lib/components/app/companion/CompanionOverlay.svelte';
	import { companionStore } from '$lib/services/companion.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { isRouterMode, serverStore } from '$lib/stores/server.svelte';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { ROUTES } from '$lib/constants/routes';
	import { RouterService } from '$lib/services/router.service';
	import { Toaster } from 'svelte-sonner';
	import { fade } from 'svelte/transition';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { TOOLTIP_DELAY_DURATION } from '$lib/constants';
	import { FAVICON_PATHS, FAVICON_SELECTORS } from '$lib/constants/pwa';
	import { useKeyboardShortcuts } from '$lib/hooks/use-keyboard-shortcuts.svelte';
	import { usePwa } from '$lib/hooks/use-pwa.svelte';
	import { conversations } from '$lib/stores/conversations.svelte';
	import { isMobile } from '$lib/stores/viewport.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { sessionTelemetryStore } from '$lib/stores/session-telemetry.svelte';
	import { buildInfoStore } from '$lib/stores/build-info.svelte';

	import { SETTINGS_KEYS } from '$lib/constants';
	import { Files, Activity, Terminal, Settings, Rss, Bot } from '@lucide/svelte';
	import McpLogo from '$lib/components/app/mcp/McpLogo.svelte';

	if (browser && window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
		const originalFetch = window.fetch;
		window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
			let urlStr = '';
			if (typeof input === 'string') {
				urlStr = input;
			} else if (input instanceof URL) {
				urlStr = input.toString();
			} else if (input && typeof input === 'object' && 'url' in input) {
				urlStr = input.url;
			}

			if (
				urlStr &&
				!urlStr.startsWith('http://') &&
				!urlStr.startsWith('https://') &&
				!urlStr.startsWith('//')
			) {
				const dummyBase = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
				const resolvedUrl = new URL(urlStr, dummyBase);
				let pathname = resolvedUrl.pathname;

				if (pathname.endsWith('/props')) pathname = '/props';
				else if (pathname.endsWith('/slots')) pathname = '/slots';
				else if (pathname.endsWith('/health')) pathname = '/health';

				let llamaPort = window.llamaPort || '8080';
				let orchestratorPort = window.orchestratorPort || '8000';
				if (!window.llamaPort && window.electronAPI && window.electronAPI.getPorts) {
					try {
						const ports = await window.electronAPI.getPorts();
						llamaPort = ports.llamaPort;
						orchestratorPort = ports.orchestratorPort;
						window.llamaPort = llamaPort;
						window.orchestratorPort = orchestratorPort;
					} catch (e) {
						console.error('Failed to get dynamic ports via IPC:', e);
					}
				}

				let targetOrigin = `http://127.0.0.1:${llamaPort}`;
				if (
					pathname.startsWith('/api') ||
					pathname.startsWith('/telemetry') ||
					pathname.startsWith('/metrics')
				) {
					targetOrigin = `http://127.0.0.1:${orchestratorPort}`;
				}

				const newUrl = targetOrigin + pathname + resolvedUrl.search;
				if (typeof input === 'string') {
					input = newUrl;
				} else if (input instanceof URL) {
					input = new URL(newUrl);
				} else {
					input = new Request(newUrl, input);
				}
			}
			return originalFetch.call(window, input, init);
		};
	}

	let { children } = $props();
	let innerHeight = $state<number | undefined>();
	let innerWidth = $state(browser ? window.innerWidth : 0);

	let chatSidebar:
		| {
				activateSearchMode?: () => void;
				editActiveConversation?: () => void;
		  }
		| undefined = $state();

	let showBuildVersion = $derived(config()[SETTINGS_KEYS.SHOW_BUILD_VERSION] as boolean);

	let titleUpdateDialogOpen = $state(false);
	let titleUpdateCurrentTitle = $state('');
	let titleUpdateNewTitle = $state('');
	let titleUpdateResolve: ((value: boolean) => void) | null = null;

	// Keep the hook object intact: destructuring needRefreshByStorage reads the getter once and freezes it
	const pwa = usePwa();
	const { needRefresh, updateServiceWorker } = pwa;

	function updateFavicon() {
		const dark = theme.isSystemDark;

		let icoLink = document.querySelector(FAVICON_SELECTORS.ICO_48X48) as HTMLLinkElement | null;
		if (icoLink) {
			icoLink.href = dark ? FAVICON_PATHS.ICO_DARK : FAVICON_PATHS.ICO_LIGHT;
		}

		let svgLink = document.querySelector(FAVICON_SELECTORS.SVG_ANY) as HTMLLinkElement | null;
		if (svgLink) {
			svgLink.href = dark ? FAVICON_PATHS.SVG_DARK : FAVICON_PATHS.SVG_LIGHT;
		}
	}

	function navigateToConversation(direction: -1 | 1) {
		const allConvs = conversations();

		if (allConvs.length === 0) return;

		const currentId = page.params.id;

		if (!currentId) {
			goto(RouterService.chat(allConvs[direction === 1 ? 0 : allConvs.length - 1].id));

			return;
		}

		const idx = allConvs.findIndex((c) => c.id === currentId);

		if (idx === -1) return;

		const targetIdx = idx + direction;

		if (targetIdx >= 0 && targetIdx < allConvs.length) {
			goto(RouterService.chat(allConvs[targetIdx].id));
		} else {
			goto(ROUTES.NEW_CHAT);
		}
	}

	// Global keyboard shortcuts
	const { handleKeydown } = useKeyboardShortcuts({
		editActiveConversation: () => chatSidebar?.editActiveConversation?.(),
		navigateToPrevConversation: () => navigateToConversation(-1),
		navigateToNextConversation: () => navigateToConversation(1)
	});

	function checkApiKey() {
		const apiKey = config().apiKey;

		// No API key configured — server doesn't require auth, no need to validate.
		// This mirrors the early return in validateApiKey() to avoid redundant /props requests.
		if (!apiKey || apiKey.trim() === '') {
			return;
		}

		untrack(() => {
			if (
				(page.route.id === '/(chat)' || page.route.id === '/(chat)/chat/[id]') &&
				page.status !== 401 &&
				page.status !== 403
			) {
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey.trim()}`
				};

				fetch(`${base}/props`, { headers })
					.then((response) => {
						if (response.status === 401 || response.status === 403) {
							window.location.reload();
						}
					})
					.catch((e) => {
						console.error('Error checking API key:', e);
					});
			}
		});
	}

	function handleTitleUpdateCancel() {
		titleUpdateDialogOpen = false;

		if (titleUpdateResolve) {
			titleUpdateResolve(false);
			titleUpdateResolve = null;
		}
	}

	function handleTitleUpdateConfirm() {
		titleUpdateDialogOpen = false;

		if (titleUpdateResolve) {
			titleUpdateResolve(true);
			titleUpdateResolve = null;
		}
	}

	onMount(() => {
		updateFavicon();
		
		if (window.electronAPI) {
			if (window.electronAPI.onUpdateReady) {
				window.electronAPI.onUpdateReady(() => {
					import('svelte-sonner').then(({ toast }) => {
						toast.success('Update downloaded', {
							description: 'A new version of LLaMA Pro is ready to install.',
							duration: 100000,
							action: {
								label: 'Restart & Install',
								onClick: () => window.electronAPI.quitAndInstall()
							}
						});
					});
				});
			}
			if (window.electronAPI.onUpdateError) {
				window.electronAPI.onUpdateError((error) => {
					import('svelte-sonner').then(({ toast }) => {
						toast.error('Update failed', {
							description: 'Could not download the latest update. Check your connection.',
							duration: 5000
						});
						console.error('Auto-updater error:', error);
					});
				});
			}
		}
	});

	$effect(() => {
		void theme.isSystemDark;

		updateFavicon();
	});

	// Initialize server properties on app load (run once)
	$effect(() => {
		// Only fetch if we don't already have props
		if (!serverStore.props) {
			untrack(() => {
				serverStore.fetch();
			});
		}
	});

	// Sync settings when server props are loaded
	$effect(() => {
		const serverProps = serverStore.props;

		if (serverProps) {
			untrack(() => {
				settingsStore.syncWithServerDefaults();
			});
		}
	});

	// Inject custom CSS at runtime through an action on the head style node
	// textContent keeps the value as text, never parsed as HTML
	function customCss(node: HTMLStyleElement) {
		$effect(() => {
			node.textContent = (config().customCss as string | undefined) ?? '';
		});
	}

	// Fetch router models when in router mode (for status and modalities)
	// Wait for models to be loaded first, run only once
	let routerModelsFetched = false;

	$effect(() => {
		const isRouter = isRouterMode();
		const modelsCount = modelsStore.models.length;

		// Only fetch router models once when we have models loaded and in router mode
		if (isRouter && modelsCount > 0 && !routerModelsFetched) {
			routerModelsFetched = true;

			untrack(() => {
				modelsStore.fetchRouterModels();
			});
		}
	});

	// Live model status and load progress via the /models/sse feed (router mode)
	$effect(() => {
		if (!browser) return;
		if (!isRouterMode()) return;

		untrack(() => {
			modelsStore.subscribeStatus();
		});

		return () => {
			modelsStore.unsubscribeStatus();
		};
	});

	// Background MCP server health checks on app load
	// Fetch enabled servers from settings and run health checks in background
	$effect(() => {
		if (!browser) return;

		const mcpServers = mcpStore.getServers();

		// Only run health checks if we have enabled servers with URLs
		const enabledServers = mcpServers.filter((s) => s.enabled && s.url.trim());

		if (enabledServers.length > 0) {
			untrack(() => {
				// Run health checks in background (don't await)
				mcpStore.runHealthChecksForServers(enabledServers, false).catch((error) => {
					console.warn('[layout] MCP health checks failed:', error);
				});
			});
		}
	});

	// Monitor API key changes and redirect to error page if removed or changed when required
	$effect(() => {
		checkApiKey();
	});

	// Set up title update confirmation callback
	$effect(() => {
		conversationsStore.setTitleUpdateConfirmationCallback(
			async (currentTitle: string, newTitle: string) => {
				return new Promise<boolean>((resolve) => {
					titleUpdateCurrentTitle = currentTitle;
					titleUpdateNewTitle = newTitle;
					titleUpdateResolve = resolve;
					titleUpdateDialogOpen = true;
				});
			}
		);
	});

	const activeSubmenu = $derived.by(() => {
		const routeId = page.route.id || '';
		if (routeId.startsWith('/mcp-servers')) {
			return { title: 'MCP Servers', icon: McpLogo };
		}
		if (routeId.startsWith('/news')) {
			return { title: 'News & Discoveries', icon: Rss };
		}
		if (routeId.startsWith('/models')) {
			return { title: 'Model Management', icon: Files };
		}
		if (routeId.startsWith('/telemetry')) {
			return { title: 'Telemetry', icon: Activity };
		}
		if (routeId.startsWith('/terminal')) {
			return { title: 'Live Terminal', icon: Terminal };
		}
		if (routeId.startsWith('/settings')) {
			return { title: 'Settings', icon: Settings };
		}
		return null;
	});
</script>

<svelte:head>
	<title>LLaMA Pro</title>

	{#if pwaAssetsHead.themeColor}
		<meta name="theme-color" content={pwaAssetsHead.themeColor.content} />
	{/if}

	{#if config().customCss}
		<style use:customCss></style>
	{/if}

	{#each pwaAssetsHead.links as link (link.href)}
		<link {...link} />
	{/each}

	<PwaMetaTags />
</svelte:head>

<svelte:window onkeydown={handleKeydown} bind:innerHeight bind:innerWidth />

<Tooltip.Provider delayDuration={TOOLTIP_DELAY_DURATION}>
	<div class="flex flex-col md:flex-row h-screen w-full overflow-hidden">
		<SidebarNavigation
			onSearchClick={() => {
				if (isMobile.current) {
					goto(ROUTES.SEARCH);
				} else if (chatSidebar?.activateSearchMode) {
					chatSidebar.activateSearchMode();
				}
			}}
		/>

		<div class="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
			<!-- Global Locked Header Area (Sticky) -->
			<div
				class="p-2 pb-1 sticky top-0 z-50 bg-background/95 backdrop-blur-md flex flex-col gap-1.5"
			>
				<div
					class="bg-card border border-border rounded-xl shadow-sm px-4 py-1.5 flex items-center justify-between min-h-10 md:min-h-12"
				>
					<!-- Left: Title Banner -->
					<div class="flex items-center gap-2">
						<div class="flex items-center">
							<img
								src={`${base}/header-logo.png`}
								alt="LLaMA Pro"
								class="h-6 md:h-7 object-contain dark:invert"
							/>
						</div>
						<div class="h-3 w-px bg-border"></div>
						<div class="flex flex-col items-start">
							<span class="text-[9px] md:text-[10px] text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded-md leading-tight">
								Distributed Ai Engine 2.0.4
							</span>
							<span class="text-[8px] text-muted-foreground px-2 pt-0.5 opacity-70">
								&nbsp;&nbsp;by <a href="http://www.dynamo.llc" target="_blank" rel="noopener noreferrer" class="hover:text-primary transition-colors cursor-pointer underline underline-offset-2">Dynamo.llc</a>
							</span>
						</div>
					</div>

					<!-- Center: Scrolling News Feed -->
					<div
						class="flex-1 mx-3 md:mx-6 overflow-hidden relative bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg h-6 flex items-center font-pixel"
					>
						<div class="w-full overflow-hidden relative h-full flex items-center font-pixel">
							<div
								class="marquee-content text-zinc-700 dark:text-zinc-300 font-pixel whitespace-nowrap text-[9px] md:text-[10px]"
							>
								✦ Distributed Ai Engine Feature: Local LoRA Training to fine-tune models directly on your hardware ✦ Feature: Remote Access with Cloudflare Tunnels and Local Network Discovery ✦ Feature: Compute Pool using decentralized peer-to-peer networking ✦ Tip: Extend capabilities with custom MCP server integrations ✦ Feature: Agent Swarms using a coordinated assembly of autonomous agents ✦ Tip: Download and run the newest models from Hugging Face ✦ Feature: Premium Themes like Neon City and Hacker Console with glassmorphism ✦ Feature: Run fully local, private AI models on consumer hardware with ggml quantization ✦ Feature: Real-time Telemetry & Advanced prompt engineering controls ✦
							</div>
						</div>
					</div>

					<!-- Right: Token Speed Telemetry -->
					<div class="flex items-center gap-2">
						<div
							class="bg-muted/85 border border-border/70 rounded-md px-2 py-0.5 flex items-center gap-1.5 shadow-xs text-[9px] md:text-[10px] font-mono"
						>
							<span class="text-muted-foreground uppercase text-[8px] md:text-[9px] font-semibold"
								>Speed</span
							>
							<span class="font-bold text-foreground"
								>{sessionTelemetryStore.latestSpeed > 0
									? sessionTelemetryStore.latestSpeed.toFixed(1) + ' t/s'
									: '---'}</span
							>
							<div class="h-2.5 w-px bg-border mx-0.5"></div>
							<span class="text-muted-foreground uppercase text-[8px] md:text-[9px] font-semibold"
								>Avg</span
							>
							<span class="font-bold text-pink-500 dark:text-pink-400"
								>{sessionTelemetryStore.getAverageSpeed() > 0
									? sessionTelemetryStore.getAverageSpeed().toFixed(1) + ' t/s'
									: '---'}</span
							>
						</div>
					</div>
				</div>

				<!-- Global Locked Submenu Header Area (Sticky, locked directly below title bar) -->
				{#if activeSubmenu}
					<div
						class="w-full border-b border-border/50 py-1 flex items-center justify-center bg-card rounded-lg shadow-xs"
					>
						<div class="flex items-center gap-2 text-foreground font-sans">
							{#if activeSubmenu.icon}
								{@const Icon = activeSubmenu.icon}
								<Icon class="h-4 w-4 text-muted-foreground" />
							{/if}
							<span class="text-xs md:text-sm font-semibold tracking-wider uppercase">
								{activeSubmenu.title}
							</span>
						</div>
					</div>
				{/if}
			</div>

			<!-- Main Page Content -->
			<div class="flex-1 min-h-0 main-content-scroll grid relative">
				{#key page.url.hash.split('?')[0] || 'home'}
					<div 
						class="col-start-1 row-start-1 w-full h-full overflow-y-auto"
						in:fade={{ duration: 150, delay: 150 }} 
						out:fade={{ duration: 150 }}
					>
						{@render children?.()}
					</div>
				{/key}
			</div>
		</div>
	</div>

	<ModeWatcher />

	<Toaster richColors />

	<DialogConversationTitleUpdate
		bind:open={titleUpdateDialogOpen}
		currentTitle={titleUpdateCurrentTitle}
		newTitle={titleUpdateNewTitle}
		onConfirm={handleTitleUpdateConfirm}
		onCancel={handleTitleUpdateCancel}
	/>
</Tooltip.Provider>

<CompanionOverlay />

<!-- Floating J.A.R.V.I.S. Orb Toggle -->
{#if !companionStore.isOpen}
	<button 
		class="fixed bottom-4 right-4 z-[9900] group flex items-center justify-center w-14 h-14 rounded-full bg-black hover:bg-black/80 border border-primary/30 shadow-[0_0_20px_rgba(0,210,255,0.2)] hover:shadow-[0_0_30px_rgba(0,210,255,0.4)] transition-all duration-300 hover:scale-105 active:scale-95"
		onclick={() => companionStore.open()}
		aria-label="Summon Companion"
	>
		<div class="absolute inset-0 rounded-full bg-primary/20 blur-md group-hover:bg-primary/40 transition-colors"></div>
		<div class="absolute inset-0 rounded-full bg-gradient-to-br from-white/20 to-transparent"></div>
		<Bot class="w-6 h-6 text-primary relative z-10 animate-pulse" style="animation-duration: 3s;" />
	</button>
{/if}

<!-- PWA update prompt + version -->
<div class="fixed right-4 bottom-4 z-9999 flex flex-col items-end gap-1">
	{#if showBuildVersion && buildInfoStore.value}
		<span class="text-[10px] tabular-nums text-muted-foreground">{buildInfoStore.value}</span>
	{/if}

	<PwaRefreshAlert
		needRefresh={$needRefresh || pwa.needRefreshByStorage}
		forceReload={pwa.needRefreshByStorage}
		{updateServiceWorker}
	/>
</div>

<style>
	@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');

	.font-pixel {
		font-family: 'VT323', monospace;
		font-size: 1.15rem;
		image-rendering: pixelated;
	}

	.marquee-content {
		display: inline-block;
		animation: scroll-right-to-left 120s linear infinite;
	}

	@keyframes scroll-right-to-left {
		0% {
			transform: translateX(100%);
		}
		100% {
			transform: translateX(-100%);
		}
	}
</style>
