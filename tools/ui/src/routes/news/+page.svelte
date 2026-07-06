<script lang="ts">
	import { onMount } from 'svelte';
	import { ExternalLink, X, RefreshCw, Zap, ArrowUpRight } from '@lucide/svelte';
	import { getBaseUrl } from '$lib/utils/get-base-url';
	
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

	let internalNews = $derived(newsItems.filter(item => item.is_internal));
	let externalNews = $derived(newsItems.filter(item => !item.is_internal));


	async function fetchNews(isRefresh = false) {
		try {
			if (!isRefresh) loading = true;
			error = '';
			const base = getBaseUrl();
			const endpoint = isRefresh ? `${base}/api/news/refresh` : `${base}/api/news`;
			const res = await fetch(endpoint, { method: isRefresh ? 'POST' : 'GET' });
			if (!res.ok) throw new Error('Failed to fetch news from server.');
			newsItems = await res.json();
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		fetchNews();
	});

	function refreshNews() {
		if (refreshing) return;
		refreshing = true;
		fetchNews(true);
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
	<div class="max-w-[1400px] mx-auto">
		
		<div class="flex items-end justify-between mb-8">

			<button 
				class="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl text-sm font-semibold transition-all shadow-sm {refreshing ? 'opacity-50 cursor-not-allowed' : ''}"
				onclick={refreshNews}
				disabled={refreshing}
			>
				<RefreshCw class="w-4 h-4 {refreshing ? 'animate-spin' : ''}" />
				<span>Refresh Feed</span>
			</button>
		</div>
		
		{#if loading}
			<div class="space-y-12">
				<!-- Hero Skeleton -->
				<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
					<div class="lg:col-span-2 h-[400px] bg-card/40 border border-border/50 rounded-3xl animate-pulse"></div>
					<div class="grid grid-rows-2 gap-6 h-[400px]">
						<div class="bg-card/40 border border-border/50 rounded-3xl animate-pulse"></div>
						<div class="bg-card/40 border border-border/50 rounded-3xl animate-pulse"></div>
					</div>
				</div>
				<!-- Grid Skeleton -->
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
					{#each Array(8) as _}
						<div class="h-[320px] bg-card/40 border border-border/50 rounded-2xl animate-pulse"></div>
					{/each}
				</div>
			</div>
		{:else if error && newsItems.length === 0}
			<div class="flex flex-col items-center justify-center py-20 px-4 text-center">
				<div class="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
					<X class="w-10 h-10 text-destructive" />
				</div>
				<h3 class="text-2xl font-bold text-foreground mb-2">Connection Issue</h3>
				<p class="text-muted-foreground max-w-md mb-8">{error}</p>
				<button 
					class="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/25"
					onclick={refreshNews}
				>
					Try Again
				</button>
			</div>
		{:else}
			<div class="space-y-16 pb-20">
				
				<!-- HERO SECTION: INTERNAL FEATURES -->
				{#if internalNews.length > 0}
					<section>
						<div class="flex items-center gap-2 mb-6">
							<Zap class="w-5 h-5 text-pink-500 fill-pink-500/20" />
							<h3 class="text-xl font-bold uppercase tracking-widest text-foreground">Engine Capabilities</h3>
						</div>
						
						<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-[200px]">
							{#each internalNews as item, i}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div 
									class="group relative flex flex-col bg-card/60 backdrop-blur-2xl border border-white/10 dark:border-white/5 rounded-3xl overflow-hidden cursor-pointer hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(236,72,153,0.3)] transition-all duration-500 ease-out {i === 0 ? 'lg:col-span-2 row-span-2' : 'row-span-1'}"
									onclick={() => handleExpand(item)}
								>
									<!-- Background Glow -->
									<div class="absolute -inset-4 bg-gradient-to-br from-pink-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-500 z-0"></div>
									
									{#if item.image_url}
										<div class="absolute inset-0 z-0">
											<!-- svelte-ignore a11y_missing_attribute -->
											<img src={item.image_url} class="object-cover w-full h-full opacity-60 group-hover:scale-105 transition-transform duration-700 ease-out mix-blend-overlay" />
											<div class="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
										</div>
									{/if}
									
									<div class="absolute top-4 right-4 z-20 bg-pink-500/90 text-white text-[10px] uppercase font-bold px-3 py-1.5 rounded-full tracking-wider shadow-lg backdrop-blur-md border border-white/20">
										Featured
									</div>
									
									<div class="relative z-10 p-6 sm:p-8 flex-1 flex flex-col justify-end">
										<h3 class="font-black leading-tight text-foreground group-hover:text-pink-400 transition-colors {i === 0 ? 'text-3xl sm:text-4xl mb-4' : 'text-xl sm:text-2xl mb-2'}">
											{item.title}
										</h3>
										<p class="text-muted-foreground line-clamp-2 {i === 0 ? 'text-lg sm:text-xl max-w-2xl' : 'text-sm'}">
											{item.summary}
										</p>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- EXTERNAL NEWS GRID -->
				{#if externalNews.length > 0}
					<section>
						<div class="flex items-center gap-2 mb-6">
							<div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
							<h3 class="text-xl font-bold uppercase tracking-widest text-foreground">Latest from the Community</h3>
						</div>
						
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
							{#each externalNews as item}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div 
									class="group relative flex flex-col bg-card/40 backdrop-blur-lg border border-border/60 hover:border-border rounded-2xl overflow-hidden cursor-pointer hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300 h-[380px]"
									onclick={() => handleExpand(item)}
								>
									{#if item.image_url}
										<div class="h-44 w-full overflow-hidden bg-muted/30 relative shrink-0">
											<!-- svelte-ignore a11y_missing_attribute -->
											<img src={item.image_url} class="object-cover w-full h-full transform group-hover:scale-105 transition-transform duration-700 ease-out" />
											<div class="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent"></div>
										</div>
									{:else}
										<div class="h-44 w-full bg-gradient-to-br from-muted/50 to-muted flex items-center justify-center border-b border-border/50 shrink-0 relative overflow-hidden">
											<div class="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-foreground to-transparent"></div>
											<span class="text-5xl opacity-80 drop-shadow-md">📰</span>
										</div>
									{/if}
									
									<div class="p-5 flex flex-col flex-1 z-10 bg-gradient-to-b from-transparent to-card">
										<div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-3">
											<span class="bg-muted px-2 py-1 rounded-md text-foreground/70">{item.source}</span>
											<span>{formatDate(item.date)}</span>
										</div>
										
										<h4 class="text-lg font-bold mb-2 leading-tight group-hover:text-primary transition-colors line-clamp-3">{item.title}</h4>
										<p class="text-muted-foreground text-sm line-clamp-2 mt-auto">{item.summary}</p>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>
	
	<!-- Expanded Modal -->
	{#if expandedItem}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" onclick={closeExpand}>
			<div class="absolute inset-0 bg-background/90 backdrop-blur-md animate-in fade-in duration-300"></div>
			
			<div class="relative bg-card/95 backdrop-blur-xl w-full max-w-4xl max-h-[90vh] rounded-[2rem] shadow-2xl shadow-black/50 border border-white/10 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-8 duration-300" onclick={(e) => e.stopPropagation()}>
				<!-- Close button -->
				<button 
					class="absolute top-4 right-4 z-50 p-3 bg-black/20 hover:bg-black/40 backdrop-blur-md rounded-full transition-all border border-white/10 text-white hover:scale-110"
					onclick={closeExpand}
				>
					<X class="w-5 h-5" />
				</button>
				
				<div class="overflow-y-auto flex-1 custom-scrollbar">
					{#if expandedItem.image_url}
						<div class="w-full h-64 sm:h-80 md:h-96 relative bg-muted shrink-0">
							<!-- svelte-ignore a11y_missing_attribute -->
							<img src={expandedItem.image_url} class="w-full h-full object-cover" />
							<div class="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent"></div>
						</div>
					{:else}
						<div class="w-full h-32 sm:h-48 relative bg-gradient-to-br from-primary/20 to-card shrink-0">
							<div class="absolute inset-0 bg-gradient-to-t from-card to-transparent"></div>
						</div>
					{/if}
					
					<div class="p-8 md:p-12 {expandedItem.image_url ? '-mt-24' : '-mt-16'} relative z-10 max-w-3xl mx-auto">
						<div class="flex items-center gap-3 text-sm font-semibold tracking-wide mb-6">
							<span class="bg-primary text-primary-foreground px-4 py-1.5 rounded-full shadow-md">{expandedItem.source}</span>
							<span class="text-muted-foreground px-2 py-1 bg-muted/50 rounded-full border border-border/50">{formatDate(expandedItem.date)}</span>
						</div>
						
						<h1 class="text-3xl sm:text-4xl md:text-5xl font-black leading-tight mb-8 text-foreground tracking-tight">
							{expandedItem.title}
						</h1>
						
						<div class="prose prose-zinc dark:prose-invert prose-lg md:prose-xl max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-a:text-primary hover:prose-a:text-primary/80 transition-colors">
							{#each expandedItem.full_text.split('\n') as paragraph}
								{#if paragraph.trim()}
									<p>{paragraph}</p>
								{/if}
							{/each}
						</div>
						
						{#if expandedItem.url && expandedItem.url !== '#/settings'}
							<div class="mt-16 pt-8 border-t border-border/50 flex justify-center">
								<a href={expandedItem.url} target="_blank" rel="noopener noreferrer" class="group inline-flex items-center gap-3 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-8 py-4 rounded-2xl font-bold transition-all shadow-md hover:shadow-xl hover:-translate-y-1">
									Read Original Article <ArrowUpRight class="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
								</a>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 8px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: rgba(150, 150, 150, 0.3);
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: rgba(150, 150, 150, 0.5);
	}
</style>
