<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { Terminal as TerminalIcon } from '@lucide/svelte';

	let logs: string[] = $state([]);
	let terminalContainer: HTMLDivElement | null = null;
	let eventSource: EventSource | null = null;
	let autoScroll = $state(true);

	onMount(() => {
		// Initialize SSE connection to the backend logs stream
		const host = window.location.hostname || 'localhost';
		eventSource = new EventSource(`http://${host}:8000/api/logs/stream`);

		eventSource.onmessage = (event) => {
			logs = [...logs, event.data];
			if (logs.length > 2000) {
				// Keep a healthy buffer but allow massive scrollback
				logs = logs.slice(logs.length - 2000);
			}

			if (autoScroll && terminalContainer) {
				setTimeout(() => {
					if (terminalContainer) {
						terminalContainer.scrollTop = terminalContainer.scrollHeight;
					}
				}, 10);
			}
		};

		eventSource.onerror = (error) => {
			console.error('SSE connection error:', error);
			eventSource?.close();
			// Attempt to reconnect after 5 seconds
			setTimeout(() => {
				if (document.visibilityState === 'visible') {
					eventSource = new EventSource(`http://${host}:8000/api/logs/stream`);
				}
			}, 5000);
		};
	});

	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
		}
	});

	function handleScroll() {
		if (terminalContainer) {
			const { scrollTop, scrollHeight, clientHeight } = terminalContainer;
			// If we are within 20px of the bottom, enable autoscroll
			autoScroll = Math.abs(scrollHeight - clientHeight - scrollTop) < 20;
		}
	}
</script>

<div class="w-full p-4 md:p-8 flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">

	<!-- Terminal UI Container -->
	<div
		class="relative flex-1 bg-[#f3f4f6] border border-[#d1d5db] rounded-xl shadow-2xl overflow-hidden flex flex-col"
	>
		<!-- Mac-style Window Header -->
		<div
			class="h-10 bg-[#d1d5db] border-b border-[#9ca3af] flex items-center px-4 justify-between select-none"
		>
			<div class="flex gap-2">
				<div class="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
				<div class="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
				<div class="w-3 h-3 rounded-full bg-[#27c93f]"></div>
			</div>
			<div class="text-[10px] font-mono text-[#4b5563] uppercase tracking-widest">
				llama-server &mdash; bash
			</div>
			<div class="w-16"></div>
			<!-- Spacer for centering -->
		</div>

		<!-- Log Content -->
		<div
			class="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-[#1f2937] whitespace-pre-wrap select-text break-words"
			bind:this={terminalContainer}
			onscroll={handleScroll}
		>
			{#if logs.length === 0}
				<div class="flex h-full items-center justify-center opacity-50">
					Connecting to stream...
				</div>
			{:else}
				{#each logs as log}
					<div>{log}</div>
				{/each}
			{/if}
		</div>

		<!-- Auto-scroll indicator -->
		{#if !autoScroll && logs.length > 0}
			<button
				class="absolute bottom-6 right-6 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-full shadow-lg hover:bg-primary/90 transition-all opacity-90"
				onclick={() => {
					autoScroll = true;
					if (terminalContainer) terminalContainer.scrollTop = terminalContainer.scrollHeight;
				}}
			>
				Scroll to bottom
			</button>
		{/if}
	</div>
</div>
