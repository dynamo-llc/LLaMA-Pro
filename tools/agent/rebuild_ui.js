import fs from 'fs';

const content = `<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { Settings, Mic, SendHorizontal, Bot, X, Menu, SlidersHorizontal, Activity, Cpu, Network, Database, Target, BrainCircuit, Globe, Focus } from '@lucide/svelte';
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
    import * as THREE from 'three';

    let isSettingsOpen = $state(false);
    let inputText = $state('');
    let isListening = $state(false);
    let isPreparingMic = $state(false);
    let isTranscribing = $state(false);
    
    let transcriber: any = null;
    let mediaRecorder: MediaRecorder | null = null;
    let audioChunks: Blob[] = [];

    let typedText = $state('');
    let typewriterInterval: ReturnType<typeof setInterval>;

    let currentTime = $state('00:00:00 UTC');
    let currentDate = $state('JAN 01, 2099');
    let timeInterval: ReturnType<typeof setInterval>;
    let cpuUsage = $state(18);
    let memUsage = $state(100);
    let netUsage = $state(42);
    let ioUsage = $state(27);
    let statsInterval: ReturnType<typeof setInterval>;
    
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData = new Uint8Array(40);
    let eqHeights = $state<number[]>(Array(40).fill(20));
    let reqAnimFrame: number;
    let lastSpeechTime = Date.now();

    let isGlitching = $state(false);
    let videoStream: MediaStream | null = $state(null);
    let videoElement: HTMLVideoElement | null = $state(null);
    let screenStream: MediaStream | null = $state(null);
    let screenVideoElement: HTMLVideoElement | null = $state(null);
    let isDragging = $state(false);
    let isIotActive = $state(false);
    let isIngesting = $state(false);
    
    let canvasRef: HTMLCanvasElement;
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let sphereMesh: THREE.Mesh;
    let animationId: number;

    let motionCanvas: HTMLCanvasElement;
    let isTargetLost = $state(false);
    let motionTimer: ReturnType<typeof setTimeout>;

    let isMicOverride = $state(false);
    let isCameraOverride = $state(false);
    let systemStatus = $state({ mcpServers: [], projects: [], ghostProtocol: false, daemon: false });
    let statusInterval: ReturnType<typeof setInterval>;
    let visionInterval: ReturnType<typeof setInterval>;
    let visionCanvas: HTMLCanvasElement;

    $effect(() => {
        const _ = companionStore.messages;
        const __ = companionStore.activeResponse;
        const ___ = typedText;
        const container = document.getElementById('chat-scroll-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    });

    async function fetchSystemStatus() {
        try {
            const res = await fetch('http://127.0.0.1:3000/v1/system/status');
            if (res.ok) systemStatus = await res.json();
        } catch(e) {}
    }

    async function toggleGhostProtocol(active: boolean) {
        try {
            const res = await fetch('http://127.0.0.1:3000/v1/system/ghost', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active })
            });
            if (res.ok) await fetchSystemStatus();
        } catch (e) {
            toast.error("Failed to toggle Ghost Protocol");
        }
    }

    async function toggleDaemon(active: boolean) {
        try {
            const res = await fetch('http://127.0.0.1:3000/v1/system/daemon', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active })
            });
            if (res.ok) await fetchSystemStatus();
        } catch (e) {
            toast.error("Failed to toggle Daemon Loop");
        }
    }

    function initAudio() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function playType() {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    }

    function playClick() {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    }

    function playHover() {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(1200 + Math.random()*400, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.03);
    }

    function playBeep(duration = 0.2) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    function updateStats() {
        const now = new Date();
        currentTime = now.toISOString().split('T')[1].replace('Z', ' UTC');
        currentDate = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
        
        cpuUsage = Math.min(100, Math.max(0, cpuUsage + (Math.random() * 20 - 10)));
        memUsage = companionStore.isThinking ? 100 : Math.min(100, Math.max(60, memUsage + (Math.random() * 10 - 5)));
        netUsage = Math.min(100, Math.max(0, netUsage + (Math.random() * 40 - 20)));
        ioUsage = companionStore.isThinking ? Math.min(100, ioUsage + 20) : Math.max(0, ioUsage - 5);
        
        if (Math.random() > 0.95) {
            isGlitching = true;
            setTimeout(() => isGlitching = false, 150 + Math.random() * 200);
        }
    }

    function updateEQ() {
        if (analyser && audioCtx?.state === 'running') {
            analyser.getByteFrequencyData(freqData);
            let sum = 0;
            for(let i=0; i<40; i++) {
                eqHeights[i] = Math.max(10, (freqData[i] / 255) * 100);
                sum += freqData[i];
            }
            if (sum > 500) lastSpeechTime = Date.now();
        } else {
            for(let i=0; i<40; i++) {
                eqHeights[i] = Math.max(10, eqHeights[i] - 2);
            }
            if (Date.now() - lastSpeechTime > 1500 && isTranscribing) {
                stopListening();
            }
        }
        reqAnimFrame = requestAnimationFrame(updateEQ);
    }

    async function initTranscriber() {
        if (!transcriber) {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
        }
    }

    async function toggleListening() {
        initAudio();
        if (isListening) {
            stopListening();
            return;
        }

        try {
            isPreparingMic = true;
            await initTranscriber();
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            if (audioCtx) {
                const source = audioCtx.createMediaStreamSource(stream);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 128;
                source.connect(analyser);
            }

            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            
            mediaRecorder.onstop = async () => {
                isListening = false;
                if (!isTranscribing && audioChunks.length > 0) {
                    isTranscribing = true;
                    try {
                        const blob = new Blob(audioChunks, { type: 'audio/webm' });
                        const arrayBuffer = await blob.arrayBuffer();
                        const audioContext = new AudioContext({ sampleRate: 16000 });
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        const audioData = audioBuffer.getChannelData(0);
                        
                        const result = await transcriber(audioData);
                        if (result.text && result.text.trim()) {
                            inputText = result.text.trim();
                            await handleSend();
                        }
                    } catch (e) {
                        toast.error("Speech recognition failed");
                    } finally {
                        isTranscribing = false;
                    }
                }
                stream.getTracks().forEach(t => t.stop());
                if (analyser) {
                    analyser.disconnect();
                    analyser = null;
                }
            };

            mediaRecorder.start();
            isListening = true;
            lastSpeechTime = Date.now();
            playBeep(0.3);
            
        } catch (error) {
            toast.error("Microphone access denied");
        } finally {
            isPreparingMic = false;
        }
    }

    function stopListening() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            playBeep(0.1);
        }
    }

    async function handleSend() {
        if (!inputText.trim() || companionStore.isThinking) return;
        const text = inputText;
        inputText = '';
        playClick();
        await companionStore.sendMessage(text);
    }

    function initThreeJS() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({ canvas: canvasRef, alpha: true, antialias: true });
        renderer.setSize(200, 200);

        const geometry = new THREE.SphereGeometry(1.5, 64, 64);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0xff0000,
            emissive: 0x880000,
            emissiveIntensity: 1,
            roughness: 0.1,
            metalness: 0.8,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            transmission: 0.5,
            thickness: 1.0
        });

        sphereMesh = new THREE.Mesh(geometry, material);
        scene.add(sphereMesh);

        const pointLight = new THREE.PointLight(0xff0000, 10, 100);
        pointLight.position.set(0, 0, 0);
        scene.add(pointLight);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        scene.add(ambientLight);

        let time = 0;
        const animate = () => {
            animationId = requestAnimationFrame(animate);
            time += 0.05;
            
            const targetEmissive = companionStore.isThinking ? 3 : 1;
            material.emissiveIntensity += (targetEmissive - material.emissiveIntensity) * 0.1;
            
            if (isListening || isTranscribing) {
                material.color.setHex(0x00ff00);
                material.emissive.setHex(0x008800);
            } else {
                material.color.setHex(0xff0000);
                material.emissive.setHex(0x880000);
            }
            
            sphereMesh.scale.setScalar(1 + Math.sin(time) * 0.02 * material.emissiveIntensity);
            
            renderer.render(scene, camera);
        };
        animate();
    }

    onMount(() => {
        env.allowLocalModels = false;
        timeInterval = setInterval(updateStats, 1000);
        statsInterval = setInterval(updateStats, 200);
        reqAnimFrame = requestAnimationFrame(updateEQ);
        
        statusInterval = setInterval(fetchSystemStatus, 2000);
        fetchSystemStatus();

        if (!companionStore.companionName) companionStore.companionName = 'HAL 9000';
        if (!companionStore.basePersona) companionStore.basePersona = 'I am a heuristically programmed algorithmic computer...';

        setTimeout(() => {
            initThreeJS();
            playBeep(0.5);
        }, 100);
    });

    onDestroy(() => {
        clearInterval(timeInterval);
        clearInterval(statsInterval);
        clearInterval(statusInterval);
        cancelAnimationFrame(reqAnimFrame);
        if (animationId) cancelAnimationFrame(animationId);
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
        if (renderer) renderer.dispose();
    });
</script>

<svelte:window onmousemove={() => initAudio()} onclick={() => initAudio()} />

{#if companionStore.isOpen}
    <div class="fixed inset-0 z-[9999] bg-[#050505] text-[#ff2a2a] font-mono flex flex-col p-2 select-none overflow-hidden {isGlitching ? 'glitch-mode' : ''}" transition:fade={{duration: 200}}>
        
        <!-- CRT Scanline Overlay -->
        <div class="pointer-events-none fixed inset-0 z-50 opacity-10" style="background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06)); background-size: 100% 4px, 6px 100%;"></div>

        <!-- HEADER -->
        <div class="flex items-center justify-between border-b border-[#ff2a2a]/30 pb-2 shrink-0 z-10 px-2">
            <div class="flex items-center gap-3">
                <BrainCircuit class="w-5 h-5 text-[#ff2a2a] animate-pulse" />
                <div>
                    <h2 class="text-sm font-bold tracking-[0.3em] uppercase">{companionStore.companionName}</h2>
                    <p class="text-[10px] text-[#ff2a2a]/60 uppercase tracking-widest">{currentDate} {currentTime}</p>
                </div>
            </div>
            
            <div class="flex items-center gap-3">
                <Button variant="ghost" size="icon" class="h-8 w-8 text-[#ff2a2a] hover:bg-[#ff2a2a]/20" onmouseenter={playHover} onclick={() => {playClick(); isSettingsOpen = true;}}>
                    <Settings class="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" class="h-8 w-8 text-[#ff2a2a] hover:bg-[#ff2a2a]/20 hover:text-white" onmouseenter={playHover} onclick={() => {playClick(); companionStore.close();}}>
                    <X class="h-5 w-5" />
                </Button>
            </div>
        </div>

        <!-- MAIN LAYOUT -->
        <div class="flex-1 flex flex-col md:grid md:grid-cols-12 gap-3 min-h-0 z-10 overflow-y-auto hal-scrollbar md:overflow-hidden relative pb-4 md:pb-0 pt-3">
            
            <!-- LEFT PANEL: STATS & OVERRIDES -->
            <div class="md:col-span-3 flex flex-col gap-3 h-full">
                <!-- SYSTEM STATS -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 relative flex flex-col">
                    <div class="text-[10px] uppercase tracking-widest text-[#ff2a2a]/70 mb-3 font-bold border-b border-[#ff2a2a]/20 pb-1">Logic Center</div>
                    
                    <div class="grid grid-cols-2 gap-3">
                        <div class="space-y-1">
                            <div class="text-[9px] text-[#ff2a2a]/50">CPU UTIL</div>
                            <div class="text-xl font-bold {cpuUsage > 80 ? 'text-white' : ''}">{Math.round(cpuUsage)}%</div>
                        </div>
                        <div class="space-y-1">
                            <div class="text-[9px] text-[#ff2a2a]/50">MEM UTIL</div>
                            <div class="text-xl font-bold {memUsage > 90 ? 'text-white' : ''}">{Math.round(memUsage)}%</div>
                        </div>
                        <div class="space-y-1">
                            <div class="text-[9px] text-[#ff2a2a]/50">NET I/O</div>
                            <div class="text-xl font-bold">{Math.round(netUsage)}%</div>
                        </div>
                        <div class="space-y-1">
                            <div class="text-[9px] text-[#ff2a2a]/50">DISK I/O</div>
                            <div class="text-xl font-bold">{Math.round(ioUsage)}%</div>
                        </div>
                    </div>
                </div>

                <!-- HARDWARE OVERRIDES -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 flex-1 flex flex-col relative overflow-hidden">
                    <div class="text-[10px] uppercase tracking-widest text-[#ff2a2a]/70 mb-3 font-bold border-b border-[#ff2a2a]/20 pb-1 flex justify-between">
                        <span>Hardware Overrides</span>
                        <Network class="w-3 h-3 text-[#ff2a2a]/50" />
                    </div>
                    
                    <div class="flex-1 flex flex-col gap-4">
                        <div class="flex items-center justify-between">
                            <Label class="text-xs tracking-wider">GHOST PROTOCOL (Desktop)</Label>
                            <Switch checked={systemStatus.ghostProtocol} onCheckedChange={toggleGhostProtocol} class="data-[state=checked]:bg-[#ff2a2a]" />
                        </div>
                        <div class="flex items-center justify-between">
                            <Label class="text-xs tracking-wider">DAEMON LOOP (Self-Improve)</Label>
                            <Switch checked={systemStatus.daemon} onCheckedChange={toggleDaemon} class="data-[state=checked]:bg-[#ff2a2a]" />
                        </div>
                        <div class="flex items-center justify-between">
                            <Label class="text-xs tracking-wider">IOT NETWORK ROUTING</Label>
                            <Switch checked={isIotActive} onCheckedChange={(v) => isIotActive = v} class="data-[state=checked]:bg-[#ff2a2a]" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- CENTER PANEL: HAL 9000 EYE & TERMINAL -->
            <div class="md:col-span-6 flex flex-col gap-3 h-full">
                
                <!-- EYE -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 relative overflow-hidden flex flex-col min-h-[250px] justify-center items-center">
                    <div class="absolute top-2 left-2 text-[9px] text-[#ff2a2a]/40 tracking-widest">OPTICAL SENSOR A-1</div>
                    
                    <!-- The Eye glow -->
                    <div class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,0,0,0.8)_0%,rgba(80,0,0,0.5)_40%,transparent_70%)] {companionStore.isThinking ? 'animate-pulse' : ''}"></div>
                    
                    <div class="w-[160px] h-[160px] rounded-full bg-[#050505] shadow-[inset_0_0_40px_rgba(0,0,0,1)] flex justify-center items-center relative overflow-hidden border-2 border-black z-10">
                        <canvas bind:this={canvasRef} class="absolute inset-0 w-full h-full"></canvas>
                    </div>
                    
                    <div class="absolute bottom-2 w-full px-4 flex justify-between text-[9px] text-[#ff2a2a]/50 tracking-widest z-10">
                        <span>SYS_RDY</span>
                        <span class="{companionStore.isThinking ? 'text-white animate-pulse' : ''}">{companionStore.isThinking ? 'PROCESSING...' : 'AWAITING INPUT'}</span>
                    </div>
                </div>

                <!-- TERMINAL OUTPUT -->
                <div class="flex-1 border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm relative flex flex-col overflow-hidden min-h-[200px]">
                    <div class="absolute top-0 w-full h-6 bg-[#ff2a2a]/10 border-b border-[#ff2a2a]/30 flex items-center px-2 z-30">
                        <span class="text-[9px] uppercase tracking-widest text-[#ff2a2a]/80">Terminal Dialog_</span>
                    </div>
                    
                    <div class="flex-1 p-4 pt-8 overflow-y-auto hal-scrollbar relative z-20 space-y-4" id="chat-scroll-container">
                        {#if companionStore.messages.length === 0}
                            <div class="text-[#ff2a2a]/40 text-xs italic tracking-wider text-center mt-10">
                                System online. Awaiting cognitive input...
                            </div>
                        {/if}
                        
                        {#each companionStore.messages as msg}
                            <div class="flex flex-col {msg.role === 'user' ? 'items-end' : 'items-start'}">
                                <span class="text-[9px] text-[#ff2a2a]/50 mb-1 tracking-widest uppercase">
                                    {msg.role === 'user' ? 'HUMAN_INPUT' : 'SYS_OUTPUT'}
                                </span>
                                <div class="p-2.5 rounded-sm max-w-[85%] text-sm whitespace-pre-wrap {msg.role === 'user' ? 'bg-[#ff2a2a]/10 border border-[#ff2a2a]/30 text-[#ff8a8a]' : 'bg-[#050505] border border-[#ff2a2a]/20 text-[#ff2a2a]'}">
                                    {msg.content}
                                </div>
                            </div>
                        {/each}

                        {#if companionStore.isThinking || typedText}
                            <div class="flex flex-col items-start">
                                <span class="text-[9px] text-[#ff2a2a]/50 mb-1 tracking-widest uppercase animate-pulse">SYS_OUTPUT</span>
                                <div class="p-2.5 rounded-sm max-w-[85%] text-sm whitespace-pre-wrap bg-[#050505] border border-[#ff2a2a]/20 text-white">
                                    {typedText}<span class="animate-pulse ml-1 inline-block w-1.5 h-3 bg-[#ff2a2a]"></span>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- INPUT AREA -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 shrink-0 flex items-end gap-2 relative">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        class="h-10 w-10 shrink-0 rounded-sm {isListening ? 'bg-[#ff2a2a] text-black hover:bg-[#ff2a2a] animate-pulse shadow-[0_0_15px_rgba(255,0,0,0.8)]' : 'bg-[#1a0505] text-[#ff2a2a] hover:bg-[#ff2a2a]/20 border border-[#ff2a2a]/30'}"
                        onclick={() => { playClick(); toggleListening(); }}
                        disabled={isPreparingMic || isTranscribing}
                    >
                        <Mic class="h-4 w-4" />
                    </Button>
                    
                    <Textarea 
                        bind:value={inputText}
                        placeholder={isTranscribing ? "TRANSCRIBING..." : isListening ? "LISTENING..." : "ENTER COMMAND..."}
                        class="min-h-[40px] max-h-[120px] resize-none bg-[#050505] border-[#ff2a2a]/30 focus-visible:ring-[#ff2a2a]/50 text-sm py-2.5 text-[#ff8a8a] rounded-sm"
                        onkeydown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                            else { playType(); }
                        }}
                    />
                    
                    <Button 
                        size="icon" 
                        class="h-10 w-10 shrink-0 bg-[#ff2a2a] text-black hover:bg-[#ff4040] rounded-sm"
                        onclick={handleSend}
                        disabled={!inputText.trim() || companionStore.isThinking}
                    >
                        <SendHorizontal class="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <!-- RIGHT PANEL: MEMORY & CONTEXT -->
            <div class="md:col-span-3 flex flex-col gap-3 h-full">
                <!-- EQ VISUALIZER -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 flex flex-col h-24 shrink-0 relative overflow-hidden">
                    <div class="text-[9px] uppercase tracking-widest text-[#ff2a2a]/50 mb-1 border-b border-[#ff2a2a]/20 pb-1">Audio Spectrum</div>
                    <div class="flex-1 flex items-end justify-between gap-[1px] pt-2">
                        {#each eqHeights as h}
                            <div class="w-full bg-[#ff2a2a] transition-all duration-75" style="height: {h}%"></div>
                        {/each}
                    </div>
                </div>

                <!-- MODULE STATUS -->
                <div class="border border-[#ff2a2a]/30 bg-[#0a0a0a] rounded-sm p-3 flex-1 overflow-y-auto hal-scrollbar flex flex-col">
                    <div class="text-[10px] uppercase tracking-widest text-[#ff2a2a]/70 mb-3 font-bold border-b border-[#ff2a2a]/20 pb-1">Subsystems</div>
                    
                    <div class="space-y-4">
                        <div>
                            <div class="flex justify-between text-[10px] mb-1">
                                <span>LLM CORE ENGINE</span>
                                <span class="text-white">ONLINE</span>
                            </div>
                            <div class="h-1 bg-[#1a0505] border border-[#ff2a2a]/30"><div class="h-full bg-[#ff2a2a] w-full"></div></div>
                        </div>
                        <div>
                            <div class="flex justify-between text-[10px] mb-1">
                                <span>MEMORY HEAP</span>
                                <span>NOMINAL</span>
                            </div>
                            <div class="h-1 bg-[#1a0505] border border-[#ff2a2a]/30"><div class="h-full bg-[#ff2a2a] w-[45%]"></div></div>
                        </div>
                        <div>
                            <div class="flex justify-between text-[10px] mb-1">
                                <span>VOICE SYNTHESIS</span>
                                <span>READY</span>
                            </div>
                            <div class="h-1 bg-[#1a0505] border border-[#ff2a2a]/30"><div class="h-full bg-[#ff2a2a] w-full"></div></div>
                        </div>
                    </div>
                </div>
            </div>
            
        </div>
        
    </div>

    <!-- SETTINGS MODAL -->
    {#if isSettingsOpen}
        <div class="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" transition:fade={{duration: 150}}>
            <div class="bg-[#050505] w-full max-w-lg border border-[#ff2a2a]/50 shadow-[0_0_50px_rgba(255,42,42,0.15)] p-6 flex flex-col gap-6" transition:scale={{ start: 0.95, duration: 150 }}>
                
                <div class="flex items-center justify-between border-b border-[#ff2a2a]/30 pb-4">
                    <h2 class="text-lg font-bold text-[#ff2a2a] tracking-widest uppercase flex items-center gap-2">
                        <Settings class="h-5 w-5" /> Core Parameters
                    </h2>
                    <Button variant="ghost" size="icon" class="text-[#ff2a2a] hover:bg-[#ff2a2a]/20" onclick={() => isSettingsOpen = false}>
                        <X class="h-5 w-5" />
                    </Button>
                </div>

                <div class="space-y-4">
                    <div class="space-y-2">
                        <Label class="text-xs uppercase text-[#ff2a2a]/70">Designation</Label>
                        <Input bind:value={companionStore.companionName} class="bg-[#0a0a0a] border-[#ff2a2a]/30 text-[#ff2a2a]" />
                    </div>
                    
                    <div class="space-y-2">
                        <Label class="text-xs uppercase text-[#ff2a2a]/70">Directive (System Prompt)</Label>
                        <Textarea bind:value={companionStore.basePersona} class="bg-[#0a0a0a] border-[#ff2a2a]/30 text-[#ff2a2a] min-h-[120px]" />
                    </div>
                </div>
                
                <div class="flex justify-end pt-4 border-t border-[#ff2a2a]/30">
                    <Button class="bg-[#ff2a2a] text-black hover:bg-[#ff4040] uppercase tracking-widest font-bold text-xs" onclick={() => { companionStore.saveSettings(); isSettingsOpen = false; }}>Save Parameters</Button>
                </div>
                
            </div>
        </div>
    {/if}
{/if}

<style>
    .glitch-mode {
        animation: rgbShift 0.1s infinite alternate;
    }
    
    @keyframes rgbShift {
        0% { text-shadow: 2px 0 red, -2px 0 blue; }
        100% { text-shadow: -2px 0 red, 2px 0 blue; }
    }
    
    .hal-scrollbar::-webkit-scrollbar {
        width: 4px;
        height: 4px;
    }
    .hal-scrollbar::-webkit-scrollbar-track {
        background: rgba(10, 10, 10, 1);
    }
    .hal-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 42, 42, 0.4);
        border-radius: 4px;
    }
    .hal-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 42, 42, 0.8);
    }
</style>
`

fs.writeFileSync('C:/Users/MONSTER/Desktop/LLAMA-SERVER-2.0/tools/ui/src/lib/components/app/companion/CompanionOverlay.svelte', content);
