<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { Terminal as TerminalIcon, Copy, Trash2, Save } from '@lucide/svelte';

	let logs: {source: string, text: string}[] = $state([]);
	let terminalContainer: HTMLDivElement | null = null;
	let terminalWrapper: HTMLDivElement | null = null;
	let autoScroll = $state(true);
	let availableHeight = $state(0);

	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		// Measure the parent scroll container height and keep the terminal bounded to it
		const scrollParent = document.querySelector('.main-content-scroll') as HTMLElement | null;
		if (scrollParent) {
			const updateHeight = () => {
				availableHeight = scrollParent.clientHeight;
			};
			updateHeight();
			resizeObserver = new ResizeObserver(updateHeight);
			resizeObserver.observe(scrollParent);
		}

		if (window.electronAPI && window.electronAPI.onBackendLog) {
			window.electronAPI.onBackendLog((logEntry: any) => {
				logs = [...logs, { source: logEntry.source, text: logEntry.data }];
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
			});
		} else {
			logs = [{ source: 'system', text: 'Backend logs stream is only available in the Electron desktop app.' }];
		}
	});

	onDestroy(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	function handleScroll() {
		if (terminalContainer) {
			const { scrollTop, scrollHeight, clientHeight } = terminalContainer;
			// If we are within 20px of the bottom, enable autoscroll
			autoScroll = Math.abs(scrollHeight - clientHeight - scrollTop) < 20;
		}
	}

	function copyLogs() {
		const text = logs.map((l) => `[${l.source}] ${l.text}`).join('\n');
		navigator.clipboard.writeText(text);
	}

	async function exportLogs() {
		if (window.electronAPI && window.electronAPI.exportLogs) {
			const text = logs.map((l) => `[${l.source}] ${l.text}`).join('\n');
			await window.electronAPI.exportLogs(text);
		} else {
			alert('Exporting logs is only available in the desktop app.');
		}
	}

	function clearLogs() {
		logs = [];
	}
</script>

<div
	class="w-full p-4 md:p-8 flex flex-col gap-4 overflow-hidden"
	bind:this={terminalWrapper}
	style={availableHeight > 0 ? `height: ${availableHeight}px;` : 'height: 100dvh;'}
>
	<!-- Terminal UI Container -->
	<div
		class="relative flex-1 bg-[#f3f4f6] border border-[#d1d5db] rounded-xl shadow-2xl overflow-hidden flex flex-col min-h-0"
	>
		<!-- Mac-style Window Header -->
		<div
			class="h-10 bg-[#d1d5db] border-b border-[#9ca3af] flex items-center px-4 justify-between select-none shrink-0"
		>
			<div class="flex gap-2 w-24">
				<div class="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
				<div class="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
				<div class="w-3 h-3 rounded-full bg-[#27c93f]"></div>
			</div>
			<div class="text-[10px] font-mono text-[#4b5563] uppercase tracking-widest flex-1 text-center font-bold">
				Developer Console
			</div>
			<div class="flex gap-2 w-24 justify-end">
				<button onclick={exportLogs} class="text-[#4b5563] hover:text-[#2563eb] transition-colors" title="Export Logs">
					<Save size={14} />
				</button>
				<button onclick={copyLogs} class="text-[#4b5563] hover:text-[#1f2937] transition-colors" title="Copy Logs">
					<Copy size={14} />
				</button>
				<button onclick={clearLogs} class="text-[#4b5563] hover:text-[#ef4444] transition-colors" title="Clear Logs">
					<Trash2 size={14} />
				</button>
			</div>
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
					<div class="flex gap-2 hover:bg-black/5 rounded-sm px-1 -mx-1">
						<span class="w-28 shrink-0 text-right opacity-80" class:text-blue-600={log.source === 'llama-server'} class:text-yellow-600={log.source === 'orchestrator'}>
							[{log.source}]
						</span>
						<span class="break-all">{log.text}</span>
					</div>
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
