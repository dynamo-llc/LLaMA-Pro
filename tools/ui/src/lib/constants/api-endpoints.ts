export const API_MODELS = {
	get LIST() { return `${getBaseUrl('llama')}/v1/models`; },
	get LOAD() { return `${getBaseUrl('llama')}/models/load`; },
	get UNLOAD() { return `${getBaseUrl('llama')}/models/unload`; },
	get DOWNLOAD() { return `${getBaseUrl('llama')}/models`; },
	get SSE() { return `${getBaseUrl('llama')}/models/sse`; }
};

import { getBaseUrl } from '../utils/get-base-url';

// chat completion routes, the control route drives realtime inference (e.g. end reasoning)
export const API_CHAT = {
	get COMPLETIONS() { return `${getBaseUrl('orchestrator')}/v1/chat/completions`; },
	get CONTROL() { return `${getBaseUrl('orchestrator')}/v1/chat/completions/control`; }
};

// slot introspection, requires the --slots flag on the server
export const API_SLOTS = {
	get LIST() { return `${getBaseUrl('llama')}/slots`; }
};

export const API_TOOLS = {
	get LIST() { return `${getBaseUrl('llama')}/tools`; },
	get EXECUTE() { return `${getBaseUrl('llama')}/tools`; }
};

/** CORS proxy endpoint path */
export const CORS_PROXY_ENDPOINT = '/cors-proxy';
