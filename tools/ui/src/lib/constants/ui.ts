import { Search, Settings, SquarePen, Activity, Files, Terminal, Newspaper, Smartphone, Bot } from '@lucide/svelte';
import McpLogo from '$lib/components/app/mcp/McpLogo.svelte';
import type { Component } from 'svelte';
import { ROUTES } from './routes';

export const FORK_TREE_DEPTH_PADDING = 8;
export const SYSTEM_MESSAGE_PLACEHOLDER = 'System message';

export const ICON_STRIP_TRANSITION_DURATION = 150;
export const ICON_STRIP_TRANSITION_DELAY_MULTIPLIER = 50;

export interface DesktopIconStripItem {
	icon: Component;
	tooltip: string;
	route?: string;
	activeRouteId?: string;
	activeRoutePrefix?: string;
	activeUrlIncludes?: string;
	keys?: string[];
}

export const SIDEBAR_ACTIONS_ITEMS: DesktopIconStripItem[] = [
	{
		icon: Bot,
		tooltip: 'Agents Chat',
		route: ROUTES.COMPANION,
		activeRouteId: '/companion'
	},
	{ icon: SquarePen, tooltip: 'Models Chat', route: ROUTES.NEW_CHAT, keys: ['shift', 'cmd', 'o'] },
	{ icon: Search, tooltip: 'Search', keys: ['cmd', 'k'] },
	{
		icon: McpLogo,
		tooltip: 'MCP Servers',
		route: ROUTES.MCP_SERVERS,
		activeRouteId: '/mcp-servers'
	},
	{
		icon: Files,
		tooltip: 'Model Management',
		route: ROUTES.MODELS,
		activeRouteId: '/models'
	},
	{
		icon: Activity,
		tooltip: 'Telemetry',
		route: ROUTES.TELEMETRY,
		activeRouteId: '/telemetry'
	},
	{
		icon: Terminal,
		tooltip: 'Live Terminal',
		route: ROUTES.TERMINAL,
		activeRouteId: '/terminal'
	},
	{
		icon: Newspaper,
		tooltip: 'News & Discoveries',
		route: ROUTES.NEWS,
		activeRouteId: '/news'
	},

	{
		icon: Settings,
		tooltip: 'Settings',
		route: `${ROUTES.SETTINGS}/general`,
		activeUrlIncludes: '#/settings'
	}
];
