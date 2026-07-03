<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { Settings, Mic, SendHorizontal, Bot, X } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Switch } from '$lib/components/ui/switch';
    import { fade, scale } from 'svelte/transition';
    import { companionStore } from '$lib/services/companion.svelte';
    import { modelsStore } from '$lib/stores/models.svelte';
    import { toast } from 'svelte-sonner';
    import { pipeline, env } from '@xenova/transformers';

    let isSettingsOpen = $state(false);
    let inputText = $state('');
    let isListening = $state(false);
    let availableVoices = $state<SpeechSynthesisVoice[]>([]);

    // Transformers.js STT state
    let transcriber: any = null;
    let mediaRecorder: MediaRecorder | null = null;
    let audioChunks: Blob[] = [];

    // Core animation states
    let orbScale = $state(1);
    let orbHue = $state(200); // Blue by default
    let pulseInterval: ReturnType<typeof setInterval>;
    
    // Typewriter effect state
    let typedText = $state('');
    let typewriterInterval: ReturnType<typeof setInterval>;

    $effect(() => {
        const response = companionStore.activeResponse;
        if (response) {
            typedText = '';
            let index = 0;
            if (typewriterInterval) clearInterval(typewriterInterval);
            typewriterInterval = setInterval(() => {
                if (index < response.length) {
                    typedText += response[index];
                    index++;
                } else {
                    clearInterval(typewriterInterval);
                }
            }, 20); // Fast typing speed
        } else {
            typedText = '';
            if (typewriterInterval) clearInterval(typewriterInterval);
        }
    });

    onMount(() => {
        // Create a subtle breathing animation for the orb
        pulseInterval = setInterval(() => {
            if (companionStore.isThinking) {
                orbScale = 1.1 + Math.random() * 0.15;
                orbHue = 260 + Math.random() * 50; // Shift to purple/pink when thinking
            } else if (isListening) {
                orbScale = 1.05 + Math.random() * 0.05;
                orbHue = 140; // Green when listening
            } else {
                // Idle breathing
                orbScale = 0.95 + Math.sin(Date.now() / 1500) * 0.05;
                orbHue = 200 + Math.sin(Date.now() / 5000) * 20; // Slow blue drift
            }
        }, 100);
        
        // Disable local model check for huggingface fetch
        env.allowLocalModels = false;

        if (!companionStore.selectedVoiceURI) {
            companionStore.selectedVoiceURI = 'en_GB-alan-medium';
        }
    });

    onDestroy(() => {
        if (pulseInterval) clearInterval(pulseInterval);
    });

    async function initTranscriber() {
        if (!transcriber) {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        }
    }

    async function toggleListening() {
        if (isListening) {
            mediaRecorder?.stop();
            isListening = false;
        } else {
            inputText = '';
            toast.info("Loading speech recognition model...", { id: 'stt-loading' });
            try {
                await initTranscriber();
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                toast.dismiss('stt-loading');
                
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) audioChunks.push(e.data);
                };
                
                mediaRecorder.onstop = async () => {
                    stream.getTracks().forEach(track => track.stop());
                    if (audioChunks.length === 0) return;
                    
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                    const audioContext = new AudioContextClass({ sampleRate: 16000 });
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const audioData = audioBuffer.getChannelData(0);
                    
                    toast.loading("Transcribing...", { id: 'stt-transcribing' });
                    try {
                        const result = await transcriber(audioData);
                        inputText = result.text.trim();
                        toast.dismiss('stt-transcribing');
                        if (inputText) {
                            handleSubmit();
                        }
                    } catch (err) {
                        toast.dismiss('stt-transcribing');
                        console.error("Transcription error:", err);
                        toast.error("Failed to transcribe audio.");
                    }
                };
                
                mediaRecorder.start();
                isListening = true;
            } catch (err) {
                toast.dismiss('stt-loading');
                console.error("Microphone access error:", err);
                toast.error("Microphone error: Could not access microphone.");
            }
        }
    }

    async function handleSubmit() {
        if (!inputText.trim() || companionStore.isThinking) return;
        
        const text = inputText;
        inputText = '';
        
        await companionStore.sendMessage(text);
    }
    
    function saveSettings() {
        companionStore.saveSettings();
        isSettingsOpen = false;
    }
