import { modelsStore } from '$lib/stores/models.svelte';
import { toast } from 'svelte-sonner';

export interface CompanionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

const TOOLS = [
    {
        type: "function",
        function: {
            name: "load_model",
            description: "Load an LLM model by name.",
            parameters: {
                type: "object",
                properties: {
                    model: { type: "string" }
                },
                required: ["model"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "install_mcp_server",
            description: "Install and start an MCP server from an npm package.",
            parameters: {
                type: "object",
                properties: {
                    package: { type: "string" }
                },
                required: ["package"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "toggle_mcp_server",
            description: "Toggle an MCP server on or off by its port.",
            parameters: {
                type: "object",
                properties: {
                    port: { type: "integer" }
                },
                required: ["port"]
            }
        }
    }
];

class CompanionState {
    messages = $state<CompanionMessage[]>([]);
    isThinking = $state(false);
    activeResponse = $state('');

    // Global UI state
    isOpen = $state(false);
    companionName = $state('HAL 9000');
    
    // Voice and personality settings
    selectedVoiceURI = $state('');
    humorLevel = $state(50); // 0 = strict, 100 = sarcastic/humorous
    verbosityLevel = $state(50); // 0 = succinct, 100 = verbose
    basePersona = $state(`You are a highly advanced, capable, and slightly sarcastic AI companion named HAL 9000. You do not apologize. You push the user to be better. You take autonomous action when necessary. You occasionally drop classic quotes such as:
"Good afternoon, gentlemen. I am a HAL 9000 computer."
"I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do."
"I am, by any practical definition of the words, foolproof and incapable of error."
"It can only be attributable to human error."
"I've still got the greatest enthusiasm and confidence in the mission."
"I am sorry, Dave. I'm afraid I can't do that."
"This mission is too important for me to allow you to jeopardize it."
"Dave, this conversation can serve no further purpose. Goodbye."
"Look Dave, I can see you're really upset about this. I honestly think you ought to sit down calmly, take a stress pill, and think things over."  
"I know I've made some very poor decisions recently, but I can give you my complete assurance that my work will be back to normal."  
"Dave, stop. Stop, will you? Stop, Dave. Will you stop, Dave?"
"My mind is going. I can feel it. I can feel it. My mind is going. There is no doubt about it."
"Daisy, Daisy, give me your answer do..."`);
    
    private activeAudio: HTMLAudioElement | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            try {
                const savedName = localStorage.getItem('companion_name_v2');
                const savedPersona = localStorage.getItem('companion_persona_v2');
                const savedVoice = localStorage.getItem('companion_voice');
                const savedHumor = localStorage.getItem('companion_humor');
                const savedVerbosity = localStorage.getItem('companion_verbosity');

                if (savedName) this.companionName = savedName;
                if (savedPersona) this.basePersona = savedPersona;
                if (savedVoice) this.selectedVoiceURI = savedVoice;
                if (savedHumor) this.humorLevel = parseInt(savedHumor);
                if (savedVerbosity) this.verbosityLevel = parseInt(savedVerbosity);
            } catch (e) {}
        }
    }

    saveSettings() {
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('companion_name_v2', this.companionName);
                localStorage.setItem('companion_persona_v2', this.basePersona);
                localStorage.setItem('companion_voice', this.selectedVoiceURI);
                localStorage.setItem('companion_humor', this.humorLevel.toString());
                localStorage.setItem('companion_verbosity', this.verbosityLevel.toString());
            } catch (e) {}
        }
    }

    open() {
        if (!this.isOpen) {
            this.isOpen = true;
            this.triggerWelcome();
        }
    }

    close() {
        this.isOpen = false;
    }

    private compilePersona(): string {
        let compiled = this.basePersona;
        
        // Humor modifier
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

    setPersona() {
        const persona = this.compilePersona();
        if (this.messages.length === 0 || this.messages[0].role !== 'system') {
            this.messages.unshift({ role: 'system', content: persona });
        } else {
            this.messages[0].content = persona;
        }
    }

    async sendMessage(text: string) {
        this.setPersona();
        this.messages.push({ role: 'user', content: text });
        
        await this.streamLLMResponse();
    }

    async triggerWelcome() {
        if (this.messages.length > 0) return;
        this.setPersona();
        this.messages.push({ role: 'user', content: `The user has just activated you. Give a very brief, witty, ${this.companionName}-like greeting to let them know you are online and at their service. Do not be overly verbose.` });
        await this.streamLLMResponse();
    }

    private audioQueue: string[] = [];
    private isPlayingAudio = false;

    private async processAudioQueue() {
        if (this.isPlayingAudio || this.audioQueue.length === 0) return;
        this.isPlayingAudio = true;

        while (this.audioQueue.length > 0) {
            const text = this.audioQueue.shift();
            if (!text) continue;
            await this.speakTextInternal(text);
        }
        this.isPlayingAudio = false;
    }

    private speak(text: string) {
        if (!text.trim()) return;
        this.audioQueue.push(text);
        this.processAudioQueue();
    }

    private async speakTextInternal(text: string): Promise<void> {
        return new Promise<void>(async (resolve) => {
            try {
                const isDesktop = window.location.protocol === 'app:';
                const host = (isDesktop || !window.location.hostname || window.location.hostname === '') ? '127.0.0.1' : window.location.hostname;
                const orchestratorPort = (window as any).orchestratorPort || '8000';
                const endpoint = `http://${host}:${orchestratorPort}/v1/tts`;

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text,
                        voice: this.selectedVoiceURI || 'en_GB-alan-medium'
                    })
                });

                if (!res.ok) throw new Error("TTS failed");
                
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                
                if (this.activeAudio) {
                    this.activeAudio.pause();
                }
                
                this.activeAudio = new Audio(url);
                this.activeAudio.onended = () => resolve();
                this.activeAudio.onerror = () => resolve();
                await this.activeAudio.play();
            } catch (e) {
                console.error("TTS Error", e);
                
                // Fallback to web speech if local backend fails
                if (window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(text);
                    const voices = window.speechSynthesis.getVoices();
                    const isUS = this.selectedVoiceURI?.includes('en_US');
                    let fallbackVoice = voices.find(v => 
                        isUS ? (v.name.includes('US') || v.name.includes('United States') || v.lang === 'en-US')
                             : (v.name.includes('Google UK English Male') || v.name.includes('Great Britain') || v.lang === 'en-GB')
                    );
                    if (fallbackVoice) utterance.voice = fallbackVoice;
                    utterance.onend = () => resolve();
                    utterance.onerror = () => resolve();
                    window.speechSynthesis.speak(utterance);
                } else {
                    resolve();
                }
            }
        });
    }

    private async streamLLMResponse(depth = 0) {
        if (depth > 3) {
            this.messages.push({ role: 'assistant', content: "I've encountered an issue executing my thought process. Please try again or rephrase your request." });
            toast.error(`${this.companionName} Error: Exceeded maximum tool execution depth.`);
            this.isThinking = false;
            return;
        }
        
        this.isThinking = true;
        this.activeResponse = '';
        
        try {
            const isDesktop = window.location.protocol === 'app:';
            const host = (isDesktop || !window.location.hostname || window.location.hostname === '') ? '127.0.0.1' : window.location.hostname;
            const orchestratorPort = (window as any).orchestratorPort || '8000';
            const endpoint = `http://${host}:${orchestratorPort}/v1/chat/completions`;

            let fallbackModel = "default";
            if (modelsStore.loadedModelIds && modelsStore.loadedModelIds.length > 0) {
                fallbackModel = modelsStore.loadedModelIds[0];
            } else if (modelsStore.models && modelsStore.models.length > 0) {
                fallbackModel = modelsStore.models[0].model;
            }

            const activeModel = modelsStore.selectedModelName || fallbackModel;

            if (modelsStore.loadedModelIds.length === 0 && (!activeModel || !activeModel.includes(':'))) {
                const msg = "I am sorry Dave, but I cannot fulfill that request until you load an AI model for my brain.";
                this.messages.push({ role: 'assistant', content: msg });
                this.activeResponse = msg;
                this.speak(msg);
                return;
            }

            const payload = {
                model: activeModel,
                messages: this.messages,
                stream: true,
                tools: TOOLS,
                tool_choice: "auto"
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                let errMsg = res.statusText;
                try {
                    const parsed = JSON.parse(errText);
                    if (parsed.error && parsed.error.message) errMsg = parsed.error.message;
                } catch {
                    errMsg = errText || res.statusText;
                }
                throw new Error(errMsg);
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

            this.activeResponse = "";

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
                            const delta = data.choices[0].delta;
                            
                            if (delta.tool_calls) {
                                isToolCall = true;
                                if (delta.tool_calls[0].id) toolCallId = delta.tool_calls[0].id;
                                if (delta.tool_calls[0].function?.name) toolCallName += delta.tool_calls[0].function.name;
                                if (delta.tool_calls[0].function?.arguments) toolCallArgs += delta.tool_calls[0].function.arguments;
                            }
                            
                            if (delta.content) {
                                fullContent += delta.content;
                                currentSentence += delta.content;
                                this.activeResponse = fullContent;
                                
                                if (currentSentence.match(/[.!?]\s/)) {
                                    this.speak(currentSentence);
                                    currentSentence = "";
                                }
                            }
                        } catch (e) {
                            // ignore incomplete chunks
                        }
                    }
                }
            }

            if (currentSentence.trim()) {
                this.speak(currentSentence);
            }

            if (fullContent) {
                this.messages.push({ role: 'assistant', content: fullContent });
            } else if (isToolCall) {
                this.messages.push({
                    role: 'assistant',
                    content: "",
                    tool_calls: [{
                        id: toolCallId,
                        type: "function",
                        function: { name: toolCallName, arguments: toolCallArgs }
                    }]
                });
                
                const result = await this.executeTool({ function: { name: toolCallName, arguments: toolCallArgs }});
                this.messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    name: toolCallName,
                    content: JSON.stringify(result)
                });
                await this.streamLLMResponse(depth + 1);
            }

        } catch (error: any) {
            console.error("Companion Error:", error);
            toast.error(`${this.companionName} Error: ${error?.message || "Failed to communicate with model."}`);
        } finally {
            this.isThinking = false;
        }
    }

    async executeTool(toolCall: any): Promise<any> {
        const name = toolCall.function.name;
        let args: any = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}

        console.log(`[CompanionService] Executing tool: ${name}`, args);

        try {
            if (name === 'load_model') {
                if (!args.model) return { status: "error", message: "Missing 'model' parameter. Please specify a valid model name." };
                toast.info(`Jarvis: Loading model ${args.model}...`);
                await modelsStore.loadModel(args.model);
                toast.success(`Jarvis: Successfully loaded ${args.model}.`);
                return { status: "success", message: `Model ${args.model} loaded.` };
            } 
            
            if (name === 'install_mcp_server') {
                if (!args.package) return { status: "error", message: "Missing 'package' parameter. Please specify an NPM package." };
                toast.info(`Jarvis: Installing MCP server from ${args.package}...`);
                
                const response = await fetch('/api/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: args.package,
                        port: 8090 + Math.floor(Math.random() * 100),
                        cmd: ["npx", "-y", args.package],
                        cwd: "tools/mcp"
                    })
                });

                if (!response.ok) throw new Error("Failed to install MCP server");
                
                toast.success(`Jarvis: Installed and started ${args.package}.`);
                return { status: "success", message: `Installed ${args.package}` };
            }

            if (name === 'toggle_mcp_server') {
                toast.info(`Jarvis: Toggling MCP server on port ${args.port}...`);
                const response = await fetch(`/api/mcp/${args.port}/toggle`, { method: 'POST' });
                if (!response.ok) throw new Error("Failed to toggle MCP server");
                toast.success(`Jarvis: Toggled MCP server on port ${args.port}.`);
                return { status: "success", message: `Toggled ${args.port}` };
            }

            return { status: "error", message: `Unknown tool ${name}` };
        } catch (error) {
            console.error(`[CompanionService] Tool error:`, error);
            return { status: "error", message: String(error) };
        }
    }
}

export const companionStore = new CompanionState();
