import { modelsStore } from '$lib/stores/models.svelte';
import { toast } from 'svelte-sonner';
import { getBaseUrl } from '$lib/utils/get-base-url';
import { personas, type Persona } from './personas';

export interface CompanionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
    hidden?: boolean;
}

// TOOLS handled by the new Node.js Agent Backend

const MAX_CONTEXT_TOKENS = 3072;

const COMPANION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'execute_code',
            description: 'Execute Python code in a sandboxed environment and return stdout/stderr.',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'Python code to execute.' }
                },
                required: ['code']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_web',
            description: 'Search the web using DuckDuckGo and return a summary of results.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query.' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file in the current workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or workspace-relative file path.' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'self_repair',
            description: 'Run a self-repair diagnostic to fix detected issues in the companion system.',
            parameters: { type: 'object', properties: {} }
        }
    }
];

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

function estimateMessageTokens(messages: CompanionMessage[]): number {
    return messages.reduce((sum, m) => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return sum + estimateTokens(text) + 4; // 4 overhead per message
    }, 0);
}

function applyContextWindow(messages: CompanionMessage[]): CompanionMessage[] {
    if (estimateMessageTokens(messages) <= MAX_CONTEXT_TOKENS) return messages;

    const system = messages[0]?.role === 'system' ? messages[0] : null;
    const rest = system ? messages.slice(1) : messages.slice();
    const sysTokens = system ? estimateTokens(system.content as string) + 4 : 0;
    const budget = MAX_CONTEXT_TOKENS - sysTokens - 20; // 20 for truncation marker

    // Keep messages from the end until we exceed budget
    const kept: CompanionMessage[] = [];
    let used = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
        const text = typeof rest[i].content === 'string' ? rest[i].content as string : JSON.stringify(rest[i].content);
        const t = estimateTokens(text) + 4;
        if (used + t > budget) break;
        kept.unshift(rest[i]);
        used += t;
    }

    const result: CompanionMessage[] = [];
    if (system) result.push(system);
    if (kept.length < rest.length) {
        result.push({ role: 'user', content: '[Earlier conversation has been truncated to fit context window.]' });
    }
    result.push(...kept);
    return result;
}

const PERSIST_KEY = 'companion_messages_v1';
const MAX_PERSISTED_MESSAGES = 50;