</script>

{#if companionStore.isOpen}
<div class="fixed inset-0 z-[9999] bg-black/95 overflow-hidden flex flex-col font-sans backdrop-blur-2xl" transition:fade={{duration: 300}}>
    
    <!-- Header -->
    <div class="absolute top-0 w-full p-6 flex justify-between items-center z-50">
        <div class="flex items-center gap-3">
            <Button variant="ghost" size="icon" class="text-white/70 hover:text-white hover:bg-white/10 rounded-full" onclick={() => companionStore.close()}>
                <X class="h-6 w-6" />
            </Button>
            <div class="flex items-center gap-2 text-white/90 font-bold tracking-widest uppercase text-xl">
                <Bot class="h-6 w-6 text-primary" />
                {companionStore.companionName}
            </div>
        </div>
        
        <Button variant="ghost" size="icon" class="text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" onclick={() => isSettingsOpen = true}>
            <Settings class="h-5 w-5" />
        </Button>
    </div>

    <!-- The Immersive Core (Visual Avatar) -->
    <div class="flex-1 flex items-center justify-center relative">
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/40 via-transparent to-transparent"></div>
        
        <!-- The Beating Digital Heart / Orb -->
        <div class="relative flex items-center justify-center transition-all duration-300 ease-out" style="transform: scale({orbScale});">
            
            <div class="absolute w-[400px] h-[400px] rounded-full blur-[100px] opacity-60 mix-blend-screen transition-colors duration-500" 
                 style="background-color: hsl({orbHue}, 100%, 50%);">
            </div>
            
            <div class="absolute w-[250px] h-[250px] rounded-full blur-[50px] opacity-80 mix-blend-screen transition-colors duration-300"
                 style="background-color: hsl({orbHue + 20}, 90%, 60%);">
            </div>
            
            <div class="relative w-[120px] h-[120px] rounded-full bg-white shadow-[0_0_80px_rgba(255,255,255,1)] flex items-center justify-center overflow-hidden">
                <div class="absolute inset-0 bg-gradient-to-br from-white via-white/80 to-transparent mix-blend-overlay"></div>
                <div class="absolute w-full h-full border-[2px] border-black/10 rounded-full {companionStore.isThinking ? 'animate-spin' : ''}" style="animation-duration: 3s;"></div>
                <div class="absolute w-[80%] h-[80%] border-t-[3px] border-r-[3px] border-black/20 rounded-full {isListening ? 'animate-spin' : ''}" style="animation-duration: 1.5s; animation-direction: reverse;"></div>
            </div>
            
        </div>
        
        <!-- Status Text -->
        <div class="absolute bottom-32 text-center w-full">
            {#if companionStore.isThinking}
                <p class="text-white/60 tracking-[0.3em] text-sm uppercase animate-pulse font-medium">Processing Directive...</p>
            {:else if isListening}
                <p class="text-green-400/80 tracking-[0.3em] text-sm uppercase animate-pulse font-medium">Awaiting Audio Input...</p>
            {:else}
                <p class="text-white/30 tracking-[0.3em] text-xs uppercase font-medium">System Idle</p>
            {/if}
        </div>

        <!-- AI Response Text -->
        {#if typedText}
            <div class="absolute bottom-40 w-full flex justify-center px-6" transition:fade>
                <div class="max-w-2xl text-center max-h-32 overflow-y-auto no-scrollbar bg-black/20 backdrop-blur-md border border-white/5 rounded-2xl p-6 shadow-2xl">
                    <p class="text-white/95 text-lg font-medium leading-relaxed drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
                        {typedText}
                    </p>
                </div>
            </div>
        {/if}
    </div>

    <!-- Chat / Command Input Area -->
    <div class="absolute bottom-0 w-full p-6 md:p-10 bg-gradient-to-t from-black via-black/80 to-transparent z-40">
        <div class="max-w-3xl mx-auto">
            <div class="relative flex items-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-2 shadow-2xl focus-within:bg-white/10 focus-within:border-white/20 transition-all duration-300">
                
                <Button 
                    variant="ghost" 
                    size="icon" 
                    class="h-12 w-12 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-colors {isListening ? 'text-green-400 hover:text-green-300 bg-green-400/10' : ''}"
                    onclick={toggleListening}
                >
                    <Mic class="h-5 w-5 {isListening ? 'animate-pulse' : ''}" />
                </Button>
                
                <input 
                    type="text" 
                    bind:value={inputText}
                    onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
                    placeholder="Speak or type a command for {companionStore.companionName}..."
                    class="flex-1 bg-transparent border-none text-white placeholder:text-white/30 focus:outline-none focus:ring-0 px-4 text-lg font-medium"
                />
                
                <Button 
                    variant="default" 
                    size="icon"
                    class="h-12 w-12 rounded-xl bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_20px_rgba(0,210,255,0.3)] transition-all"
                    onclick={handleSubmit}
                    disabled={!inputText.trim() || companionStore.isThinking}
                >
                    <SendHorizontal class="h-5 w-5" />
                </Button>
            </div>
        </div>
    </div>

    <!-- Settings Overlay -->
    {#if isSettingsOpen}
        <div class="absolute inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
            <div class="bg-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-border/50 shadow-2xl p-8 flex flex-col gap-8" transition:scale={{ start: 0.95, duration: 200 }}>
                
                <div class="flex items-center justify-between">
                    <h2 class="text-2xl font-bold text-foreground">HAL 9000 Settings</h2>
                    <Button variant="ghost" size="icon" class="rounded-full" onclick={() => isSettingsOpen = false}>
                        <Settings class="h-5 w-5 text-muted-foreground" />
                    </Button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="space-y-6">
                        <!-- Designation -->
                        <div class="space-y-2.5">
                            <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">System Designation (Name)</Label>
                            <Input bind:value={companionStore.companionName} placeholder="HAL 9000" class="h-12 text-lg font-medium bg-background/50 border-border/50 focus-visible:ring-primary/50" />
                        </div>

                        <!-- Voice Synthesis -->
                        <div class="space-y-2.5">
                            <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">Vocal Synthesis Model (Neural)</Label>
                            <select bind:value={companionStore.selectedVoiceURI} class="w-full h-12 rounded-md border border-border/50 bg-background/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                <optgroup label="British Voices">
                                    <option value="en_GB-alan-medium">Alan (Male)</option>
                                    <option value="en_GB-alan-low">Alan (Male Low)</option>
                                    <option value="en_GB-alba-medium">Alba (Female)</option>
                                    <option value="en_GB-cori-high">Cori (Female High)</option>
                                    <option value="en_GB-cori-medium">Cori (Female Medium)</option>
                                    <option value="en_GB-jenny_dioco-medium">Jenny (Female)</option>
                                    <option value="en_GB-northern_english_male-medium">Northern (Male)</option>
                                    <option value="en_GB-semaine-medium">Semaine (Female)</option>
                                    <option value="en_GB-southern_english_female-low">Southern (Female Low)</option>
                                </optgroup>
                                <optgroup label="American Voices">
                                    <option value="en_US-amy-medium">Amy (Female)</option>
                                    <option value="en_US-arctic-medium">Arctic (Female)</option>
                                    <option value="en_US-cmu-arctic-medium">CMU Arctic (Male)</option>
                                    <option value="en_US-danny-low">Danny (Deep Male)</option>
                                    <option value="en_US-hfc_female-medium">HFC (Female)</option>
                                    <option value="en_US-hfc_male-medium">HFC (Male)</option>
                                    <option value="en_US-joe-medium">Joe (Male)</option>
                                    <option value="en_US-john-medium">John (Male)</option>
                                    <option value="en_US-kathleen-low">Kathleen (Female)</option>
                                    <option value="en_US-kusal-medium">Kusal (Male)</option>
                                    <option value="en_US-kusal-large">Kusal (Male Large)</option>
                                    <option value="en_US-lessac-high">Lessac (Female High)</option>
                                    <option value="en_US-lessac-medium">Lessac (Female)</option>
                                    <option value="en_US-lessac-low">Lessac (Deep Female)</option>
                                    <option value="en_US-libritts-high">Libritts (Female High)</option>
                                    <option value="en_US-ljspeech-high">LJSpeech (Female High)</option>
                                    <option value="en_US-ljspeech-medium">LJSpeech (Female Medium)</option>
                                    <option value="en_US-norman-medium">Norman (Male)</option>
                                    <option value="en_US-ryan-high">Ryan (Male High)</option>
                                    <option value="en_US-ryan-medium">Ryan (Male)</option>
                                    <option value="en_US-ryan-low">Ryan (Male Low)</option>
                                </optgroup>
                            </select>
                        </div>
                        
                        <!-- Wit & Humor -->
                        <div class="space-y-4">
                            <div class="flex justify-between">
                                <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">Wit & Humor Level</Label>
                                <span class="text-xs font-mono">{companionStore.humorLevel}%</span>
                            </div>
                            <input type="range" bind:value={companionStore.humorLevel} min="0" max="100" class="w-full accent-primary" />
                            <div class="flex justify-between text-[10px] text-muted-foreground uppercase">
                                <span>Strict</span>
                                <span>Sarcastic</span>
                            </div>
                        </div>

                        <!-- Verbosity -->
                        <div class="space-y-4">
                            <div class="flex justify-between">
                                <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">Verbosity</Label>
                                <span class="text-xs font-mono">{companionStore.verbosityLevel}%</span>
                            </div>
                            <input type="range" bind:value={companionStore.verbosityLevel} min="0" max="100" class="w-full accent-primary" />
                            <div class="flex justify-between text-[10px] text-muted-foreground uppercase">
                                <span>Succinct</span>
                                <span>Verbose</span>
                            </div>
                        </div>
                    </div>

                    <div class="space-y-6">
                        <!-- Cognitive Persona -->
                        <div class="space-y-2.5">
                            <div class="flex justify-between items-end">
                                <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">Cognitive Persona (Base Prompt)</Label>
                            </div>
                            <Textarea 
                                bind:value={companionStore.basePersona} 
                                placeholder="Define the behavior, tone, and strict rules for this meta-agent..." 
                                class="min-h-[160px] resize-none bg-background/50 border-border/50 focus-visible:ring-primary/50 text-sm leading-relaxed" 
                            />
                            <p class="text-[11px] text-muted-foreground leading-relaxed">
                                Base personality prompt. The sliders will inject additional constraints onto this base.
                            </p>
                        </div>
                        
                        <!-- Advanced Capabilities -->
                        <div class="space-y-4 pt-4 border-t border-border/40">
                            <div class="flex items-center justify-between">
                                <div class="space-y-0.5">
                                    <Label class="text-sm font-semibold">Autonomous MCP Routing</Label>
                                    <p class="text-xs text-muted-foreground">Allow companion to dynamically fetch servers.</p>
                                </div>
                                <Switch checked={true} />
                            </div>
                            <div class="flex items-center justify-between">
                                <div class="space-y-0.5">
                                    <Label class="text-sm font-semibold">Model Swapping</Label>
                                    <p class="text-xs text-muted-foreground">Automatically load/unload LLMs based on task.</p>
                                </div>
                                <Switch checked={true} />
                            </div>
                        </div>
                        
                        <!-- Auto-Load Companion Model -->
                        <div class="space-y-4 pt-4 border-t border-border/20">
                            <div class="flex items-center justify-between">
                                <div class="space-y-0.5">
                                    <Label class="text-xs uppercase tracking-wider text-muted-foreground font-bold">Auto-Load Brain</Label>
                                    <p class="text-[11px] text-muted-foreground">Automatically load Llama-3.2-1B-Instruct on startup so the companion is instantly ready.</p>
                                </div>
                                <Switch 
                                    checked={modelsStore.autoLoadCompanionModelEnabled} 
                                    onCheckedChange={(checked) => modelsStore.setAutoLoadCompanionModel(checked)} 
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end gap-3 pt-4 mt-auto border-t border-border/40">
                    <Button variant="outline" class="rounded-xl border-border/50" onclick={() => isSettingsOpen = false}>Cancel</Button>
                    <Button class="rounded-xl" onclick={saveSettings}>Initialize Preferences</Button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
{/if}
