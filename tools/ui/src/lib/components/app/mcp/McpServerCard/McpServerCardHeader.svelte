<script lang="ts">
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { McpCapabilitiesBadges, McpServerIdentity } from '$lib/components/app/mcp';
	import { MCP_TRANSPORT_LABELS, MCP_TRANSPORT_ICONS } from '$lib/constants';
	import { MCPTransportType } from '$lib/enums';
	import type { MCPServerInfo, MCPCapabilitiesInfo } from '$lib/types';

	interface Props {
		displayName: string;
		faviconUrl?: string | null;
		enabled: boolean;
		disabled?: boolean;
		onToggle: (enabled: boolean) => void;
		serverInfo?: MCPServerInfo;
		capabilities?: MCPCapabilitiesInfo;
		transportType?: MCPTransportType;
		processStatus?: 'running' | 'crashed' | 'unknown';
		uptimeSeconds?: number | null;
	}

	let {
		displayName,
		faviconUrl,
		enabled,
		disabled = false,
		onToggle,
		serverInfo,
		capabilities,
		transportType,
		processStatus = 'unknown',
		uptimeSeconds = null
	}: Props = $props();

	function formatUptime(seconds: number | null): string {
		if (seconds === null) return '';
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		if (hrs > 0) return ` (${hrs}h ${mins}m)`;
		if (mins > 0) return ` (${mins}m)`;
		return ` (< 1m)`;
	}
</script>

<div class="space-y-3">
	<div class="flex items-start justify-between gap-3">
		<div class="flex min-w-0 flex-col gap-3">
			<div class="inline-flex items-center gap-2">
				<McpServerIdentity
					{displayName}
					{faviconUrl}
					{serverInfo}
					iconClass="h-5 w-5"
					iconRounded="rounded"
					nameClass="leading-6 font-medium"
				/>
			</div>

			{#if capabilities || transportType}
				<div class="flex flex-wrap items-center gap-1.5">
					{#if transportType}
						{@const TransportIcon = MCP_TRANSPORT_ICONS[transportType]}
						<Badge variant="secondary" class="h-5 gap-1 px-2 text-[10px] font-medium bg-muted/50 border border-border/50 text-muted-foreground shadow-sm">
							{#if TransportIcon}
								<TransportIcon class="h-3 w-3" />
							{/if}

							{MCP_TRANSPORT_LABELS[transportType] || transportType}
						</Badge>
					{/if}

					{#if capabilities}
						<McpCapabilitiesBadges {capabilities} />
					{/if}

					{#if processStatus === 'running'}
						<Badge variant="secondary" class="h-5 gap-1 px-2 text-[10px] font-medium bg-green-500/10 text-green-600 border border-green-500/20 shadow-sm">
							<div class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
							Running{formatUptime(uptimeSeconds)}
						</Badge>
					{:else if processStatus === 'crashed'}
						<Badge variant="secondary" class="h-5 gap-1 px-2 text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20 shadow-sm">
							<div class="w-1.5 h-1.5 rounded-full bg-destructive"></div>
							Crashed
						</Badge>
					{/if}
				</div>
			{/if}
		</div>

		<div class="flex shrink-0 items-center pl-2">
			<Switch checked={enabled} {disabled} onCheckedChange={onToggle} />
		</div>
	</div>
</div>
