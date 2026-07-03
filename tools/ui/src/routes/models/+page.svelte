<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		Download,
		Folder,
		SlidersHorizontal,
		RefreshCw,
		Flame,
		Heart,
		X,
		Loader2,
		TrendingUp,
		Terminal,
		CheckCircle2,
		ArrowUpDown,
		Zap,
		Box,
		Files,
		Settings2,
		Server,
		Network,
		Cpu,
		Search
	} from '@lucide/svelte';

	import SwarmDialog from '$lib/components/app/SwarmDialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { serverStore } from '$lib/stores/server.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { getAuthHeaders } from '$lib/utils/api-headers';
	import { ServerModelStatus } from '$lib/enums';
	import { ActionIconCopyToClipboard, MarkdownContent, RpcDialog } from '$lib/components/app';

	let showRpcDialog = $state(false);

	// Active Tab
	let activeTab = $state('local');

	// Cache Location
	let cacheDir = $state('');
	let savingCacheDir = $state(false);

	// Custom HF Download
	let customDownloadUrl = $state('');
	let downloadingCustom = $state(false);

	// Active Downloads Map (SSE progress)
	let downloadProgress = $state(
		new Map<string, { done: number; total: number; startTime: number; speed: number }>()
	);
	let downloadAbort: AbortController | null = null;

	// Trending Models & Filters
	let limit = $state(50);
	let selectedList = $state('trending');
	let searchQuery = $state('');
	let debouncedSearchQuery = $state('');
	let searchTimeout: any;

	let trendingModels = $state<any[]>([]);
	let loadingTrending = $state(false);
	let showFilters = $state(false);
	let baseOnly = $state(false);
	let showInferenceOnly = $state(false);
	let sortDropdownOpen = $state(false);
	const sortOptions = [
		{ value: 'trending', label: 'Trending' },
		{ value: 'likes', label: 'Most Likes' },
		{ value: 'downloads', label: 'Most Downloads' },
		{ value: 'lastModified', label: 'Recently Updated' },
		{ value: 'uncensored', label: 'Uncensored' },
		{ value: 'tooluse', label: 'Tool Use' },
		{ value: 'thinking', label: 'Thinking' },
		{ value: 'coding', label: 'Coding' },
		{ value: 'experimental', label: 'Experimental / Betas' }
	];

	// IDE Auto Update
	let updatingIde = $state(false);

	// Model Details Cache for sizes
	let modelDetailsMap = new SvelteMap<string, any>();
	const detailsInflight = new Set<string>();

	// Selected models for 6 slots
	let selectedModelsForSlots = $state(['', '', '', '', '', '']);

	// Swarm Config State
	let showSwarmConfig = $state(false);
	let swarmConfigs = $state<any[]>([]);
	let activeSwarmConfigId = $state<string>('');

	async function loadSwarmConfigs() {
		try {
			const res = await fetch('http://127.0.0.1:8000/v1/swarm/config');
			if (res.ok) {
				const data = await res.json();
				swarmConfigs = data.configs || [];
				activeSwarmConfigId = data.active_config_id || '';
			}
		} catch (e) {
			console.error('Failed to load Swarm configs list', e);
		}
	}

	async function handleSwarmChange(event: Event) {
		const selectedId = (event.target as HTMLSelectElement).value;
		try {
			const res = await fetch('http://127.0.0.1:8000/v1/swarm/config/active', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ active_config_id: selectedId || null })
			});
			if (res.ok) {
				activeSwarmConfigId = selectedId;
				if (selectedId) {
					const conf = swarmConfigs.find((c) => c.id === selectedId);
					if (conf) {
						toast.success(`Activated Swarm: ${conf.name}`);

						// Propagate active model slots
						const localModels = conf.nodes
							.filter((n: any) => n.sourceType === 'local' && n.modelName)
							.map((n: any) => n.modelName);

						if (localModels.length > 0) {
							toast.info(`Propagating ${localModels.length} local model(s) to active slots...`);
							for (const modelId of localModels) {
								if (!modelsStore.loadedModelIds.includes(modelId)) {
									try {
										await modelsStore.loadModel(modelId);
									} catch (err) {
										console.error(`Failed to load ${modelId}`, err);
									}
								}
							}
						}
					}
				} else {
					toast.success('Swarm deactivated');
				}

				// Automatically update the IDE
				await handleUpdateIde();
			} else {
				toast.error('Failed to change active Swarm');
			}
		} catch (e) {
			toast.error('Error connecting to orchestrator.');
		}
	}

	let showGraphConfig = $state(false);
	let mermaidString = $state('');

	// Online Models State
	const SUPPORTED_PROVIDERS = [
		{ id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api' },
		{ id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com' },
		{
			id: 'google',
			name: 'Google AI',
			base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/'
		},
		{ id: 'zai', name: 'Z.Ai', base_url: 'https://api.z.ai/api/paas/v4/' },
		{ id: 'groq', name: 'Groq', base_url: 'https://api.groq.com/openai' },
		{ id: 'together', name: 'Together AI', base_url: 'https://api.together.xyz' },
		{ id: 'mistral', name: 'Mistral', base_url: 'https://api.mistral.ai' },
		{ id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com' },
		{ id: 'fireworks', name: 'Fireworks AI', base_url: 'https://api.fireworks.ai/inference' },
		{ id: 'anyscale', name: 'Anyscale', base_url: 'https://api.endpoints.anyscale.com' },
		{ id: 'xai', name: 'xAI (Grok)', base_url: 'https://api.x.ai' },
		{ id: 'hyperbolic', name: 'Hyperbolic', base_url: 'https://api.hyperbolic.xyz' },
		{ id: 'sambanova', name: 'SambaNova', base_url: 'https://api.sambanova.ai' }
	];

	let providerKeys = $state<Record<string, string[]>>({});
	let savingProviderId = $state<string | null>(null);
	let onlineModels = $state<any[]>([]);
	let loadingOnlineModels = $state(false);
	let selectedOnlineProviderId = $state(SUPPORTED_PROVIDERS[0].id);

	async function fetchProviderModels() {
		loadingOnlineModels = true;
		try {
			const res = await fetch(`${base}/api/providers/models`);
			if (res.ok) {
				const data = await res.json();
				onlineModels = data.data || [];
			}
		} catch (e) {
			console.error(e);
		} finally {
			loadingOnlineModels = false;
		}
	}

	async function saveProviderKey(providerId: string, name: string, baseUrl: string) {
		const keys = (providerKeys[providerId] || []).filter((k) => k.trim() !== '');
		savingProviderId = providerId;
		try {
			const res = await fetch(`${base}/api/providers`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
				body: JSON.stringify({
					id: providerId,
					name: name,
					base_url: baseUrl,
					api_keys: keys.map((k) => k.trim())
				})
			});
			if (res.ok) {
				toast.success(`${name} API keys saved successfully!`);
				await fetchProviderModels();
			} else {
				toast.error('Failed to save API keys');
			}
		} catch (e: any) {
			toast.error(`Error: ${e.message}`);
		} finally {
			savingProviderId = null;
		}
	}

	let testingProviderId = $state<string | null>(null);

	async function testProviderKeys(providerId: string) {
		testingProviderId = providerId;
		try {
			const res = await fetch(`${base}/api/providers/${providerId}/test`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				if (data.error) {
					toast.error(`Test failed: ${data.error}`);
				} else if (data.results) {
					let allValid = true;
					data.results.forEach((r: any, idx: number) => {
						if (r.valid) {
							toast.success(`Key ${idx + 1}: Valid`);
						} else {
							toast.error(`Key ${idx + 1}: Invalid (${r.error})`);
							allValid = false;
						}
					});
					if (allValid && data.results.length > 0) {
						toast.success(`All keys for this provider are valid!`);
					}
				}
			} else {
				toast.error('Failed to test API keys');
			}
		} catch (e: any) {
			toast.error(`Error: ${e.message}`);
		} finally {
			testingProviderId = null;
		}
	}

	onMount(() => {
		for (const p of SUPPORTED_PROVIDERS) {
			if (!providerKeys[p.id]) providerKeys[p.id] = [''];
		}
		fetch(`${base}/api/providers`)
			.then((r) => r.json())
			.then((data) => {
				let hasAnyKey = false;
				if (data.providers) {
					for (const p of SUPPORTED_PROVIDERS) {
						if (data.providers[p.id]) {
							providerKeys[p.id] = data.providers[p.id].api_keys || [''];
							if (providerKeys[p.id].length === 0) providerKeys[p.id] = [''];
							if (providerKeys[p.id].some((k) => k && k !== '***')) {
								hasAnyKey = true;
							}
						}
					}
				}
				if (hasAnyKey) fetchProviderModels();
			})
			.catch((e) => console.error(e));
	});

	async function fetchGraph() {
		try {
			const res = await fetch('http://127.0.0.1:8000/v1/swarm/graph');
			if (res.ok) {
				const data = await res.json();
				mermaidString = data.mermaid;
				showGraphConfig = true;
			} else {
				toast.error('Failed to generate graph. Check orchestrator logs.');
			}
		} catch (e) {
			console.error('Failed to fetch graph', e);
			toast.error('Failed to connect to the orchestrator.');
		}
	}

	// Reactive derived values
	let localModels = $derived(
		modelsStore.routerModels.filter((m) => m.status.value !== ServerModelStatus.DOWNLOADING)
	);

	let activeDownloadsList = $derived.by(() => {
		const list: { id: string; done: number; total: number; speed: number; startTime: number }[] =
			[];
		// Add items from SSE progress map
		for (const [id, progress] of downloadProgress.entries()) {
			list.push({ id, ...progress });
		}
		// Also find any server router models showing downloading state
		for (const m of modelsStore.routerModels) {
			if (m.status.value === ServerModelStatus.DOWNLOADING && !downloadProgress.has(m.id)) {
				list.push({ id: m.id, done: 0, total: 0, speed: 0, startTime: Date.now() });
			}
		}
		return list;
	});

	function isBaseModel(model: any): boolean {
		const idLower = model.id.toLowerCase();
		const details = modelDetailsMap.get(model.id);
		const detailsTags = details?.tags || details?.cardData?.tags || [];
		const modelTags = [...(model.tags || []), ...detailsTags];

		if (modelTags.some((t: string) => t.toLowerCase() === 'base_model')) {
			return true;
		}

		const fineTuneKeywords = [
			'instruct',
			'chat',
			'it',
			'rlhf',
			'dpo',
			'sft',
			'tuned',
			'finetuned',
			'align',
			'agent',
			'cot',
			'thinking',
			'reasoning'
		];
		const hasFineTuneKeyword = fineTuneKeywords.some((keyword) => {
			if (idLower.includes(keyword)) return true;
			return modelTags.some((t: string) => t.toLowerCase().includes(keyword));
		});

		return !hasFineTuneKeyword;
	}

	let displayedTrendingModels = $derived.by(() => {
		let list = trendingModels;
		if (baseOnly) {
			list = list.filter(isBaseModel);
		}
		if (showInferenceOnly) {
			list = list.filter(
				(m) =>
					m.pipeline_tag === 'text-generation' ||
					m.pipeline_tag === 'conversational' ||
					!m.pipeline_tag
			);
		}
		return list;
	});

	function getSortLabel(value: string) {
		switch (value) {
			case 'trending':
				return 'Trending';
			case 'likes':
				return 'Most Likes';
			case 'downloads':
				return 'Most Downloads';
			case 'lastModified':
				return 'Recently Updated';
			case 'uncensored':
				return 'Uncensored';
			case 'tooluse':
				return 'Tool Use';
			case 'thinking':
				return 'Thinking';
			case 'coding':
				return 'Coding';
			default:
				return 'Trending';
		}
	}

	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			debouncedSearchQuery = val;
		}, 500);
	}

	async function fetchCacheDir() {
		try {
			const response = await fetch(`${base}/models/cache-dir`, {
				headers: getAuthHeaders()
			});
			if (response.ok) {
				const data = await response.json();
				cacheDir = data.cache_dir || '';
			}
		} catch (e) {
			console.error('Failed to fetch cache directory:', e);
		}
	}

	async function saveCacheDir() {
		if (!cacheDir.trim()) {
			toast.error('Cache directory path cannot be empty');
			return;
		}
		savingCacheDir = true;
		try {
			const response = await fetch(`${base}/models/cache-dir`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...getAuthHeaders()
				},
				body: JSON.stringify({ cache_dir: cacheDir.trim() })
			});
			if (response.ok) {
				toast.success('Download location updated successfully');
				await modelsStore.fetchRouterModels();
			} else {
				const err = await response.json();
				toast.error(`Failed to update location: ${err.error?.message || response.statusText}`);
			}
		} catch (e: any) {
			toast.error(`Error: ${e.message}`);
		} finally {
			savingCacheDir = false;
		}
	}

	function parseHuggingFaceUrl(input: string): string {
		const trimmed = input.trim();
		if (!trimmed) return '';

		if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
			try {
				const url = new URL(trimmed);
				if (url.hostname === 'huggingface.co' || url.hostname === 'www.huggingface.co') {
					const parts = url.pathname.split('/').filter(Boolean);
					if (parts.length >= 2) {
						const owner = parts[0];
						const repo = parts[1];
						const fileIndex = parts.indexOf('resolve');
						const blobIndex = parts.indexOf('blob');
						const refIndex = fileIndex !== -1 ? fileIndex : blobIndex;

						if (refIndex !== -1 && parts.length > refIndex + 2) {
							const filename = parts.slice(refIndex + 2).join('/');
							if (filename.toLowerCase().endsWith('.gguf')) {
								return `${owner}/${repo}:${filename}`;
							}
						}
						return `${owner}/${repo}`;
					}
				}
			} catch (e) {
				console.error('Invalid URL:', e);
			}
		}
		return trimmed;
	}

	async function startDownload(repoId: string) {
		let downloadId = repoId.trim();

		// Extract repo ID from URL if user pasted a full URL
		if (downloadId.startsWith('http://') || downloadId.startsWith('https://')) {
			try {
				const url = new URL(downloadId);
				if (url.hostname === 'huggingface.co' || url.hostname === 'hf.co') {
					const parts = url.pathname.split('/').filter((p) => p);
					if (parts.length >= 2) {
						downloadId = `${parts[0]}/${parts[1]}`;
						if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'resolve')) {
							const filename = parts.slice(4).join('/');
							const match = filename.match(/(Q[0-9]_[A-Z0-9_]+|F16|BF16)/i);
							if (match) {
								downloadId = `${downloadId}:${match[1]}`;
							}
						}
					}
				}
			} catch (e) {
				// Invalid URL, leave it as is
			}
		}

		try {
			const response = await fetch(`${base}/models`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...getAuthHeaders()
				},
				body: JSON.stringify({ model: downloadId })
			});
			if (response.ok) {
				toast.success(`Started download for ${repoId}`);
				await modelsStore.fetchRouterModels();
			} else {
				const err = await response.json();
				toast.error(`Failed to download: ${err.error?.message || response.statusText}`);
			}
		} catch (e: any) {
			toast.error(`Error: ${e.message}`);
		}
	}

	async function handleCustomDownload() {
		const parsed = parseHuggingFaceUrl(customDownloadUrl);
		if (!parsed) {
			toast.error('Please enter a valid Hugging Face URL or Repo ID');
			return;
		}
		downloadingCustom = true;
		await startDownload(parsed);
		customDownloadUrl = '';
		downloadingCustom = false;
	}

	async function cancelDownload(modelId: string) {
		try {
			await modelsStore.unloadModel(modelId);
			toast.info(`Cancelled download for ${modelId}`);
		} catch (e: any) {
			toast.error(`Failed to cancel: ${e.message}`);
		}
	}

	async function handleUpdateIde() {
		updatingIde = true;
		try {
			const response = await fetch(`${base}/models/update-ide`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...getAuthHeaders()
				}
			});
			if (response.ok) {
				const data = await response.json();
				toast.success(`Successfully configured settings for ${data.updated_count} IDE(s)`);
			} else {
				toast.error('Failed to configure IDE settings');
			}
		} catch (e: any) {
			toast.error(`Error: ${e.message}`);
		} finally {
			updatingIde = false;
		}
	}

	async function fetchModelDetails(modelId: string) {
		let repoId = modelId;
		if (repoId.includes(':')) {
			repoId = repoId.split(':')[0];
		}
		if (!repoId || !repoId.includes('/') || repoId.includes('\\') || repoId.startsWith('http'))
			return;
		if (modelDetailsMap.has(modelId) || detailsInflight.has(modelId)) return;
		detailsInflight.add(modelId);
		try {
			const res = await fetch(`https://huggingface.co/api/models/${repoId}?blobs=true`);
			if (res.ok) {
				const data = await res.json();
				modelDetailsMap.set(modelId, data);
			}
		} catch (e) {
			console.error(`Failed to fetch details for ${modelId}:`, e);
		} finally {
			detailsInflight.delete(modelId);
		}
	}

	function getCatalogModelSize(modelId: string): string {
		const details = modelDetailsMap.get(modelId);
		if (!details) return '';

		const formatFileSize = (bytes: number) => {
			if (bytes < 1024 * 1024 * 1024) {
				return (bytes / (1024 * 1024)).toFixed(0) + 'MB';
			}
			return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
		};

		const ggufs = details.siblings
			? details.siblings.filter((s: any) => s.rfilename && s.rfilename.endsWith('.gguf') && s.size)
			: [];
		if (ggufs.length > 0) {
			// Find Q4
			let q4File = ggufs.find((s: any) => {
				const fn = s.rfilename.toLowerCase();
				return (
					fn.includes('q4_k_m') ||
					fn.includes('q4_0') ||
					fn.includes('q4_1') ||
					fn.includes('q4_k_s') ||
					fn.includes('q4')
				);
			});
			if (!q4File) {
				q4File = ggufs.find((s: any) => s.rfilename.toLowerCase().includes('q4'));
			}

			// Find Q8
			let q8File = ggufs.find((s: any) => {
				const fn = s.rfilename.toLowerCase();
				return (
					fn.includes('q8_0') || fn.includes('q8_1') || fn.includes('q8_k') || fn.includes('q8')
				);
			});
			if (!q8File) {
				q8File = ggufs.find((s: any) => s.rfilename.toLowerCase().includes('q8'));
			}

			if (q4File && q8File) {
				return `Size: ${formatFileSize(q4File.size)} (Q4) / ${formatFileSize(q8File.size)} (Q8)`;
			} else if (q4File) {
				return `Size: ${formatFileSize(q4File.size)} (Q4)`;
			} else if (q8File) {
				return `Size: ${formatFileSize(q8File.size)} (Q8)`;
			} else {
				const largest = [...ggufs].sort((a, b) => b.size - a.size)[0];
				return `Size: ${formatFileSize(largest.size)}`;
			}
		}

		if (details.usedStorage && details.usedStorage > 0) {
			return `Size: ${formatFileSize(details.usedStorage)} (Base)`;
		}

		return '';
	}

	async function fetchTrending() {
		loadingTrending = true;
		try {
			let url = `https://huggingface.co/api/models?limit=${limit}&library=gguf`;

			let activeSort = '';
			let listSearchQuery = '';

			if (
				selectedList === 'likes' ||
				selectedList === 'downloads' ||
				selectedList === 'lastModified'
			) {
				activeSort = selectedList;
			} else if (selectedList === 'uncensored') {
				listSearchQuery = 'uncensored';
			} else if (selectedList === 'tooluse') {
				listSearchQuery = 'tool-use';
			} else if (selectedList === 'thinking') {
				listSearchQuery = 'thinking';
			} else if (selectedList === 'coding') {
				listSearchQuery = 'coding';
			} else if (selectedList === 'experimental') {
				listSearchQuery = 'experimental';
			}

			if (activeSort) {
				url += `&sort=${activeSort}`;
			}

			let finalSearch = '';
			if (listSearchQuery && debouncedSearchQuery) {
				finalSearch = `${listSearchQuery} ${debouncedSearchQuery}`;
			} else if (listSearchQuery) {
				finalSearch = listSearchQuery;
			} else if (debouncedSearchQuery) {
				finalSearch = debouncedSearchQuery;
			}

			if (finalSearch) {
				url += `&search=${encodeURIComponent(finalSearch)}`;
			}

			const res = await fetch(url);
			if (res.ok) {
				trendingModels = await res.json();
			}
		} catch (e) {
			console.error('Failed to fetch trending models:', e);
		} finally {
			loadingTrending = false;
		}
	}

	async function startDownloadMonitor() {
		downloadAbort = new AbortController();
		const signal = downloadAbort.signal;
		const decoder = new TextDecoder();

		while (!signal.aborted) {
			try {
				const response = await fetch(`${base}/models/sse`, {
					headers: getAuthHeaders(),
					signal
				});
				if (response.ok && response.body) {
					const reader = response.body.getReader();
					let buffer = '';
					while (!signal.aborted) {
						const { value, done } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						let boundary = buffer.indexOf('\n\n');
						while (boundary !== -1) {
							const record = buffer.slice(0, boundary);
							handleSseRecord(record);
							buffer = buffer.slice(boundary + 2);
							boundary = buffer.indexOf('\n\n');
						}
					}
				}
			} catch (e) {
				// Reconnect after delay
			}
			if (signal.aborted) return;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	function handleSseRecord(record: string) {
		const lines = record.split('\n');
		const dataLine = lines.find((l) => l.startsWith('data: '));
		if (!dataLine) return;
		try {
			const envelope = JSON.parse(dataLine.slice(6));
			const model = envelope.model;
			const event = envelope.event;

			if (event === 'download_progress') {
				const data = envelope.data;
				let done = 0;
				let total = 0;
				if (data && data.progress) {
					for (const key in data.progress) {
						done += data.progress[key].done || 0;
						total += data.progress[key].total || 0;
					}
				}
				if (total > 0) {
					const existing = downloadProgress.get(model);
					const startTime = existing?.startTime || Date.now();
					let speed = existing?.speed || 0;

					// Update speed
					if (done > 0 && done > (existing?.done || 0)) {
						const elapsedSeconds = (Date.now() - startTime) / 1000;
						if (elapsedSeconds > 0.5) {
							speed = done / elapsedSeconds;
						}
					}

					downloadProgress.set(model, { done, total, startTime, speed });
					downloadProgress = new Map(downloadProgress);
				}
			} else if (event === 'download_finished') {
				downloadProgress.delete(model);
				downloadProgress = new Map(downloadProgress);
				toast.success(`Download complete: ${model}`);
				void modelsStore.fetchRouterModels();
			} else if (event === 'download_failed') {
				downloadProgress.delete(model);
				downloadProgress = new Map(downloadProgress);
				toast.error(`Download failed: ${model}`);
				void modelsStore.fetchRouterModels();
			} else if (event === 'models_reload') {
				void modelsStore.fetchRouterModels();
			}
		} catch (e) {
			// Parse error
		}
	}

	function formatRelativeTime(dateStr: string) {
		if (!dateStr) return '';
		try {
			const date = new Date(dateStr);
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHrs = Math.floor(diffMs / 3600000);
			const diffDays = Math.floor(diffMs / 86400000);
			const diffWeeks = Math.floor(diffMs / 604800000);

			if (diffMins < 60) return `${diffMins}m ago`;
			if (diffHrs < 24) return `${diffHrs}h ago`;
			if (diffDays < 7) return `${diffDays}d ago`;
			return `${diffWeeks}w ago`;
		} catch {
			return '';
		}
	}

	function formatCount(num: number): string {
		if (num === undefined || num === null) return '0';
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
		}
		return num.toString();
	}

	function extractParamSize(model: any): string {
		const details = modelDetailsMap.get(model.id);
		if (details && details.safetensors && details.safetensors.total) {
			const total = parseFloat(details.safetensors.total);
			if (!isNaN(total) && total > 0) {
				if (total >= 1e9) {
					const b = total / 1e9;
					return b >= 10 ? Math.round(b) + 'B' : b.toFixed(1) + 'B';
				} else if (total >= 1e6) {
					const m = total / 1e6;
					return m >= 10 ? Math.round(m) + 'M' : m.toFixed(1) + 'M';
				}
			}
		}

		const detailsTags = details?.tags || details?.cardData?.tags || [];
		const allTags = [...(model.tags || []), ...detailsTags];
		if (Array.isArray(allTags)) {
			for (const tag of allTags) {
				if (/^\d+(\.\d+)?[mB]$/i.test(tag)) {
					return tag.toUpperCase();
				}
			}
		}

		const match = model.id.match(/\b(\d+(\.\d+)?)[mB]\b/i);
		if (match) {
			return match[0].toUpperCase();
		}

		const nameMatch = model.id.match(/[-_](\d+(\.\d+)?)(?!\b[mM][bB]\b)\b/);
		if (nameMatch) {
			return nameMatch[1] + 'B';
		}

		return '';
	}

	interface ModelTag {
		text: string;
		className: string;
	}

	function getModelNameOnly(id: string): string {
		if (!id) return '';
		if (
			id.includes('\\') ||
			(id.includes('/') && !id.includes('huggingface.co') && !id.match(/^[^\/]+\/[^\/]+$/))
		) {
			const parts = id.split(/[\/\\]/);
			return parts[parts.length - 1];
		}
		return id;
	}

	function getModelTags(model: any): ModelTag[] {
		const tags: ModelTag[] = [];
		const idLower = model.id.toLowerCase();

		const details = modelDetailsMap.get(model.id);
		const detailsTags = details?.tags || details?.cardData?.tags || [];
		const modelTags = [...(model.tags || []), ...detailsTags];
		const hasTag = (word: string) => modelTags.some((t: string) => t.toLowerCase().includes(word));
		const checkWord = (word: string) =>
			idLower.includes(word) ||
			(model.path && model.path.toLowerCase().includes(word)) ||
			hasTag(word);

		const paramSize = extractParamSize(model);
		if (paramSize) {
			const cleanSize =
				paramSize.endsWith('B') || paramSize.endsWith('M') ? paramSize : paramSize + 'B';
			tags.push({
				text: `${cleanSize} Params`,
				className: 'bg-slate-700 text-slate-100 dark:bg-slate-700 dark:text-slate-100 font-semibold'
			});
		}

		if (
			checkWord('uncensored') ||
			checkWord('abliterated') ||
			checkWord('heretic') ||
			checkWord('unlocked') ||
			checkWord('no-refusal') ||
			checkWord('jailbreak') ||
			checkWord('composer2.5-v2') ||
			(idLower.includes('base') === false &&
				(checkWord('nsfw') || checkWord('erotic') || checkWord('psyfighter')))
		) {
			tags.push({
				text: 'Uncensored',
				className: 'bg-neutral-600 text-white font-semibold'
			});
		}

		const isThinking =
			checkWord('thinking') ||
			checkWord('reasoning') ||
			checkWord('r1') ||
			checkWord('cot') ||
			modelsStore.checkModelSupportsThinking(model.id);
		if (isThinking) {
			tags.push({
				text: 'Thinking',
				className: 'bg-neutral-600 text-white font-semibold'
			});
		}

		if (
			checkWord('tool') ||
			checkWord('agentic') ||
			checkWord('function') ||
			checkWord('fc') ||
			checkWord('execute')
		) {
			tags.push({
				text: 'Tool Use',
				className: 'bg-neutral-600 text-white font-semibold'
			});
		}

		if (checkWord('coder') || checkWord('coding') || checkWord('code') || checkWord('developer')) {
			tags.push({
				text: 'Coding',
				className: 'bg-neutral-600 text-white font-semibold'
			});
		}

		let family = '';
		if (idLower.includes('llama') || hasTag('llama')) family = 'Llama';
		else if (idLower.includes('qwen') || hasTag('qwen')) family = 'Qwen';
		else if (idLower.includes('gemma') || hasTag('gemma')) family = 'Gemma';
		else if (idLower.includes('phi') || hasTag('phi')) family = 'Phi';
		else if (idLower.includes('mistral') || hasTag('mistral')) family = 'Mistral';
		else if (idLower.includes('mixtral') || hasTag('mixtral')) family = 'Mixtral';
		else if (idLower.includes('deepseek') || hasTag('deepseek')) family = 'DeepSeek';
		else if (idLower.includes('glm') || hasTag('glm')) family = 'GLM';
		else if (idLower.includes('yi') || hasTag('yi')) family = 'Yi';
		else if (
			idLower.includes('cohere') ||
			idLower.includes('command') ||
			hasTag('cohere') ||
			hasTag('command')
		)
			family = 'Cohere';

		if (family) {
			tags.push({
				text: family,
				className: 'bg-neutral-600 text-white font-semibold'
			});
		}

		if (
			checkWord('gguf') ||
			(model.path && model.path.toLowerCase().endsWith('.gguf')) ||
			model.id?.endsWith('.gguf')
		) {
			tags.push({
				text: 'GGUF',
				className: 'bg-neutral-500 text-white font-semibold'
			});
		} else {
			tags.push({
				text: 'Base',
				className: 'bg-neutral-500 text-white font-semibold'
			});
		}

		return tags;
	}

	function getEstimatedRam(model: any): string {
		let sizeGb = 0;
		if (model.size_bytes && model.size_bytes > 0) {
			sizeGb = model.size_bytes / (1024 * 1024 * 1024);
		} else if (model.size) {
			if (typeof model.size === 'number') {
				sizeGb = model.size / (1024 * 1024 * 1024);
			}
		}

		if (sizeGb > 0) {
			return `${Math.ceil(sizeGb + 2.5)}G RAM Required`;
		}

		const paramSizeStr = extractParamSize(model);
		if (paramSizeStr) {
			const num = parseFloat(paramSizeStr);
			if (!isNaN(num)) {
				return `${Math.ceil(num * 0.7 + 1)}G RAM Required`;
			}
		}

		return '8G RAM Required';
	}

	function extractLicense(model: any): string {
		const details = modelDetailsMap.get(model.id);
		const tags = [
			...(model.tags || []),
			...(details?.tags || []),
			...(details?.cardData?.tags || [])
		];
		for (const tag of tags) {
			if (tag.startsWith('license:')) {
				return tag.slice(8).toUpperCase();
			}
		}
		if (model.details?.license) {
			return model.details.license.toUpperCase();
		}
		if (details?.cardData?.license) {
			return details.cardData.license.toUpperCase();
		}
		return 'APACHE-2.0';
	}

	function getModelSizeString(model: any): string {
		let sizeStr = '';
		if (model.size_bytes && model.size_bytes > 0) {
			sizeStr = formatBytes(model.size_bytes);
		} else if (model.size) {
			if (typeof model.size === 'number') {
				sizeStr = formatBytes(model.size);
			} else {
				sizeStr = model.size.toString();
			}
		} else {
			sizeStr = 'Unknown';
		}

		// Try to extract quantization from id or path
		const filename = (model.path || model.id || '').toLowerCase();
		const match = filename.match(/\b(q\d+_[k_a-z0-9]+|q\d+_\d|q\d+)\b/i);
		if (match) {
			const quant = match[0].toUpperCase();
			return `${sizeStr} (${quant})`;
		}
		return sizeStr;
	}

	function formatPipelineTag(tag: string): string {
		if (!tag) return 'Text Generation';
		return tag
			.split('-')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	function formatBytes(bytes: number): string {
		if (!bytes) return '0 GB';
		const gb = bytes / (1024 * 1024 * 1024);
		return gb.toFixed(1) + ' GB';
	}

	onMount(() => {
		void modelsStore.fetch(true);
		void fetchCacheDir();
		void startDownloadMonitor();
		void loadSwarmConfigs();

		return () => {
			downloadAbort?.abort();
		};
	});

	$effect(() => {
		// Reactive fetch when selectedList, limit or search changes
		const _list = selectedList;
		const _l = limit;
		const _q = debouncedSearchQuery;
		fetchTrending();
	});
</script>

<svelte:window
	onclick={(e) => {
		if (
			sortDropdownOpen &&
			e.target &&
			!(e.target as HTMLElement).closest('.sort-dropdown-container')
		) {
			sortDropdownOpen = false;
		}
	}}
/>

<div class="mx-auto w-full p-4 md:p-8 md:py-8" in:fade={{ duration: 150 }}>
	<div
		class="mb-6 rounded-lg border {modelsStore.activeRpcPeers.length > 0
			? 'border-primary/20 bg-primary/5'
			: 'border-border/50 bg-muted/20'} p-4"
	>
		<div class="flex items-center justify-between mb-3">
			<h3
				class="text-sm font-semibold flex items-center gap-2 {modelsStore.activeRpcPeers.length > 0
					? 'text-primary'
					: 'text-muted-foreground'}"
			>
				<Server class="w-4 h-4" />
				Active Compute Pool
			</h3>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => (showRpcDialog = true)}
					class="h-7 gap-2 text-xs"
				>
					<Server class="w-3 h-3 text-primary" />
					{modelsStore.activeRpcPeers.length > 0 ? 'Manage Pool' : 'Find Peers'}
				</Button>
				{#if modelsStore.activeRpcPeers.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 text-xs"
						onclick={() => (modelsStore.activeRpcPeers = [])}
					>
						Clear Pool
					</Button>
				{/if}
			</div>
		</div>

		{#if modelsStore.activeRpcPeers.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each modelsStore.activeRpcPeers as peer}
					<div
						class="flex items-center gap-2 bg-background border rounded-full pl-3 pr-1 py-1 text-sm shadow-sm"
					>
						<span class="font-medium">{peer.name}</span>
						<span class="text-xs text-muted-foreground">({peer.endpoint})</span>
						<Button
							variant="ghost"
							size="icon"
							class="w-5 h-5 rounded-full hover:bg-destructive hover:text-destructive-foreground ml-1"
							onclick={() =>
								(modelsStore.activeRpcPeers = modelsStore.activeRpcPeers.filter(
									(p) => p.id !== peer.id
								))}
						>
							<X class="w-3 h-3" />
						</Button>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground mt-3">
				Models loaded into the slots below will automatically distribute compute across this pool.
			</p>
		{:else}
			<div class="flex flex-col items-center justify-center py-4 text-center text-muted-foreground">
				<p class="text-sm mb-2">No peers in your compute pool.</p>
				<p class="text-xs">Click <strong>Find Peers</strong> to connect to other machines.</p>
			</div>
		{/if}
	</div>

	<!-- Agent Swarms Tile -->
	<div
		class="mb-6 rounded-lg border border-border/50 bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
	>
		<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
			<div>
				<h3 class="text-lg font-bold flex items-center gap-2 text-foreground mb-1">
					<Network class="w-5 h-5 text-primary" />
					Agent Swarms (MoA)
				</h3>
				<p class="text-sm text-muted-foreground">
					Chain up to 6 models (local, local network, or online) into a single Mixture of Agents
					endpoint with customizable personas.
				</p>
			</div>
			<div class="shrink-0 flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto">
				<Button variant="default" class="w-full md:w-auto" onclick={() => (showSwarmConfig = true)}>
					<Settings2 class="w-4 h-4 mr-2" />
					Configure Swarm
				</Button>
				<!-- Swarm Dropdown Selector -->
				<div class="w-full min-w-[200px]">
					<select
						bind:value={activeSwarmConfigId}
						onchange={handleSwarmChange}
						class="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
					>
						<option value="">Deactivated (No Swarm)</option>
						{#each swarmConfigs as conf}
							<option value={conf.id}>{conf.name}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>
	</div>

	<div class="grid gap-6">
		<!-- Model Slots (6-pack) -->
		<div>
			<h3
				class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 text-center"
			>
				Active Model Slots
			</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each Array(6) as _, i}
					{@const loadedModelId = modelsStore.loadedModelIds[i]}
					{#if loadedModelId}
						<!-- Active Slot -->
						<div
							class="flex items-center justify-between border border-border/50 rounded-xl px-4 py-2.5 bg-muted/10"
						>
							<div class="flex-1 min-w-0 mr-3">
								<div
									class="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-semibold"
								>
									Active Slot {i + 1}
								</div>
								<div class="font-bold text-sm truncate" title={loadedModelId}>
									{getModelNameOnly(loadedModelId)}
								</div>
							</div>
							<div class="flex flex-col items-center gap-1.5">
								<Button
									size="sm"
									variant="outline"
									onclick={() => modelsStore.unloadModel(loadedModelId)}
									disabled={modelsStore.isModelOperationInProgress(loadedModelId)}
									class="border-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground min-w-[80px] font-semibold"
								>
									Unload
								</Button>
							</div>
						</div>
					{:else}
						<!-- Inactive Slot -->
						{@const selectedModel = selectedModelsForSlots[i]}
						{@const isLoading = selectedModel
							? modelsStore.isModelOperationInProgress(selectedModel)
							: false}
						{@const loadProgressInfo = selectedModel
							? modelsStore.getLoadProgress(selectedModel)
							: null}
						<div
							class="flex items-center justify-between border border-border/50 rounded-xl px-4 py-2.5 {isLoading
								? 'bg-muted/10'
								: 'bg-card'}"
						>
							<div class="flex-1 min-w-0 mr-3">
								<div
									class="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 font-semibold"
								>
									Slot {i + 1}
									{isLoading ? '(Loading)' : '(Inactive)'}
								</div>

								{#if isLoading && loadProgressInfo}
									{@const val = Math.round(loadProgressInfo.value * 100)}
									<div class="font-bold text-sm truncate mb-2" title={selectedModel}>
										{getModelNameOnly(selectedModel)}
									</div>
									<div class="w-full">
										<div
											class="flex items-center justify-between text-[10px] text-muted-foreground mb-1"
										>
											<span>Loading weights...</span>
											<span class="font-mono">{val}%</span>
										</div>
										<div class="h-1.5 w-full bg-muted rounded-full overflow-hidden">
											<div
												class="bg-primary h-full rounded-full transition-all duration-300"
												style="width: {val}%"
											></div>
										</div>
									</div>
								{:else}
									<select
										bind:value={selectedModelsForSlots[i]}
										class="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary truncate font-medium"
									>
										<option value="">Select a model...</option>
										{#each localModels as lm}
											<option value={lm.id}>{getModelNameOnly(lm.id)}</option>
										{/each}
									</select>
								{/if}
							</div>
							<div class="flex flex-col items-center gap-1.5">
								<Button
									size="sm"
									onclick={() => {
										if (selectedModelsForSlots[i]) {
											modelsStore.loadModel(selectedModelsForSlots[i]);
										}
									}}
									disabled={!selectedModelsForSlots[i] ||
										modelsStore.isModelOperationInProgress(selectedModelsForSlots[i])}
									class="bg-gradient-to-r from-neutral-700 to-neutral-500 hover:from-neutral-600 hover:to-neutral-400 text-white font-bold border-none shadow-sm transition-opacity min-w-[80px]"
								>
									{isLoading ? 'Loading' : 'Load'}
								</Button>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Cache & Custom Download Configuration -->
		<div class="grid gap-6 md:grid-cols-2">
			<!-- Caching Path -->
			<div
				class="rounded-xl border border-border/50 bg-card p-4 shadow-sm flex flex-col justify-between"
			>
				<div>
					<h3 class="text-base font-semibold mb-1 flex items-center gap-2">
						<Folder class="h-4 w-4 text-muted-foreground" /> Download Location
					</h3>
					<p class="text-xs text-muted-foreground mb-2.5">Set your default GGUF cache directory.</p>
					<Input
						type="text"
						bind:value={cacheDir}
						placeholder="e.g. C:\llama_models"
						class="bg-background/50 border-border/50 rounded-lg text-sm mb-2.5"
					/>
				</div>
				<Button
					size="sm"
					variant="outline"
					onclick={saveCacheDir}
					disabled={savingCacheDir}
					class="w-full flex items-center justify-center gap-1.5"
				>
					{#if savingCacheDir}
						<Loader2 class="h-4 w-4 animate-spin" /> Updating...
					{:else}
						Apply Location
					{/if}
				</Button>
			</div>

			<!-- Direct URL Download -->
			<div
				class="rounded-xl border border-border/50 bg-card p-4 shadow-sm flex flex-col justify-between"
			>
				<div>
					<h3 class="text-base font-semibold mb-1 flex items-center gap-2">
						<Download class="h-4 w-4 text-muted-foreground" /> Download Model
					</h3>
					<p class="text-xs text-muted-foreground mb-2.5">
						Enter a Hugging Face model URL or Repo ID.
					</p>
					<Input
						type="text"
						bind:value={customDownloadUrl}
						placeholder="e.g. https://huggingface.co/unsloth/GLM-5.2-GGUF"
						class="bg-background/50 border-border/50 rounded-lg text-sm mb-2.5"
					/>
				</div>
				<Button
					size="sm"
					onclick={handleCustomDownload}
					disabled={downloadingCustom || !customDownloadUrl.trim()}
					class="w-full flex items-center justify-center gap-1.5"
				>
					{#if downloadingCustom}
						<Loader2 class="h-4 w-4 animate-spin" /> Starting...
					{:else}
						Start Download
					{/if}
				</Button>
			</div>
		</div>

		<!-- Active Downloads -->
		{#if activeDownloadsList.length > 0}
			<div
				class="rounded-xl border border-border/50 bg-card p-6 shadow-sm transition-all duration-300"
			>
				<h3 class="text-base font-semibold mb-3 flex items-center gap-2 text-primary">
					<Loader2 class="h-4 w-4 animate-spin" /> Active Downloads
				</h3>
				<div class="grid gap-4">
					{#each activeDownloadsList as dl (dl.id)}
						{@const pct = dl.total > 0 ? Math.round((dl.done / dl.total) * 100) : 0}
						<div class="flex flex-col gap-1.5 border border-border/20 rounded-lg p-3 bg-muted/20">
							<div class="flex items-center justify-between text-sm">
								<span class="font-medium truncate max-w-[70%]">{dl.id}</span>
								<div class="flex items-center gap-2">
									{#if dl.speed > 0 && dl.total > dl.done}
										{@const remainingBytes = dl.total - dl.done}
										{@const etaSeconds = remainingBytes / dl.speed}
										{@const formatEta = (sec: number) =>
											sec < 60
												? `${Math.ceil(sec)}s`
												: `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`}
										<span class="text-xs text-muted-foreground mr-2"
											>ETA: {formatEta(etaSeconds)} ({formatBytes(dl.speed)}/s)</span
										>
									{/if}
									<span class="text-xs font-mono"
										>{pct}% ({formatBytes(dl.done)} / {formatBytes(dl.total)})</span
									>
									<Button
										size="icon"
										variant="ghost"
										class="h-7 w-7 rounded-full text-destructive hover:bg-destructive/10"
										onclick={() => cancelDownload(dl.id)}
										title="Cancel Download"
									>
										<X class="h-4 w-4" />
									</Button>
								</div>
							</div>
							<div class="h-1.5 w-full bg-muted rounded-full overflow-hidden">
								<div
									class="bg-primary h-full rounded-full transition-all duration-300"
									style="width: {pct}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tabs Header -->
		<div class="flex border-b border-border/30 w-full mb-6">
			<button
				type="button"
				class="flex-1 py-3 text-center text-sm font-bold border-b-2 transition-all cursor-pointer focus:outline-none {activeTab ===
				'local'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeTab = 'local')}
			>
				Local Downloaded Models
			</button>
			<button
				type="button"
				class="flex-1 py-3 text-center text-sm font-bold border-b-2 transition-all cursor-pointer focus:outline-none {activeTab ===
				'huggingface'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeTab = 'huggingface')}
			>
				Hugging Face Models
			</button>
			<button
				type="button"
				class="flex-1 py-3 text-center text-sm font-bold border-b-2 transition-all cursor-pointer focus:outline-none {activeTab ===
				'online'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					activeTab = 'online';
					if (Object.values(providerKeys).some((keys) => keys.some((k) => k && k !== '***')))
						fetchProviderModels();
				}}
			>
				Live Online Models
			</button>
			<button
				class="flex-1 py-4 px-6 text-sm font-semibold border-b-2 transition-colors {activeTab ===
				'compute'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}"
				onclick={() => (activeTab = 'compute')}
			>
				Model Endpoints
			</button>
		</div>

		{#if activeTab === 'local'}
			<!-- Local / Downloaded Models List -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<h3 class="text-lg font-bold mb-4">Local Downloaded Models</h3>
				{#if localModels.length === 0}
					<div
						class="py-8 text-center text-sm text-muted-foreground border border-dashed border-border/30 rounded-lg"
					>
						No local models found. Set a download location or download a model to get started.
					</div>
				{:else}
					<div class="grid gap-3">
						{#each localModels as model (model.id)}
							{@const isLoaded =
								model.status.value === ServerModelStatus.LOADED ||
								model.status.value === ServerModelStatus.SLEEPING}
							{@const isLoading = model.status.value === ServerModelStatus.LOADING}
							{@const loadProgressInfo = modelsStore.getLoadProgress(model.id)}
							{void fetchModelDetails(model.id)}
							{@const tags = getModelTags(model)}
							{@const estimatedRam = getEstimatedRam(model)}
							<div
								class="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border/30 rounded-xl p-4 bg-muted/10"
							>
								<div class="flex-1 min-w-0">
									<!-- Top line: Name & Status Badge -->
									<div class="flex items-center gap-2 mb-1.5">
										<h4 class="font-bold text-sm truncate max-w-[80%]" title={model.id}>
											{getModelNameOnly(model.id)}
										</h4>
										{#if isLoaded}
											<Badge
												variant="default"
												class="bg-neutral-600 hover:bg-neutral-700 text-white border-none font-medium px-2 py-0"
												>Loaded</Badge
											>
										{:else if isLoading}
											<Badge
												variant="outline"
												class="text-primary border-primary animate-pulse font-medium px-2 py-0"
												>Loading</Badge
											>
										{/if}
									</div>

									<!-- Second line: Color-coded tags -->
									<div class="flex flex-wrap gap-1.5 mb-2">
										{#each tags as tag}
											<span
												class="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide {tag.className}"
											>
												{tag.text}
											</span>
										{/each}
									</div>

									<!-- Third line: Metadata line separated by centered dots -->
									<div
										class="flex items-center gap-x-2 text-[11px] text-muted-foreground flex-wrap"
									>
										<span>Text Generation</span>
										<span>·</span>
										<span>APACHE-2.0</span>
										<span>·</span>
										<span class="font-semibold text-neutral-700 dark:text-neutral-300"
											>Size: {getModelSizeString(model)}</span
										>
									</div>

									<!-- Load Progress Bar -->
									{#if isLoading && loadProgressInfo}
										{@const val = Math.round(loadProgressInfo.value * 100)}
										<div class="mt-3 max-w-md">
											<div
												class="flex items-center justify-between text-[10px] text-muted-foreground mb-1"
											>
												<span>Loading model weights...</span>
												<span class="font-mono">{val}%</span>
											</div>
											<div class="h-1.5 w-full bg-muted rounded-full overflow-hidden">
												<div
													class="bg-primary h-full rounded-full transition-all duration-300"
													style="width: {val}%"
												></div>
											</div>
										</div>
									{/if}
								</div>

								<!-- Right-hand side: Buttons and RAM requirement -->
								<div
									class="flex flex-col items-center gap-1.5 justify-center self-end md:self-center"
								>
									<!-- Load / Unload -->
									{#if isLoaded}
										<Button
											size="sm"
											variant="outline"
											onclick={() => modelsStore.unloadModel(model.id)}
											disabled={modelsStore.isModelOperationInProgress(model.id)}
											class="border-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground min-w-[80px] font-semibold"
										>
											Unload
										</Button>
									{:else}
										<Button
											size="sm"
											onclick={() => modelsStore.loadModel(model.id)}
											disabled={modelsStore.isModelOperationInProgress(model.id)}
											class="bg-gradient-to-r from-neutral-700 to-neutral-500 hover:from-neutral-600 hover:to-neutral-400 text-white font-bold border-none shadow-sm transition-opacity min-w-[80px]"
										>
											Load
										</Button>
									{/if}

									<!-- Auto Update IDE -->
									<Button
										onclick={handleUpdateIde}
										disabled={updatingIde}
										class="flex items-center gap-1 h-5 px-2 text-[9px] font-semibold rounded-full text-white bg-neutral-800 hover:bg-neutral-700 border-none shimmer-pill"
										title="Automatically configure local IDE configurations to map to this model"
									>
										{#if updatingIde}
											<Loader2 class="h-2.5 w-2.5 animate-spin" />
										{/if}
										Update IDE
									</Button>
									<!-- Estimated RAM Requirement -->
									<span class="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 mr-2"
										>{estimatedRam}</span
									>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if activeTab === 'online'}
			<!-- Live Online Models Tab -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<div class="flex justify-between items-center mb-4">
					<h3 class="text-lg font-bold flex items-center gap-2">
						<Network class="h-5 w-5 text-primary" /> Live Online Models
					</h3>
				</div>
				<p class="text-sm text-muted-foreground mb-6">
					Connect to external model providers like OpenRouter and OpenAI. Once configured, you can
					load these online models into an active model slot, allowing you to use them in the IDE,
					MCP configurations, and Agent Swarms exactly as if they were local models.
				</p>

				<div class="mb-8 max-w-md">
					<div class="mb-4">
						<Label
							class="text-xs font-bold mb-2 block text-muted-foreground uppercase tracking-wider"
							>Select Provider</Label
						>
						<select
							bind:value={selectedOnlineProviderId}
							class="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#each SUPPORTED_PROVIDERS as provider}
								<option value={provider.id}>{provider.name}</option>
							{/each}
						</select>
					</div>

					{#if selectedOnlineProviderId}
						{@const provider = SUPPORTED_PROVIDERS.find((p) => p.id === selectedOnlineProviderId)}
						{#if provider}
							<div
								class="border border-border/50 rounded-lg p-5 bg-muted/10 shadow-sm transition-all"
							>
								<div class="flex items-center justify-between mb-4">
									<h4 class="font-bold text-base">{provider.name} Configuration</h4>
									{#if providerKeys[provider.id] && providerKeys[provider.id].some((k) => k.trim() !== '')}
										<Badge
											variant="outline"
											class="bg-green-500/10 text-green-500 border-green-500/20">Configured</Badge
										>
									{:else}
										<Badge variant="outline" class="bg-muted text-muted-foreground border-border/50"
											>Unconfigured</Badge
										>
									{/if}
								</div>
								<div class="space-y-3">
									{#each providerKeys[provider.id] || [''] as key, index}
										<div class="flex items-center gap-2">
											<Input
												type="password"
												placeholder="API Key"
												bind:value={providerKeys[provider.id][index]}
												class="bg-background h-9 flex-1"
											/>
											{#if (providerKeys[provider.id] || []).length > 1}
												<Button
													variant="ghost"
													size="sm"
													class="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
													onclick={() => {
														providerKeys[provider.id].splice(index, 1);
														saveProviderKey(provider.id, provider.name, provider.base_url);
													}}
												>
													&times;
												</Button>
											{/if}
										</div>
									{/each}
									<div class="flex items-center gap-3 pt-2">
										<Button
											variant="outline"
											size="sm"
											class="flex-1"
											onclick={() => {
												if (!providerKeys[provider.id]) providerKeys[provider.id] = [];
												providerKeys[provider.id].push('');
											}}
										>
											+ Add Key
										</Button>
										<Button
											variant="secondary"
											size="sm"
											class="flex-1"
											onclick={() => testProviderKeys(provider.id)}
											disabled={testingProviderId === provider.id || !providerKeys[provider.id] || providerKeys[provider.id].every(k => k.trim() === '')}
										>
											{#if testingProviderId === provider.id}<Loader2 class="h-4 w-4 animate-spin mr-2" />{/if}
											Test Keys
										</Button>
										<Button
											size="sm"
											class="flex-1"
											onclick={() => saveProviderKey(provider.id, provider.name, provider.base_url)}
											disabled={savingProviderId === provider.id}
										>
											{#if savingProviderId === provider.id}<Loader2
													class="h-4 w-4 animate-spin mr-2"
												/>{/if}
											Save Keys
										</Button>
									</div>
								</div>
							</div>
						{/if}
					{/if}
				</div>

				<h4 class="font-bold text-md mb-4 flex items-center justify-between">
					Available Online Models
					<Button
						variant="ghost"
						size="sm"
						onclick={fetchProviderModels}
						disabled={loadingOnlineModels}
					>
						<RefreshCw class="h-4 w-4 mr-2 {loadingOnlineModels ? 'animate-spin' : ''}" /> Refresh
					</Button>
				</h4>

				{#if loadingOnlineModels}
					<div class="grid gap-3">
						{#each Array(3) as _}
							<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border/30 rounded-xl p-4 bg-muted/10 animate-pulse">
								<div class="flex-1 min-w-0 flex flex-col gap-2">
									<div class="flex items-center gap-2">
										<div class="h-5 bg-muted w-16 rounded-full"></div>
										<div class="h-4 bg-muted w-32 rounded"></div>
									</div>
								</div>
								<div class="h-9 bg-muted w-24 rounded-md"></div>
							</div>
						{/each}
					</div>
				{:else if onlineModels.length === 0}
					<div
						class="py-12 text-center text-sm text-muted-foreground border border-dashed border-border/30 rounded-lg"
					>
						No online models found. Make sure your API key is configured and connected.
					</div>
				{:else}
					<div class="grid gap-3">
						{#each onlineModels.filter(m => m.owned_by === selectedOnlineProviderId || m.owned_by === selectedOnlineProviderId + '_ai') as model (model.id)}
							{@const isLoaded = modelsStore.isModelLoaded(model.id)}
							<div
								class="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border/30 rounded-xl p-4 bg-muted/10 hover:bg-muted/30 transition-colors"
							>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-1.5">
										<Badge variant="outline" class="bg-primary/10 text-primary border-primary/20"
											>{model.owned_by}</Badge
										>
										<h4 class="font-bold text-sm truncate max-w-[80%]" title={model.id}>
											{model.id.split(':').pop()}
										</h4>
										{#if isLoaded}
											<Badge
												variant="default"
												class="bg-neutral-600 hover:bg-neutral-700 text-white border-none font-medium px-2 py-0"
												>Loaded</Badge
											>
										{/if}
									</div>
									<div
										class="flex items-center gap-x-2 text-[11px] text-muted-foreground flex-wrap"
									>
										<span>Context: {model.context_length || 'Unknown'}</span>
										<span>·</span>
										<span>API-Powered Model</span>
									</div>
								</div>

								<div class="flex flex-col items-end gap-1.5 justify-center self-end md:self-center">
									{#if isLoaded}
										<Button
											variant="destructive"
											size="sm"
											class="h-8 shadow-sm"
											onclick={async () => {
												try {
													await modelsStore.unloadModel(model.id);
													toast.success('Virtual model unloaded');
												} catch (e: any) {
													toast.error('Failed to unload: ' + e.message);
												}
											}}
										>
											Unload
										</Button>
									{:else}
										<div class="flex gap-2">
											<select
												class="h-8 text-xs bg-background border border-border rounded-md px-2"
												bind:value={selectedModelsForSlots[0]}
												onchange={(e) => {
													const slotIndex = parseInt((e.target as HTMLSelectElement).value);
													if (isNaN(slotIndex)) return;
													modelsStore
														.loadModel(model.id)
														.then(() => {
															toast.success(`Virtual model loaded!`);
														})
														.catch((err) => {
															toast.error('Failed to load: ' + err.message);
														});
													(e.target as HTMLSelectElement).value = ''; // Reset select
												}}
											>
												<option value="" disabled selected>Load to Slot...</option>
												{#each { length: 6 } as _, i}
													<option value={i}>Slot {i + 1}</option>
												{/each}
											</select>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if activeTab === 'compute'}
			<!-- Model Endpoints -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<h3 class="text-lg font-bold mb-4 uppercase tracking-wider text-muted-foreground text-sm">
					Model Endpoints
				</h3>

				<div class="space-y-3">
					<div
						class="flex items-center justify-between p-4 rounded-xl bg-black/5 dark:bg-black/20 border border-border/40"
					>
						<div>
							<div
								class="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5 flex-wrap"
							>
								LOADED LOCAL MODELS
								{#each Array(6) as _, i}
									{@const isActive = !!modelsStore.loadedModelIds[i]}
									{#if isActive}
										<span
											class="px-2 py-0.5 rounded-full bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/30 text-[8.5px] font-bold tracking-wider leading-none"
											>#{i + 1} ACTIVE</span
										>
									{:else}
										<span
											class="px-2 py-0.5 rounded-full bg-neutral-500/10 text-neutral-400 border border-neutral-500/30 text-[8.5px] font-bold tracking-wider leading-none"
											>#{i + 1} OFFLINE</span
										>
									{/if}
								{/each}
							</div>
							<div class="font-mono text-sm text-foreground">
								http://127.0.0.1:8000/v1/chat/completions
							</div>
						</div>
						<ActionIconCopyToClipboard
							text="http://127.0.0.1:8000/v1/chat/completions"
							ariaLabel="Copy Endpoint"
						/>
					</div>

					<div
						class="flex items-center justify-between p-4 rounded-xl bg-black/5 dark:bg-black/20 border border-border/40"
					>
						<div>
							<div class="text-xs font-semibold uppercase text-muted-foreground mb-1">
								Agent Swarms (MoA)
							</div>
							<div class="font-mono text-sm text-foreground">
								http://127.0.0.1:8000/v1/swarm/chat/completions
							</div>
						</div>
						<ActionIconCopyToClipboard
							text="http://127.0.0.1:8000/v1/swarm/chat/completions"
							ariaLabel="Copy Endpoint"
						/>
					</div>
				</div>
			</div>
		{:else if activeTab === 'huggingface'}
			<!-- Hugging Face Models List -->
			<div class="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
				<div
					class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-border/20 pb-4"
				>
					<div class="flex items-center gap-2.5">
						<h3 class="text-lg font-bold flex items-center gap-1.5 text-foreground">
							<Files class="h-5 w-5" /> Hugging Face Models
						</h3>
						<span
							class="text-xs text-muted-foreground/80 font-medium px-2 py-0.5 rounded bg-muted/40 border border-border/20 select-none"
							>2,890,937</span
						>
					</div>

					<div class="flex flex-wrap items-center gap-2 self-start md:self-center">
						<!-- Inline Search -->
						<div class="relative flex items-center">
							<Search class="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								type="text"
								bind:value={searchQuery}
								oninput={handleSearchInput}
								placeholder="Search models..."
								class="h-8 w-40 sm:w-56 pl-8 pr-3 text-xs bg-background border-border/50 rounded-lg focus-visible:ring-1 transition-all"
							/>
						</div>

						<!-- Filter button -->
						<Button
							variant="outline"
							size="sm"
							onclick={() => (showFilters = !showFilters)}
							class="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-border/50 bg-background text-foreground hover:bg-muted {showFilters
								? 'bg-muted border-neutral-400'
								: ''}"
						>
							<Box class="h-3.5 w-3.5 text-muted-foreground" /> Filter
						</Button>

						<!-- Base only toggle -->
						<div
							class="flex items-center gap-2 select-none border border-border/50 rounded-lg px-2.5 h-8 bg-background"
						>
							<button
								type="button"
								class="relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-neutral-200 dark:bg-neutral-800 {baseOnly
									? 'bg-primary dark:bg-primary'
									: ''}"
								role="switch"
								aria-label="Toggle base only"
								aria-checked={baseOnly}
								onclick={() => (baseOnly = !baseOnly)}
							>
								<span
									class="pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out transform {baseOnly
										? 'translate-x-3.5'
										: 'translate-x-0'}"
								></span>
							</button>
							<span class="text-xs font-semibold text-foreground">Base only</span>
						</div>

						<!-- Inference button -->
						<Button
							variant="outline"
							size="sm"
							onclick={() => (showInferenceOnly = !showInferenceOnly)}
							class="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-border/50 bg-background text-foreground hover:bg-muted {showInferenceOnly
								? 'bg-muted border-neutral-400'
								: ''}"
						>
							<Zap
								class="h-3.5 w-3.5 {showInferenceOnly
									? 'text-amber-500 fill-amber-500/20'
									: 'text-muted-foreground'}"
							/>
							Inference
						</Button>

						<!-- Sort dropdown -->
						<div class="relative inline-block sort-dropdown-container">
							<Button
								variant="outline"
								size="sm"
								onclick={() => (sortDropdownOpen = !sortDropdownOpen)}
								class="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-border/50 bg-background text-foreground hover:bg-muted {sortDropdownOpen
									? 'bg-muted'
									: ''}"
							>
								<ArrowUpDown class="h-3.5 w-3.5 text-muted-foreground" />
								<span>Sort: <span class="font-bold">{getSortLabel(selectedList)}</span></span>
								<span class="text-[9px] text-muted-foreground">▼</span>
							</Button>
							{#if sortDropdownOpen}
								<div
									class="absolute right-0 mt-1.5 w-48 rounded-lg border border-border/50 bg-popover text-popover-foreground shadow-lg z-50 py-1 focus:outline-none"
									transition:fade={{ duration: 100 }}
								>
									{#each sortOptions as opt}
										<button
											type="button"
											class="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted text-left font-medium {selectedList ===
											opt.value
												? 'text-primary bg-primary/5 font-semibold'
												: 'text-foreground/80'}"
											onclick={() => {
												selectedList = opt.value;
												sortDropdownOpen = false;
											}}
										>
											{opt.label}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Collapsible Filters -->
				{#if showFilters}
					<div
						class="grid gap-4 sm:grid-cols-2 border border-border/20 rounded-xl p-4 bg-muted/10 mb-6"
						transition:fade={{ duration: 150 }}
					>
						<!-- Limit -->
						<div>
							<Label class="text-xs font-semibold mb-1 block">Limit</Label>
							<Input
								type="number"
								bind:value={limit}
								min={5}
								max={100}
								class="bg-background border-border/50 rounded-lg px-3 py-1.5 text-sm h-auto focus-visible:ring-1"
							/>
						</div>

						<!-- Deleted Search -->
					</div>
				{/if}

				<!-- Trending Models List -->
				{#if loadingTrending}
					<div class="grid gap-3">
						{#each Array(5) as _}
							<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border/30 rounded-xl p-4 bg-muted/10 animate-pulse">
								<div class="flex-1 min-w-0 flex flex-col gap-3">
									<div class="flex items-center gap-3">
										<div class="h-5 bg-muted w-40 rounded"></div>
										<div class="h-4 bg-muted w-12 rounded"></div>
										<div class="h-4 bg-muted w-16 rounded"></div>
									</div>
									<div class="flex items-center gap-2">
										<div class="h-5 bg-muted w-16 rounded-full"></div>
										<div class="h-5 bg-muted w-20 rounded-full"></div>
										<div class="h-5 bg-muted w-14 rounded-full"></div>
									</div>
								</div>
								<div class="flex items-center gap-3 mt-3 md:mt-0">
									<div class="h-9 bg-muted w-24 rounded-md"></div>
								</div>
							</div>
						{/each}
					</div>
				{:else if displayedTrendingModels.length === 0}
					<div class="py-16 text-center text-sm text-muted-foreground">
						No models found matching the filters.
					</div>
				{:else}
					<div class="grid gap-3">
						{#each displayedTrendingModels as model (model.id)}
							{@const isModelInLocal = modelsStore.routerModels.some(
								(m) => m.id === model.id || m.id.startsWith(model.id + ':')
							)}
							{@const tags = getModelTags(model)}
							{@const estimatedRam = getEstimatedRam(model)}
							{@const license = extractLicense(model)}
							{@const sizeInfo = getCatalogModelSize(model.id)}
							{void fetchModelDetails(model.id)}
							<div
								class="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border/20 rounded-xl p-4 bg-card hover:bg-muted/5 transition-colors"
							>
								<div class="flex-1 min-w-0">
									<!-- Top line: Name (basename) -->
									<div class="flex items-center gap-2 mb-1.5">
										<h4
											class="font-bold text-sm truncate text-foreground hover:underline"
											title={model.id}
										>
											<a
												href="https://huggingface.co/{model.id}"
												target="_blank"
												rel="noopener noreferrer"
											>
												{getModelNameOnly(model.id)}
											</a>
										</h4>
									</div>

									<!-- Second line: Color-coded tags -->
									<div class="flex flex-wrap gap-1.5 mb-2">
										{#each tags as tag}
											<span
												class="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide {tag.className}"
											>
												{tag.text}
											</span>
										{/each}
									</div>

									<!-- Third line: Metadata line separated by centered dots -->
									<div
										class="flex items-center gap-x-2 text-[11px] text-muted-foreground flex-wrap"
									>
										<span>{formatPipelineTag(model.pipeline_tag)}</span>
										{#if license}
											<span>·</span>
											<span>{license}</span>
										{/if}
										{#if sizeInfo}
											<span>·</span>
											<span class="font-semibold text-neutral-700 dark:text-neutral-300"
												>{sizeInfo}</span
											>
										{/if}
										<span>·</span>
										<span class="flex items-center gap-0.5">
											<Download class="h-3 w-3 inline text-slate-400" />
											{model.downloads.toLocaleString()}
										</span>
										<span>·</span>
										<span class="flex items-center gap-0.5">
											<Heart class="h-3 w-3 inline text-neutral-500 fill-neutral-500/20" />
											{model.likes.toLocaleString()}
										</span>
									</div>
								</div>

								<!-- Right-hand side: Button & RAM requirement -->
								<div class="flex flex-col items-end gap-1.5 justify-center self-end md:self-center">
									<div>
										{#if isModelInLocal}
											<div
												class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400 text-xs font-semibold px-3 py-1.5"
											>
												<CheckCircle2 class="h-4 w-4" /> Downloaded
											</div>
										{:else}
											<Button
												size="sm"
												variant="outline"
												onclick={() => startDownload(model.id)}
												class="flex items-center gap-1.5 hover:bg-primary hover:text-primary-foreground border-border/50 min-w-[100px] justify-center"
											>
												<Download class="h-3.5 w-3.5" /> Download
											</Button>
										{/if}
									</div>
									<!-- Estimated RAM Requirement -->
									<span class="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 mr-2"
										>{estimatedRam}</span
									>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<SwarmDialog bind:open={showSwarmConfig} onsaved={loadSwarmConfigs} />

	<!-- Architecture Graph Flow Dialog -->
	<Dialog.Root bind:open={showGraphConfig}>
		<Dialog.Content class="sm:max-w-[700px] w-full">
			<Dialog.Header>
				<Dialog.Title>Architecture Flow (Mermaid)</Dialog.Title>
				<Dialog.Description>
					A visual representation of the BIG-LITTLE routing logic.
				</Dialog.Description>
			</Dialog.Header>
			<div class="overflow-auto max-h-[600px] bg-card rounded-md border border-border p-2">
				<MarkdownContent content={`\`\`\`mermaid\n${mermaidString}\n\`\`\``} />
			</div>
			<Dialog.Footer>
				<Button onclick={() => (showGraphConfig = false)}>Close</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<RpcDialog bind:open={showRpcDialog} />

<style>
	:global(.shimmer-pill) {
		position: relative;
		overflow: hidden;
	}
	:global(.shimmer-pill::after) {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 50%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
		animation: shimmer 2s infinite linear;
	}
	@keyframes shimmer {
		100% {
			left: 200%;
		}
	}
</style>
