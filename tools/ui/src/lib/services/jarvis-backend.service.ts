/**
 * Jarvis voice backend client - the conduit between LLaMA Pro and the local
 * Jarvis voice pipeline (wake words, STT, TTS, per-persona memory).
 *
 * The backend runs at http://127.0.0.1:8765 (see jarvis `ui` settings) and
 * mirrors the 11 LLaMA Pro personas; `meta.app_id` on each backend persona
 * links it to the `Persona.id` defined in `personas.ts`.
 *
 * Typical usage:
 *   const backend = new JarvisBackend();
 *   const personas = await backend.listPersonas();
 *   await backend.activatePersona('denisewalsh');
 *   backend.connectEvents((e) => console.log(e.type, e.payload));
 */

export interface JarvisWakeConfig {
    phrase: string;
    model: string;
    threshold: number;
    enabled: boolean;
}

export interface JarvisVoiceConfig {
    voice: string;
    speed: number;
    allowed_emotions: string[];
}

export interface JarvisLlmConfig {
    temperature: number;
    top_p: number;
    max_response_tokens: number;
    style_notes: string;
    model_name?: string;
    mcp_servers?: string[];
}

export interface JarvisMemoryConfig {
    namespace: string;
    auto_remember: boolean;
    working_memory_turns: number;
}

export interface JarvisPersona {
    name: string;
    display_name: string;
    title: string;
    department: string;
    description: string;
    traits: string[];
    system_prompt: string;
    greeting: string;
    voice: JarvisVoiceConfig;
    llm: JarvisLlmConfig;
    memory: JarvisMemoryConfig;
    wake: JarvisWakeConfig;
    meta: Record<string, unknown>;
    builtin: boolean;
}

export interface JarvisStatus {
    active_persona: string;
    session_id: string;
    personas: string[];
    latency: {
        turns: number;
        median_speech_to_audio_ms: number;
        p95_speech_to_audio_ms: number;
        median_first_token_ms: number;
    } | null;
}

export interface JarvisMemoryFact {
    id: number;
    content: string;
}

export interface JarvisEvent {
    type: string;
    payload: unknown;
}

/** Deep-partial helper for PUT payloads. */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export class JarvisBackendError extends Error {
    constructor(
        public readonly status: number,
        detail: string
    ) {
        super(detail);
        this.name = 'JarvisBackendError';
    }
}

export class JarvisBackend {
    private ws: WebSocket | null = null;

    constructor(private readonly baseUrl = 'http://127.0.0.1:8765') {}

    // -- status -------------------------------------------------------------

    async getStatus(): Promise<JarvisStatus> {
        return this.request('GET', '/api/status');
    }

    /** True when the voice backend is reachable. */
    async isOnline(): Promise<boolean> {
        try {
            await this.getStatus();
            return true;
        } catch {
            return false;
        }
    }

    // -- personas -----------------------------------------------------------

    async listPersonas(): Promise<JarvisPersona[]> {
        return this.request('GET', '/api/personas');
    }

    async getPersona(name: string): Promise<JarvisPersona> {
        return this.request('GET', `/api/personas/${encodeURIComponent(name)}`);
    }

    /** Find the backend persona wired to a LLaMA Pro persona id. */
    async findByAppId(appId: string): Promise<JarvisPersona | undefined> {
        const personas = await this.listPersonas();
        return personas.find((p) => p.meta?.['app_id'] === appId);
    }

    /** Create a user-defined persona (name, prompt, voice, wake word...). */
    async createPersona(persona: DeepPartial<JarvisPersona> & { name: string; system_prompt: string }): Promise<JarvisPersona> {
        return this.request('POST', '/api/personas', persona);
    }

    /** Update any subset of a persona's settings (deep-merged server-side). */
    async updatePersona(name: string, patch: DeepPartial<JarvisPersona>): Promise<JarvisPersona> {
        return this.request('PUT', `/api/personas/${encodeURIComponent(name)}`, patch);
    }

    /** Delete a user persona, or revert a customized builtin to defaults. */
    async deletePersona(name: string): Promise<void> {
        await this.request('DELETE', `/api/personas/${encodeURIComponent(name)}`);
    }

    /** Make this persona the active speaker/listener. */
    async activatePersona(name: string): Promise<string> {
        const result = await this.request<{ active_persona: string }>(
            'POST',
            `/api/personas/${encodeURIComponent(name)}/activate`
        );
        return result.active_persona;
    }

    // -- per-persona memory ---------------------------------------------------

    async getMemory(name: string, kind?: 'semantic' | 'episodic'): Promise<JarvisMemoryFact[]> {
        const query = kind ? `?kind=${kind}` : '';
        return this.request('GET', `/api/personas/${encodeURIComponent(name)}/memory${query}`);
    }

    async addMemory(name: string, content: string, kind: 'semantic' | 'episodic' = 'semantic'): Promise<void> {
        await this.request('POST', `/api/personas/${encodeURIComponent(name)}/memory`, { content, kind });
    }

    async clearMemory(name: string): Promise<void> {
        await this.request('DELETE', `/api/personas/${encodeURIComponent(name)}/memory`);
    }

    // -- global settings ------------------------------------------------------

    async getSettings(): Promise<Record<string, unknown>> {
        return this.request('GET', '/api/settings');
    }

    /** Persist settings (deep-merged); most changes need a backend restart. */
    async updateSettings(patch: Record<string, unknown>): Promise<{ saved: boolean; restart_required: boolean }> {
        return this.request('PUT', '/api/settings', patch);
    }

    // -- live events ------------------------------------------------------------

    /**
     * Subscribe to the live event stream (STT partials/finals, LLM tokens,
     * persona switches, interruptions, latency reports). Reconnects
     * automatically until `disconnectEvents()` is called.
     */
    connectEvents(
        onEvent: (event: JarvisEvent) => void,
        onStatus?: (connected: boolean) => void
    ): void {
        const url = this.baseUrl.replace(/^http/, 'ws') + '/ws';
        const open = () => {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => onStatus?.(true);
            this.ws.onmessage = (msg) => {
                try {
                    onEvent(JSON.parse(msg.data as string) as JarvisEvent);
                } catch {
                    /* malformed frame: ignore */
                }
            };
            this.ws.onclose = () => {
                onStatus?.(false);
                if (this.ws !== null) setTimeout(open, 2000);
            };
        };
        open();
    }

    disconnectEvents(): void {
        const ws = this.ws;
        this.ws = null;
        ws?.close();
    }

    // -- internals -----------------------------------------------------------

    /**
     * Pushes the UI's Swarm configurations (Companies) to the backend.
     */
    async syncSwarmConfig(configs: any, activeConfigId: string | null): Promise<{ status: string }> {
        return this.request<{ status: string }>('POST', '/v1/swarm/config', {
            configs,
            active_config_id: activeConfigId
        });
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        let response: Response;
        try {
            response = await fetch(this.baseUrl + path, {
                method,
                headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            let detail = response.statusText;
            try {
                detail = ((await response.json()) as { detail?: string }).detail ?? detail;
            } catch {
                /* non-JSON error body */
            }
            throw new JarvisBackendError(response.status, detail);
        }
        return (await response.json()) as T;
    }
}

export const jarvisBackend = new JarvisBackend();
