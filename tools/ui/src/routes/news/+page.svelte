<script lang="ts">
	import { onMount } from 'svelte';
	import { ExternalLink, X, RefreshCw } from '@lucide/svelte';
	
	interface NewsItem {
		id: string;
		title: string;
		summary: string;
		full_text: string;
		image_url: string;
		source: string;
		url: string;
		date: string;
		is_internal: boolean;
	}
	
	let newsItems: NewsItem[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	
	let expandedItem: NewsItem | null = $state(null);
	let refreshing = $state(false);

	function getBaseUrl() {
		let port = '8000';
		if (typeof window !== 'undefined' && (window as any).orchestratorPort) {
			port = (window as any).orchestratorPort;
		}
		const host = window.location.hostname;
		const protocol = window.location.protocol === 'app:' ? 'http:' : window.location.protocol;
		return `${protocol}//${host}:${port}`;
	}
	
	onMount(async () => {
		try {
			const baseUrl = getBaseUrl();
			
			const res = await fetch(`${baseUrl}/api/news`);
			if (!res.ok) throw new Error('Failed to fetch news');
			newsItems = await res.json();
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	async function refreshNews() {
		if (refreshing) return;
		refreshing = true;
		try {
			const baseUrl = getBaseUrl();
			const res = await fetch(`${baseUrl}/api/news/refresh`, { method: 'POST' });
			if (!res.ok) throw new Error('Failed to refresh news');
			newsItems = await res.json();
		} catch (e: any) {
			error = e.message;
		} finally {
			refreshing = false;
		}
	}

	function handleExpand(item: NewsItem) {
		expandedItem = item;
	}
	
	function closeExpand() {
		expandedItem = null;
	}
	
	function formatDate(dateStr: string) {
		return new Date(dateStr).toLocaleDateString('en-US', { 
			month: 'short', 
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="h-full w-full overflow-y-auto bg-background/95 p-6 md:p-10 relative">
	<div class="max-w-7xl mx-auto">
		<div class="flex items-start justify-between mb-2">
			<h1 class="text-4xl font-black tracking-tight text-foreground">News & Discoveries</h1>
			<button 
				class="flex items-center gap-2 px-3 py-1.5 bg-card/50 hover:bg-card border border-border/50 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-all {refreshing ? 'opacity-50 cursor-not-allowed' : ''}"
				onclick={refreshNews}
				disabled={refreshing}
			>
				<RefreshCw class="w-4 h-4 {refreshing ? 'animate-spin' : ''}" />
				<span>Refresh</span>
			</button>
		</div>
		<p class="text-muted-foreground mb-8 text-lg">Stay updated with the latest in open weights AI and explore new capabilities.</p>
		
		{#if loading}
			<div class="grid place-items-center h-64">
				<div class="animate-pulse flex flex-col items-center gap-4">
					<div class="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
					<p class="text-muted-foreground">Scanning the neural net...</p>
				</div>
			</div>
		{:else if error}
			<div class="bg-destructive/10 text-destructive p-4 rounded-xl border border-destructive/20 text-center">
				{error}
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{#each newsItems as item}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="group relative flex flex-col bg-card/40 backdrop-blur-md border {item.is_internal ? 'border-primary/50 shadow-[0_0_15px_rgba(236,72,153,0.15)]' : 'border-border'} rounded-2xl overflow-hidden cursor-pointer hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
						onclick={() => handleExpand(item)}
					>
						{#if item.is_internal}
							<div class="absolute top-3 right-3 z-10 bg-primary/90 text-primary-foreground text-[10px] uppercase font-bold px-2 py-1 rounded-full tracking-wider shadow-md backdrop-blur-sm">
								Feature
							</div>
						{/if}
						
						{#if item.image_url}
							<div class="h-48 w-full overflow-hidden bg-muted relative">
								<!-- svelte-ignore a11y_missing_attribute -->
								<img src={item.image_url} class="object-cover w-full h-full transform group-hover:scale-105 transition-transform duration-700 ease-out" />
								<div class="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent"></div>
							</div>
						{:else}
							<div class="h-48 w-full bg-muted flex items-center justify-center border-b border-border">
								<span class="text-4xl">📰</span>
							</div>
						{/if}
						
						<div class="p-5 flex-1 flex flex-col z-10">
							<div class="flex items-center gap-2 text-xs text-muted-foreground mb-3">
								<span class="font-semibold text-foreground/80">{item.source}</span>
								<span>•</span>
								<span>{formatDate(item.date)}</span>
							</div>
							
							<h3 class="text-xl font-bold mb-3 leading-tight group-hover:text-primary transition-colors line-clamp-2">{item.title}</h3>
							<p class="text-muted-foreground text-sm line-clamp-3 mb-4 flex-1">{item.summary}</p>
							
							<div class="flex items-center text-primary text-sm font-semibold mt-auto opacity-0 group-hover:opacity-100 transition-opacity">
								Read More <span class="ml-1 group-hover:translate-x-1 transition-transform">→</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	
	<!-- Expanded Modal -->
	{#if expandedItem}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" onclick={closeExpand}>
			<div class="absolute inset-0 bg-background/80 backdrop-blur-xl"></div>
			
			<div class="relative bg-card w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl border border-border/50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onclick={(e) => e.stopPropagation()}>
				<!-- Close button -->
				<button 
					class="absolute top-4 right-4 z-50 p-2 bg-background/50 hover:bg-background/90 backdrop-blur-sm rounded-full transition-colors border border-border/50"
					onclick={closeExpand}
				>
					<X class="w-5 h-5 text-foreground" />
				</button>
				
				<div class="overflow-y-auto flex-1">
					{#if expandedItem.image_url}
						<div class="w-full h-64 sm:h-80 md:h-96 relative bg-muted">
							<!-- svelte-ignore a11y_missing_attribute -->
							<img src={expandedItem.image_url} class="w-full h-full object-cover" />
							<div class="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"></div>
						</div>
					{/if}
					
					<div class="p-6 md:p-10 -mt-20 relative z-10 max-w-3xl mx-auto">
						<div class="flex items-center gap-3 text-sm font-medium mb-4">
							<span class="bg-primary/10 text-primary px-3 py-1 rounded-full">{expandedItem.source}</span>
							<span class="text-muted-foreground">{formatDate(expandedItem.date)}</span>
						</div>
						
						<h1 class="text-3xl sm:text-4xl md:text-5xl font-black leading-tight mb-8 text-foreground">
							{expandedItem.title}
						</h1>
						
						<div class="prose prose-zinc dark:prose-invert prose-lg max-w-none prose-p:leading-relaxed prose-a:text-primary">
							{#each expandedItem.full_text.split('\n') as paragraph}
								{#if paragraph.trim()}
									<p>{paragraph}</p>
								{/if}
							{/each}
						</div>
						
						{#if expandedItem.url && expandedItem.url !== '#/settings'}
							<div class="mt-12 pt-8 border-t border-border">
								<a href={expandedItem.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-6 py-3 rounded-xl font-semibold transition-colors">
									View Original Source <ExternalLink class="w-4 h-4" />
								</a>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
