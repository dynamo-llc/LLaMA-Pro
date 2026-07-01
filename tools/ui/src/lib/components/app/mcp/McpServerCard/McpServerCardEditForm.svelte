<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { McpServerForm } from '$lib/components/app/mcp';

	interface Props {
		serverId: string;
		serverUrl: string;
		serverName?: string;
		serverUseProxy?: boolean;
		onSave: (url: string, headers: string, useProxy: boolean, name?: string) => void;
		onCancel: () => void;
	}

	let {
		serverId,
		serverUrl,
		serverName = '',
		serverUseProxy = false,
		onSave,
		onCancel
	}: Props = $props();

	import { untrack } from 'svelte';

	let editUrl = $derived(serverUrl);
	let editHeaders = $state('');
	let editName = $state(untrack(() => serverName));
	let editUseProxy = $derived(serverUseProxy);

	let urlError = $derived.by(() => {
		if (!editUrl.trim()) return 'URL is required';
		try {
			new URL(editUrl);
			return null;
		} catch {
			return 'Invalid URL format';
		}
	});

	let canSave = $derived(!urlError);

	function handleSave() {
		if (!canSave) return;
		onSave(editUrl.trim(), editHeaders.trim(), editUseProxy, editName.trim());
	}

	export function setInitialValues(url: string, headers: string, useProxy: boolean, name?: string) {
		editUrl = url;
		editHeaders = headers;
		editUseProxy = useProxy;
		editName = name || '';
	}
</script>

<div class="space-y-4">
	<p class="font-medium">Configure Server</p>

	<McpServerForm
		name={editName}
		url={editUrl}
		headers={editHeaders}
		useProxy={editUseProxy}
		onNameChange={(v) => (editName = v)}
		onUrlChange={(v) => (editUrl = v)}
		onHeadersChange={(v) => (editHeaders = v)}
		onUseProxyChange={(v) => (editUseProxy = v)}
		urlError={editUrl ? urlError : null}
		id={serverId}
	/>

	<div class="flex items-center justify-end gap-2">
		<Button variant="secondary" size="sm" onclick={onCancel}>Cancel</Button>

		<Button size="sm" onclick={handleSave} disabled={!canSave}>
			{serverUrl.trim() ? 'Update' : 'Add'}
		</Button>
	</div>
</div>