// Strip markdown and normalise text so TTS receives clean spoken prose
function prepareTtsText(raw: string): string {
    let t = raw;

    // Replace fenced code blocks with a brief spoken label
    t = t.replace(/```[\w]*\n?[\s\S]*?```/g, ' <code block> ');
    t = t.replace(/`[^`]+`/g, (m) => m.slice(1, -1)); // inline code: keep content, strip ticks

    // Markdown formatting
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');  // bold
    t = t.replace(/\*([^*]+)\*/g, '$1');       // italic
    t = t.replace(/_{1,2}([^_]+)_{1,2}/g, '$1'); // underscore bold/italic
    t = t.replace(/~~([^~]+)~~/g, '$1');       // strikethrough
    t = t.replace(/^#{1,6}\s+/gm, '');         // headings
    t = t.replace(/^[-*+]\s+/gm, '');          // unordered list bullets
    t = t.replace(/^\d+\.\s+/gm, '');          // ordered list numbers
    t = t.replace(/!?\[([^\]]*?)\]\([^)]*\)/g, '$1'); // links/images -> label
    t = t.replace(/^>\s+/gm, '');              // blockquotes
    t = t.replace(/\|/g, ' ');                 // table separators

    // Units and technical terms
    t = t.replace(/(\d+)\s*KB/g, '$1 kilobytes');
    t = t.replace(/(\d+)\s*MB/g, '$1 megabytes');
    t = t.replace(/(\d+)\s*GB/g, '$1 gigabytes');
    t = t.replace(/(\d+)\s*ms/g, '$1 milliseconds');
    t = t.replace(/(\d+)\s*px/g, '$1 pixels');
    t = t.replace(/\$([\d.]+)/g, '$1 dollars');
    t = t.replace(/([\d.]+)%/g, '$1 percent');
    t = t.replace(/\bGGUF\b/g, 'G-G-U-F');
    t = t.replace(/\bn_ctx\b/g, 'n-context');
    t = t.replace(/\bLLM\b/g, 'L-L-M');
    t = t.replace(/\bAPI\b/g, 'A-P-I');
    t = t.replace(/https?:\/\/\S+/g, 'link');   // URLs

    // Collapse whitespace
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
}

class CompanionState {
    messages = $state<CompanionMessage[]>([]);
    isThinking = $state(false);
    activeResponse = $state('');

    // Global UI state
    isOpen = $state(false);
    activePersonaId = $state('hal9000');
    wakeWord = $state('hey llama');
    selfImproveContinuous = $state(false);
    activeFile = $state({
        file: 'None',
        path: '',
        lines: 0,
        language: 'Plain Text'
    });
    
    // Voice and personality settings
    selectedVoiceURI = $state('');
    humorLevel = $state(50); // 0 = strict, 100 = sarcastic/humorous
    verbosityLevel = $state(50); // 0 = succinct, 100 = verbose
    
    // getActivePersona getter
    get activePersona(): Persona | undefined {
        return personas.find(p => p.id === this.activePersonaId) || personas[0];
    }
    
    activeAudio = $state<HTMLAudioElement | null>(null);
    isPlayingAudio = $state(false);
    audioCtx: AudioContext | null = null;
    analyser: AnalyserNode | null = null;
    private streamAbortController: AbortController | null = null;
    private ttsAbortController: AbortController | null = null;
    private _initTimerId: ReturnType<typeof setTimeout> | null = null;

    vadSilenceTimeout = $state(1200);
    vadVolumeThreshold = $state(0.02);
    toasts = $state<{ id: string; message: string; type: string }[]>([]);
    isSummarizing = $state(false);
    isVoiceMode = $state(false);

    showToast(message: string, type: 'info' | 'success' | 'warning' = 'info') {
        const id = Math.random().toString(36).substring(2);
        this.toasts.push({ id, message, type });
        setTimeout(() => {
            this.toasts = this.toasts.filter(t => t.id !== id);
        }, 4000);
        
        if (type === 'success') {
            this.playChime('action');
        } else if (type === 'warning') {
            this.playChime('error');
        }
    }

    initAudio() {
        if (typeof window === 'undefined') return;
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new AudioContextClass();
        }
        if (!this.analyser) {
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 128;
            // M5: connect analyser to destination once, not per audio element
            this.analyser.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    stopSpeaking() {
        this.audioQueue = [];
        // Cancel any in-flight TTS prefetch fetches to prevent blob URL leaks
        if (this.ttsAbortController) {
            this.ttsAbortController.abort();
            this.ttsAbortController = null;
        }
        if (this.activeAudio) {
            try {
                this.activeAudio.pause();
            } catch(e) {}
            this.activeAudio = null;
        }
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        this.isPlayingAudio = false;
    }

    constructor() {
        if (typeof window !== 'undefined') {
            try {
                const savedName = localStorage.getItem('companion_name_v2');
                const savedPersona = localStorage.getItem('companion_persona_v2');
                const savedVoice = localStorage.getItem('companion_voice');
                const savedHumor = localStorage.getItem('companion_humor');
                const savedVerbosity = localStorage.getItem('companion_verbosity');
                const savedVadTimeout = localStorage.getItem('companion_vad_timeout');
                const savedVadThreshold = localStorage.getItem('companion_vad_threshold');
                const savedWakeWord = localStorage.getItem('companion_wakeword');
                const savedSelfImprove = localStorage.getItem('companion_self_improve_continuous');
                const savedPersonaId = localStorage.getItem('companion_active_persona');
                if (savedPersonaId) this.activePersonaId = savedPersonaId;
                
                if (savedVoice) this.selectedVoiceURI = savedVoice;
                if (savedHumor) this.humorLevel = parseInt(savedHumor, 10);
                if (savedVerbosity) this.verbosityLevel = parseInt(savedVerbosity, 10);
                if (savedVadTimeout) {
                    const t = parseInt(savedVadTimeout, 10);
                    if (Number.isFinite(t)) this.vadSilenceTimeout = t;
                }
                if (savedVadThreshold) this.vadVolumeThreshold = parseFloat(savedVadThreshold);
                if (savedWakeWord) this.wakeWord = savedWakeWord;
                if (savedSelfImprove) {
                    this.selfImproveContinuous = savedSelfImprove === 'true';
                    // C5: store timer ID so it can be cancelled on destroy/HMR
                    this._initTimerId = setTimeout(() => {
                        this._initTimerId = null;
                        this.toggleSelfImproveContinuous(this.selfImproveContinuous);
                    }, 2000);
                }

                this.restoreMessages();
            } catch (e) {}
        }
    }

    saveSettings() {
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('companion_active_persona', this.activePersonaId);
                localStorage.setItem('companion_voice', this.selectedVoiceURI);
                localStorage.setItem('companion_humor', this.humorLevel.toString());
                localStorage.setItem('companion_verbosity', this.verbosityLevel.toString());
                localStorage.setItem('companion_vad_timeout', this.vadSilenceTimeout.toString());
                localStorage.setItem('companion_vad_threshold', this.vadVolumeThreshold.toString());
                localStorage.setItem('companion_wakeword', this.wakeWord);
            } catch (e) {}
        }
    }

    playChime(type: 'start' | 'stop' | 'action' | 'data' | 'error' | 'summon') {
        const audioCtx = this.audioCtx;
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            const now = audioCtx.currentTime;
            
            if (type === 'start') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.setValueAtTime(659.25, now + 0.1);
                gainNode.gain.setValueAtTime(0.06, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'stop') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
                gainNode.gain.setValueAtTime(0.06, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'action') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(659.25, now);
                osc.frequency.setValueAtTime(987.77, now + 0.08);
                osc.frequency.setValueAtTime(1318.51, now + 0.16);
                gainNode.gain.setValueAtTime(0.04, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
            } else if (type === 'data') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(880, now);
                gainNode.gain.setValueAtTime(0.015, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
            } else if (type === 'error') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(330, now);
                osc.frequency.setValueAtTime(220, now + 0.12);
                gainNode.gain.setValueAtTime(0.04, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);
            } else if (type === 'summon') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
                gainNode.gain.setValueAtTime(0.06, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);
            }
        } catch (e) {
            console.error("Synthesizer chime failed", e);
        }
    }

    open() {
        if (!this.isOpen) {
            this.isOpen = true;
            this.initAudio();
            this.playChime('summon');
            setTimeout(() => {
                this.triggerWelcome();
            }, 2000);
        }
    }

    close() {
        this.isOpen = false;
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('companion_dismissed', '1');
        }
    }

    private compilePersona(): string {
        const active = this.activePersona;
        let compiled = active ? active.prompt : "You are a highly capable AI assistant.";

        // Live context injection
        const now = new Date();
        compiled += `\n\nCurrent date/time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`;

        if (this.activeFile && this.activeFile.path) {
            compiled += `\nActive file in editor: ${this.activeFile.file} (${this.activeFile.language}, ${this.activeFile.lines} lines).`;
        }

        if (this.isVoiceMode) {
            compiled += "\nThe user is interacting via voice. Respond in plain spoken language only - no markdown, no bullet points, no code blocks unless explicitly asked. Keep responses under 3 sentences unless the user asks for detail.";
        }

        if (this.humorLevel < 20) {
            compiled += " You must be extremely strict, formal, and devoid of any humor or emotion.";
        } else if (this.humorLevel > 80) {
            compiled += " You must be highly sarcastic, witty, and humorous in your responses.";
        } else if (this.humorLevel > 60) {
            compiled += " You should have a dry wit and occasional sarcasm.";
        }

        // Verbosity modifier
        if (this.verbosityLevel < 20) {
            compiled += " KEEP YOUR ANSWERS EXTREMELY SUCCINCT, SHORT, AND TO THE POINT. NEVER EXCEED 2 SENTENCES.";
        } else if (this.verbosityLevel < 40) {
            compiled += " Keep your answers brief and concise.";
        } else if (this.verbosityLevel > 80) {
            compiled += " Provide highly detailed, verbose, and explanatory responses.";
        }

        return compiled;
    }

    private getMessageContext(): CompanionMessage[] {
        const system: CompanionMessage = {
            role: 'system',
            content: this.compilePersona()
        };
        const res = [system, ...this.messages];
        return applyContextWindow(res);
    }

    setPersona() {
        const persona = this.compilePersona();
        if (this.messages.length === 0 || this.messages[0].role !== 'system') {
            this.messages.unshift({ role: 'system', content: persona });
        } else {
            this.messages[0].content = persona;
        }
    }

    async sendMessage(text: string, imageBase64?: string | null) {
        // Stop any ongoing speech immediately when user sends a new message
        this.stopSpeaking();
        this.setPersona();
        
        let content: any = text;
        const lowerText = text.toLowerCase();
        
        if ((lowerText.includes("this file") || lowerText.includes("active code")) && this.activeFile && this.activeFile.path) {
            try {
                const endpoint = `${getBaseUrl('orchestrator')}/v1/workspace/file_content?path=${encodeURIComponent(this.activeFile.path)}`;
                
                const res = await fetch(endpoint);
                if (res.ok) {
                    const data = await res.json();
                    if (data.content) {
                        content = `The user is asking about the active file: ${this.activeFile.file} (path: ${this.activeFile.path})\n\n[FILE CONTENT]\n\`\`\`\n${data.content}\n\`\`\`\n\nUser Question: ${text}`;
                        this.showToast("ACTIVE CODE INJECTED", "info");
                    }
                }
            } catch (e) {
                console.error("Failed to inject active file context", e);
            }
        }
        
        let messageContent: any = content;
        if (imageBase64) {
            messageContent = [
                { type: 'text', text: typeof content === 'string' ? content : text },
                { type: 'image_url', image_url: { url: imageBase64 } }
            ];
        }
        
        this.messages.push({ role: 'user', content: messageContent });
        this.persistMessages();
        await this.streamLLMResponse(0, true);
    }

    async triggerWelcome(retries = 5): Promise<void> {
        // Skip welcome if there are already persisted messages
        if (this.messages.filter(m => m.role !== 'system').length > 0) return;
        this.setPersona();
        const p = this.activePersona;
        this.messages.push({ 
            role: 'user', 
            content: `The user has just activated you. Give a very brief, unique, and in-character greeting introducing yourself as ${p?.name || 'an AI'}, the ${p?.title || 'assistant'}. Do not be overly verbose.`,
            hidden: true
        });
        try {
            await this.streamLLMResponse(0, false);
        } catch (e: any) {
            // Orchestrator may still be starting up - retry silently
            if (retries > 0 && (e?.message?.includes('fetch') || e?.message?.includes('network') || e?.name === 'TypeError')) {
                this.messages = this.messages.filter(m => m.role !== 'user' || !m.content.toString().includes('just activated'));
                await new Promise(r => setTimeout(r, 2000));
                return this.triggerWelcome(retries - 1);
            }
        }
    }

    private audioQueue: string[] = [];

    // Prefetch the TTS audio for a text chunk - returns a ready-to-play Audio element
    private async fetchTtsAudio(text: string, signal?: AbortSignal): Promise<HTMLAudioElement | null> {
        const spoken = prepareTtsText(text);
        if (!spoken || spoken === '<code block>') return null;

        const cleanText = spoken.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '');
        const commonPhrases = ['thinking', 'understood', 'lets see', 'processing', 'analyzing', 'on it', 'hello', 'goodbye', 'yes', 'no'];
        if (commonPhrases.includes(cleanText)) return null; // handled by web speech

        try {
            const endpoint = `${getBaseUrl('orchestrator')}/v1/tts`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: spoken, voice: this.selectedVoiceURI || 'en_GB-alan-medium' }),
                signal
            });
            if (!res.ok) return null;

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.crossOrigin = 'anonymous';

            // Playback rate based on text sentiment
            const lower = spoken.toLowerCase();
            if (spoken.includes('!') || lower.includes('perfect') || lower.includes('great') || lower.includes('foolproof') || lower.includes('incapable')) {
                audio.playbackRate = 1.08;
            } else if (spoken.includes('?') || lower.includes('why') || lower.includes('how')) {
                audio.playbackRate = 1.04;
            } else if (spoken.includes('...') || lower.includes('sorry')) {
                audio.playbackRate = 0.92;
            }

            // Pre-buffer: trigger browser to start loading the audio data
            audio.preload = 'auto';
            audio.load();
            return audio;
        } catch (e: any) {
            if (e?.name !== 'AbortError') console.warn('TTS prefetch failed', e);
            return null;
        }
    }

    private async processAudioQueue() {
        if (this.isPlayingAudio || this.audioQueue.length === 0) return;
        this.isPlayingAudio = true;

        // Fresh abort controller for this batch of prefetch fetches
        this.ttsAbortController = new AbortController();
        const signal = this.ttsAbortController.signal;

        // Kick off a prefetch for the first chunk immediately
        let prefetch: Promise<HTMLAudioElement | null> | null =
            this.audioQueue.length > 0 ? this.fetchTtsAudio(this.audioQueue[0], signal) : null;

        while (this.audioQueue.length > 0) {
            const text = this.audioQueue.shift();
            if (!text) continue;

            // Await the prefetch that was started for this chunk
            const prebuilt = prefetch ? await prefetch : null;

            // Immediately kick off prefetch for the NEXT chunk while we play the current one
            prefetch = this.audioQueue.length > 0
                ? this.fetchTtsAudio(this.audioQueue[0], signal)
                : null;

            if (prebuilt) {
                await this.playAudioElement(prebuilt, text);
            } else {
                // Fallback: common phrase, fetch failed, or code block - use web speech
                const spoken = prepareTtsText(text);
                if (spoken && spoken !== '<code block>') await this.speakViaSynthesis(spoken);
            }
        }

        this.ttsAbortController = null;
        this.isPlayingAudio = false;
    }

    private async playAudioElement(audio: HTMLAudioElement, _text: string): Promise<void> {
        this.initAudio();
        // Resume AudioContext if browser suspended it (tab switch, idle, etc.)
        if (this.audioCtx?.state === 'suspended') {
            try { await this.audioCtx.resume(); } catch (e) {}
        }
        if (this.activeAudio) {
            try { this.activeAudio.pause(); } catch (e) {}
        }
        this.activeAudio = audio;

        if (this.audioCtx && this.analyser) {
            try {
                const source = this.audioCtx.createMediaElementSource(audio);
                source.connect(this.analyser);
            } catch (e) { /* source already created for this element */ }
        }

        return new Promise<void>((resolve) => {
            const blobUrl = audio.src;
            audio.onended = () => { URL.revokeObjectURL(blobUrl); resolve(); };
            audio.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
            audio.play().catch(() => resolve());
        });
    }

    private async speakViaSynthesis(text: string): Promise<void> {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        const active = this.activePersona;
        return new Promise<void>((resolve) => {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            
            const setVoiceAndSpeak = () => {
                const voices = window.speechSynthesis.getVoices();
                let matchingVoice = voices.find(v => v.voiceURI === this.selectedVoiceURI);
            
                // If no specific override, use the persona's voice regex
                if (!matchingVoice && active && active.voiceSettings.voiceRegex) {
                    matchingVoice = voices.find(v => active.voiceSettings.voiceRegex.test(v.name));
                }
            
                if (matchingVoice) utterance.voice = matchingVoice;
                utterance.pitch = active ? active.voiceSettings.pitch : 1;
                utterance.rate = active ? active.voiceSettings.rate : 1.3;
                
                utterance.onend = () => resolve();
                utterance.onerror = () => resolve();
                window.speechSynthesis.speak(utterance);
            };
            
            if (window.speechSynthesis.getVoices().length === 0) {
                window.speechSynthesis.addEventListener('voiceschanged', setVoiceAndSpeak, { once: true });
            } else {
                setVoiceAndSpeak();
            }
        });
    }

    speak(text: string) {
        if (!text.trim()) return;
        this.audioQueue.push(text);
        void this.processAudioQueue().catch(() => { this.isPlayingAudio = false; });
    }

    private async streamLLMResponse(depth = 0, isUserInitiated = false) {
        if (depth > 3) {
            this.messages.push({ role: 'assistant', content: "I've encountered an issue executing my thought process." });
            toast.error(`Error: Exceeded maximum tool execution depth.`);
            this.isThinking = false;
            return;
        }

        // Abort any in-flight stream before starting a new one
        if (this.streamAbortController) {
            this.streamAbortController.abort();
        }
        this.streamAbortController = new AbortController();
        const signal = this.streamAbortController.signal;

        this.isThinking = true;
        this.activeResponse = '';
        
        try {
            const endpoint = `${getBaseUrl('orchestrator')}/v1/chat/completions`;

            let activeModel = 'unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M';
            if (!modelsStore.loadedModelIds.includes(activeModel)) {
                if (modelsStore.selectedModelName) {
                    activeModel = modelsStore.selectedModelName;
                } else if (modelsStore.loadedModelIds.length > 0) {
                    activeModel = modelsStore.loadedModelIds[0];
                } else if (modelsStore.models && modelsStore.models.length > 0) {
                    activeModel = modelsStore.models[0].model;
                }
            }

            if (modelsStore.loadedModelIds.length === 0 && (!activeModel || !activeModel.includes(':'))) {
                const msg = "I cannot fulfill that request until you load an AI model.";
                this.messages.push({ role: 'assistant', content: msg });
                this.activeResponse = msg;
                this.speak(msg);
                return;
            }

            const windowedMessages = this.getMessageContext();

            // Dynamic inference parameters derived from personality sliders
            const temperature = parseFloat((0.4 + (this.humorLevel / 100) * 0.6).toFixed(2));
            const maxTokens = this.verbosityLevel < 30 ? 200 : this.verbosityLevel > 70 ? 1024 : 512;
            const repeatPenalty = 1.05 + (this.humorLevel / 100) * 0.1;

            const modelProps = modelsStore.getModelProps(activeModel);
            const chatTemplate = modelProps?.chat_template ?? '';
            const modelSupportsTools = /tool_call|\[TOOL_CALLS\]|<tool_call|"tools"|ipython|function_calls/i.test(chatTemplate);

            const payload: Record<string, any> = {
                model: activeModel,
                messages: windowedMessages,
                stream: true,
                temperature,
                max_tokens: maxTokens,
                repeat_penalty: repeatPenalty
            };

            if (modelSupportsTools) {
                payload.tools = COMPANION_TOOLS;
                payload.tool_choice = 'auto';
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText);
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder("utf-8");

            let fullContent = "";
            let currentSentence = "";
            let isToolCall = false;
            let toolCallName = "";
            let toolCallArgs = "";
            let toolCallId = "";
            let buffer = "";
            let hasPlayedDataChime = false;

            while (reader) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith("data: ") && trimmedLine !== "data: [DONE]") {
                        try {
                            const data = JSON.parse(trimmedLine.substring(6));
                            const delta = data?.choices?.[0]?.delta;
                            if (!delta) continue;
                            
                            if (delta.tool_calls) {
                                isToolCall = true;
                                if (delta.tool_calls[0].id) toolCallId = delta.tool_calls[0].id;
                                if (delta.tool_calls[0].function?.name) toolCallName += delta.tool_calls[0].function.name;
                                if (delta.tool_calls[0].function?.arguments) toolCallArgs += delta.tool_calls[0].function.arguments;
                            }
                            
                            if (delta.content) {
                                if (!hasPlayedDataChime) {
                                    hasPlayedDataChime = true;
                                    this.playChime('data');
                                }
                                fullContent += delta.content;
                                currentSentence += delta.content;
                                this.activeResponse = fullContent;

                                const trimmed = currentSentence.trimEnd();
                                const lastChar = trimmed.slice(-1);
                                const isHardEnd = (lastChar === '.' || lastChar === '!' || lastChar === '?')
                                    && currentSentence.length >= 60
                                    && !/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|fig|vol|no)\s*$/i.test(trimmed)
                                    && !/\d\.$/.test(trimmed);
                                const isLongEnough = currentSentence.length >= 120;

                                if (isHardEnd || isLongEnough) {
                                    this.speak(currentSentence.trim());
                                    currentSentence = '';
                                }
                            }
                        } catch (e) {}
                    }
                }
            }

            if (currentSentence.trim()) {
                this.speak(currentSentence);
            }

            if (!isToolCall && !modelSupportsTools && fullContent) {
                const jsonBlockMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonBlockMatch) {
                    try {
                        const parsed = JSON.parse(jsonBlockMatch[1].trim());
                        if (parsed.name && typeof parsed.name === 'string') {
                            isToolCall = true;
                            toolCallName = parsed.name;
                            toolCallArgs = JSON.stringify(parsed.arguments ?? parsed.parameters ?? {});
                            toolCallId = 'fallback_0';
                        }
                    } catch {}
                }
            }

            if (isToolCall && toolCallName) {
                this.messages.push({
                    role: 'assistant',
                    content: fullContent || '',
                    tool_calls: [{ id: toolCallId || 'call_0', type: 'function', function: { name: toolCallName, arguments: toolCallArgs } }]
                });

                this.showToast(`TOOL: ${toolCallName.toUpperCase()}`, 'info');

                let toolResult = '';
                try {
                    let args: any = {};
                    try { args = JSON.parse(toolCallArgs); } catch { args = {}; }

                    if (toolCallName === 'execute_code') {
                        const result = await this.executePythonSandbox(args.code || '');
                        toolResult = `stdout: ${result.stdout}\nstderr: ${result.stderr}\nexit_code: ${result.exit_code}`;
                    } else if (toolCallName === 'search_web') {
                        toolResult = await this.searchWeb(args.query || '');
                    } else if (toolCallName === 'read_file') {
                        const res2 = await fetch(`${getBaseUrl('orchestrator')}/v1/workspace/file_content?path=${encodeURIComponent(args.path || '')}`);
                        const data = await res2.json();
                        toolResult = data.content || 'File not found.';
                    } else if (toolCallName === 'self_repair') {
                        const result = await this.runSelfRepair();
                        toolResult = result.message || result.status;
                    }
                } catch (toolErr: any) {
                    toolResult = `Error: ${toolErr?.message || 'Tool execution failed.'}`;
                }

                this.messages.push({ role: 'tool', content: toolResult, tool_call_id: toolCallId || 'call_0', name: toolCallName });
                this.persistMessages();
                await this.streamLLMResponse(depth + 1, isUserInitiated);
                return;
            }

            if (fullContent) {
                this.messages.push({ role: 'assistant', content: fullContent });
                this.persistMessages();
                void this.maybeSummarizeOldMessages();
            }

        } catch (error: any) {
            if (error?.name === 'AbortError') return;
            toast.error(`Error: ${error?.message || "Failed to communicate with agent server."}`);
        } finally {
            this.isThinking = false;
        }
    }

    persistMessages() {
        if (typeof window === 'undefined') return;
        try {
            const toSave = this.messages
                .filter(m => m.role !== 'system')
                .slice(-MAX_PERSISTED_MESSAGES);
            localStorage.setItem(PERSIST_KEY, JSON.stringify(toSave));
        } catch (e) {}
    }

    restoreMessages() {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(PERSIST_KEY);
            if (!raw) return;
            const parsed: CompanionMessage[] = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                this.messages = parsed;
            }
        } catch (e) {}
    }

    clearConversation() {
        this.messages = [];
        if (typeof window !== 'undefined') {
            try { localStorage.removeItem(PERSIST_KEY); } catch (e) {}
        }
    }

    stopGeneration() {
        if (this.streamAbortController) {
            this.streamAbortController.abort();
            this.streamAbortController = null;
        }
        this.isThinking = false;
        this.stopSpeaking();
    }

    async regenerateLastResponse() {
        if (this.isThinking) return;
        const lastIdx = [...this.messages].reverse().findIndex(m => m.role === 'assistant');
        if (lastIdx === -1) return;
        const realIdx = this.messages.length - 1 - lastIdx;
        this.messages.splice(realIdx, 1);
        this.persistMessages();
        this.setPersona();
        await this.streamLLMResponse(0, true);
    }

    private async maybeSummarizeOldMessages() {
        const nonSystem = this.messages.filter(m => m.role !== 'system');
        if (nonSystem.length < 20) return;
        if (estimateMessageTokens(nonSystem) < 2000) return;
        if (this.isSummarizing) return;

        const toSummarize = nonSystem.slice(0, 15);
        const remaining = nonSystem.slice(15);

        this.isSummarizing = true;
        try {
            let activeModel = modelsStore.selectedModelName || (modelsStore.loadedModelIds[0] ?? null);
            if (!activeModel) return;

            const endpoint = `${getBaseUrl('orchestrator')}/v1/chat/completions`;
            const summaryMessages = [
                { role: 'system', content: 'You are a precise summarizer. Summarize the following conversation segment in 3-5 sentences, preserving key facts, decisions, code snippets mentioned, and user preferences. Be terse and factual.' },
                { role: 'user', content: toSummarize.map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') }
            ];

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: activeModel,
                    messages: summaryMessages,
                    stream: false,
                    max_tokens: 300,
                    temperature: 0.3
                })
            });

            if (!res.ok) return;
            const data = await res.json();
            const summary = data?.choices?.[0]?.message?.content?.trim();
            if (!summary) return;

            // Replace the summarized messages with a single memory marker
            const sysMsg = this.messages[0]?.role === 'system' ? [this.messages[0]] : [];
            this.messages = [
                ...sysMsg,
                { role: 'assistant', content: `[MEMORY - earlier conversation summary]: ${summary}` },
                ...remaining
            ];
            this.persistMessages();
        } catch (e) {
            console.warn('Companion: background summarization failed', e);
        } finally {
            this.isSummarizing = false;
        }
    }

    async searchWeb(query: string): Promise<string> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/search_web`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        if (!res.ok) throw new Error('Web search failed');
        const data = await res.json();
        return typeof data.result === 'string' ? data.result : JSON.stringify(data);
    }

    async executePythonSandbox(code: string): Promise<{ stdout: string; stderr: string; exit_code: number }> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/execute_code`;
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Execution failed");
        }
        return await res.json();
    }

    async installMcpPackage(package_name: string, manager: 'npm' | 'pip'): Promise<{ status: string; package: string; stdout: string }> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/mcp/install`;
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ package: package_name, manager })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Installation failed");
        }
        return await res.json();
    }

    async runSelfRepair(): Promise<{ status: string; message: string; patch_file?: string; errors?: string }> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/self_repair`;
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Self-repair execution failed");
        }
        return await res.json();
    }

    async runSelfImprovement(): Promise<{ status: string; message: string; errors?: string }> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/self_improve`;
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Self-improvement execution failed");
        }
        return await res.json();
    }

    async toggleSelfImproveContinuous(enabled: boolean) {
        this.selfImproveContinuous = enabled;
        if (typeof window !== 'undefined') {
            localStorage.setItem('companion_self_improve_continuous', enabled.toString());
            try {
                const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/self_improve/toggle`;
                
                await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                });
            } catch (e) {
                console.error("Failed to sync continuous self-improvement setting with backend", e);
            }
        }
    }

    async getSelfImprovementLogs(): Promise<{ timestamp: number; file: string; type: string }[]> {
        const endpoint = `${getBaseUrl('orchestrator')}/v1/agent/self_improve/logs`;
        
        const res = await fetch(endpoint);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to fetch self-improvement logs");
        }
        return await res.json();
    }

    // C5: cancel the deferred init timer (call from onDestroy or $effect cleanup)
    destroy() {
        if (this._initTimerId !== null) {
            clearTimeout(this._initTimerId);
            this._initTimerId = null;
        }
    }
}

export const companionStore = new CompanionState();
