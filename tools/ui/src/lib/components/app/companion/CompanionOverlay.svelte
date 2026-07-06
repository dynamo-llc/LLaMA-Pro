<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { Settings, Mic, SendHorizontal, X, BrainCircuit, AlertTriangle, Shield, Zap, Eye, Radio, Terminal, ChevronRight, RotateCcw } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Switch } from '$lib/components/ui/switch';
    import * as Tooltip from '$lib/components/ui/tooltip';
    import { fade, scale, fly } from 'svelte/transition';
    import { companionStore } from '$lib/services/companion.svelte';
    import { modelsStore } from '$lib/stores/models.svelte';
    import { toast } from 'svelte-sonner';
    import { getBaseUrl } from '$lib/utils/get-base-url';
    import MarkdownContent from '$lib/components/app/content/MarkdownContent/MarkdownContent.svelte';
    import { personas } from '$lib/services/personas';

    let isSettingsOpen = $state(false);
    let inputText = $state('');
    let isListening = $state(false);
    let isPreparingMic = $state(false);
    let isTranscribing = $state(false);
    
    let mediaRecorder: MediaRecorder | null = null;

    // Premium glowing orb states
    let orbScale = $state(1);
    let orbHue = $state(200); // Blue by default
    let pulseInterval: ReturnType<typeof setInterval> | undefined = undefined;

    // Typewriter effect state
    let typedText = $state('');
    let typewriterInterval: ReturnType<typeof setInterval> | undefined = undefined;

    let currentTime = $state('00:00:00 UTC');
    let currentDate = $state('JAN 01, 2099');
    let timeInterval: ReturnType<typeof setInterval>;
    let cpuUsage = $state(18);
    let memUsage = $state(100);
    let netUsage = $state(42);
    let ioUsage = $state(27);
    let statsInterval: ReturnType<typeof setInterval>;
    
    let freqData = new Uint8Array(40);
    let eqHeights = $state<number[]>(Array(40).fill(20));
    let reqAnimFrame = 0;
    let lastSpeechTime = Date.now();
    let currentVolume = $state(0);
    let oscilloscopeCanvas = $state<HTMLCanvasElement>();
    let matrixCanvas = $state<HTMLCanvasElement>();
    let matrixInterval: ReturnType<typeof setInterval>;
    let faceTrackerInterval: ReturnType<typeof setInterval>;
    let focusInterval: ReturnType<typeof setInterval>;
    
    let faceTrackerX = $state(50);
    let faceTrackerY = $state(45);
    let faceTrackerScale = $state(1.0);
    let faceTrackerWidth = $state(80);
    let faceTrackerHeight = $state(80);
    
    let vadSilenceTimer: ReturnType<typeof setTimeout> | null = null;
    let isUserSpeaking = false;
    let speechDurationFrames = 0;

    let isGlitching = $state(false);

    // ---- Persona signature colors [h, s, l] ----
    const personaColors: Record<string, [number, number, number]> = {
        hal9000:       [  0, 90, 55],
        rexmidas:      [ 45, 88, 52],
        generaldouglas:[ 88, 55, 38],
        kineval:       [208, 78, 48],
        brocklafort:   [278, 65, 52],
        denisewalsh:   [185, 88, 44],
        jimmeyers:     [ 28, 88, 52],
        marciechen:    [330, 70, 55],
        ethansinclaire:[148, 76, 44],
        thetwins:      [258, 72, 62],
        larrapeta:     [195, 60, 65]
    };

    // ---- Radar stats per persona [intel, authority, technical, threat, social, autonomy] ----
    const personaStats: Record<string, number[]> = {
        hal9000:       [98, 68, 95, 84, 20, 90],
        rexmidas:      [85, 99, 40, 88, 82, 95],
        generaldouglas:[75, 95, 60, 98, 30, 70],
        kineval:       [90, 65, 55, 95, 75, 85],
        brocklafort:   [80, 70, 28, 68, 92, 60],
        denisewalsh:   [95, 50, 99, 28, 62, 75],
        jimmeyers:     [85, 40, 92, 75, 35, 80],
        marciechen:    [92, 55, 72, 22, 68, 50],
        ethansinclaire:[90, 20, 96, 60, 40, 70],
        thetwins:      [97, 45, 85, 22, 56, 65],
        larrapeta:     [90, 60, 35, 15, 98, 70]
    };

    const personaClearance: Record<string, string> = {
        hal9000:       'OMEGA CLEARANCE',
        rexmidas:      'EXECUTIVE ALPHA',
        generaldouglas:'CLASSIFIED: EYES ONLY',
        kineval:       'SHADOW PROTOCOL',
        brocklafort:   'RESTRICTED ACCESS',
        denisewalsh:   'TOP SECRET / SCI',
        jimmeyers:     'BLACK SITE ACCESS',
        marciechen:    'LEVEL 7 CLEARANCE',
        ethansinclaire:'UNAUTHORIZED / TOLERATED',
        thetwins:      'PREDICTIVE CLEARANCE',
        larrapeta:     'MEDICAL / PSYCH EVAL'
    };

    const radarLabels = ['INTEL', 'AUTH', 'TECH', 'THREAT', 'SOCIAL', 'AUTO'];
    const radarAngles = [90, 30, -30, -90, -150, 150];

    function getRadarPoints(id: string, r = 36): string {
        const s = personaStats[id] ?? [50,50,50,50,50,50];
        return s.map((v, i) => {
            const a = (radarAngles[i] * Math.PI) / 180;
            const d = (v / 100) * r;
            return `${(50 + d * Math.cos(a)).toFixed(1)},${(50 - d * Math.sin(a)).toFixed(1)}`;
        }).join(' ');
    }

    function getAxisEnd(idx: number, r = 42): { x: number; y: number } {
        const a = (radarAngles[idx] * Math.PI) / 180;
        return { x: +(50 + r * Math.cos(a)).toFixed(1), y: +(50 - r * Math.sin(a)).toFixed(1) };
    }

    let activeColor = $derived(personaColors[companionStore.activePersonaId] ?? [200, 80, 50]);

    // Token budget as % of 32k context
    let tokenBudget = $derived(
        Math.min(100, Math.max(0,
            companionStore.messages
                .filter(m => m.role !== 'system')
                .reduce((sum, m) => sum + Math.ceil((typeof m.content === 'string' ? m.content.length : 0) / 3.5), 0)
            / 327.68
        ))
    );

    let isPersonaSwitching = $state(false);
    let switchGlitchTimer: ReturnType<typeof setTimeout>;
    let lastPersonaId = companionStore.activePersonaId;

    let commandHistory = $state<string[]>([]);
    let historyIndex = $state(-1);

    let particlesCanvas = $state<HTMLCanvasElement>();
    let particleAnimFrame = 0;

    let isExpanded = $state(false);

    $effect(() => {
        const warningToasts = companionStore.toasts.filter(t => t.type === 'warning');
        if (warningToasts.length > 0) {
            isGlitching = true;
            const timer = setTimeout(() => {
                isGlitching = false;
            }, 600);
            return () => clearTimeout(timer);
        }
    });

    // Persona switch glitch
    $effect(() => {
        const id = companionStore.activePersonaId;
        if (id !== lastPersonaId) {
            lastPersonaId = id;
            isPersonaSwitching = true;
            if (switchGlitchTimer) clearTimeout(switchGlitchTimer);
            switchGlitchTimer = setTimeout(() => { isPersonaSwitching = false; }, 650);
        }
    });
    
    let isSelfRepairing = $state(false);
    let isSelfImproving = $state(false);
    let isMcpInstalling = $state(false);
    let mcpInstallName = $state('');
    let mcpInstallManager = $state<'npm' | 'pip'>('npm');

    async function triggerSelfRepair() {
        if (isSelfRepairing) return;
        isSelfRepairing = true;
        companionStore.showToast("SELF-REPAIR SCAN ACTIVE", "info");
        try {
            const res = await companionStore.runSelfRepair();
            if (res.status === 'success') {
                companionStore.showToast("AUTO-PATCH SEQUENCE SUCCESS", "success");
            } else {
                companionStore.showToast(res.message, "warning");
            }
        } catch (e: any) {
            companionStore.showToast(e.message || "Repair routine failed", "warning");
        } finally {
            isSelfRepairing = false;
        }
    }

    async function triggerSelfImprovement() {
        if (isSelfImproving) return;
        isSelfImproving = true;
        companionStore.showToast("SELF-IMPROVEMENT SCAN ACTIVE", "info");
        try {
            const res = await companionStore.runSelfImprovement();
            if (res.status === 'success') {
                companionStore.showToast("SYSTEM SUCCESSFULLY OPTIMIZED", "success");
                fetchUpgradeLogs();
            } else {
                companionStore.showToast(res.message, "warning");
            }
        } catch (e: any) {
            companionStore.showToast(e.message || "Self-improvement scan failed", "warning");
        } finally {
            isSelfImproving = false;
        }
    }

    let upgradeLogs = $state<{ timestamp: number; file: string; type: string }[]>([]);

    async function fetchUpgradeLogs() {
        try {
            upgradeLogs = await companionStore.getSelfImprovementLogs();
        } catch (e) {}
    }

    $effect(() => {
        if (isSettingsOpen) {
            fetchUpgradeLogs();
        }
    });

    async function triggerMcpInstall() {
        if (isMcpInstalling || !mcpInstallName.trim()) return;
        isMcpInstalling = true;
        companionStore.showToast(`DOWNLOADING ${mcpInstallName.toUpperCase()}`, "info");
        try {
            const res = await companionStore.installMcpPackage(mcpInstallName.trim(), mcpInstallManager);
            if (res.status === 'success') {
                companionStore.showToast(`MCP ${res.package.toUpperCase()} LOADED`, "success");
                mcpInstallName = '';
            } else {
                companionStore.showToast("INSTALLATION FAILED", "warning");
            }
        } catch (e: any) {
            companionStore.showToast(e.message || "MCP installation failed", "warning");
        } finally {
            isMcpInstalling = false;
        }
    }
    let videoStream: MediaStream | null = $state(null);
    let videoElement: HTMLVideoElement | null = $state(null);
    let mainVideoRef: HTMLVideoElement | null = $state(null);

    function getCardSuit(dept = '') {
        const d = (dept || '').toLowerCase();
        if (d.includes('core') || d.includes('engineering')) return '♠';
        if (d.includes('executive') || d.includes('finance') || d.includes('account')) return '♦';
        if (d.includes('cyber') || d.includes('security') || d.includes('intelligence') || d.includes('global')) return '♣';
        return '♥';
    }
    
    function getCardIndex(name = '', title = '') {
        const n = (name || '').toLowerCase();
        const t = (title || '').toLowerCase();
        if (t.includes('executive') || t.includes('ceo') || n.includes('midas')) return 'K';
        if (n.includes('general') || n.includes('douglas')) return 'A';
        if (n.includes('hal')) return 'J';
        return (name || 'Q').charAt(0).toUpperCase();
    }

    $effect(() => {
        const _ = companionStore.activePersonaId;
        if (mainVideoRef) {
            mainVideoRef.play().catch(() => {});
        }
    });

    let isIotActive = $state(false);
    let isIngesting = $state(false);
    let orbBorderRadius = $state('50%');
    
    let isMicOverride = $state(false);
    let isCameraOverride = $state(false);
    let systemStatus = $state({ mcpServers: [], projects: [], ghostProtocol: false, daemon: false });
    let statusInterval: ReturnType<typeof setInterval>;

    $effect(() => {
        const _ = companionStore.messages;
        const __ = companionStore.activeResponse;
        const ___ = typedText;
        const container = document.getElementById('chat-scroll-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    });

    $effect(() => {
        typedText = companionStore.activeResponse;
    });

    async function fetchSystemStatus() {
        try {
            const res = await fetch(`${getBaseUrl('orchestrator')}/v1/system/status`);
            if (res.ok) systemStatus = await res.json();
        } catch(e) {}
    }

    async function toggleGhostProtocol(active: boolean) {
        try {
            const res = await fetch(`${getBaseUrl('orchestrator')}/v1/system/ghost`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active })
            });
            if (res.ok) await fetchSystemStatus();
        } catch (e) {
            toast.error("Failed to toggle Ghost Protocol");
        }
    }

    async function toggleDaemon(active: boolean) {
        try {
            const res = await fetch(`${getBaseUrl('orchestrator')}/v1/system/daemon`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active })
            });
            if (res.ok) await fetchSystemStatus();
        } catch (e) {
            toast.error("Failed to toggle Daemon Loop");
        }
    }



    function updateStats() {
        const now = new Date();
        currentTime = now.toTimeString().split(' ')[0] + ' Local';
        currentDate = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
        
        cpuUsage = Math.min(100, Math.max(0, cpuUsage + (Math.random() * 20 - 10)));
        memUsage = companionStore.isThinking ? 100 : Math.min(100, Math.max(60, memUsage + (Math.random() * 10 - 5)));
        netUsage = Math.min(100, Math.max(0, netUsage + (Math.random() * 40 - 20)));
        ioUsage = companionStore.isThinking ? Math.min(100, ioUsage + 20) : Math.max(0, ioUsage - 5);
    }

    // Memory heap % driven by message history size (capped at 100%)
    let memoryHeapPct = $derived(Math.min(100, Math.max(5, companionStore.messages.filter(m => m.role !== 'system').length * 8)));

    function updateEQ() {
        const analyser = companionStore.analyser;
        const audioCtx = companionStore.audioCtx;

        if (analyser && audioCtx?.state === 'running') {
            analyser.getByteFrequencyData(freqData);
            let sum = 0;
            for(let i=0; i<40; i++) {
                eqHeights[i] = Math.max(10, (freqData[i] / 255) * 100);
                sum += freqData[i];
            }
            currentVolume = sum / (40 * 255);
            
            // Draw oscilloscope soundwave on canvas
            if (oscilloscopeCanvas) {
                const ctx = oscilloscopeCanvas.getContext('2d');
                if (ctx) {
                    const width = oscilloscopeCanvas.width;
                    const height = oscilloscopeCanvas.height;
                    ctx.clearRect(0, 0, width, height);
                    
                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);
                    analyser.getByteTimeDomainData(dataArray);
                    
                    ctx.lineWidth = 2.5;
                    ctx.strokeStyle = `hsla(${orbHue}, 90%, 50%, 0.8)`;
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = `hsl(${orbHue}, 90%, 50%)`;
                    ctx.beginPath();
                    
                    const sliceWidth = width / bufferLength;
                    let x = 0;
                    
                    for (let i = 0; i < bufferLength; i++) {
                        const v = dataArray[i] / 128.0;
                        const y = (v * height) / 2;
                        
                        if (i === 0) {
                            ctx.moveTo(x, y);
                        } else {
                            ctx.lineTo(x, y);
                        }
                        
                        x += sliceWidth;
                    }
                    
                    ctx.lineTo(width, height / 2);
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                }
            }

            if (isListening) {
                if (currentVolume > companionStore.vadVolumeThreshold) { // speech threshold
                    speechDurationFrames++;
                    if (speechDurationFrames >= 3) { // Speech confirmed (150ms of continuous vocal energy)
                        if (!isUserSpeaking) {
                            isUserSpeaking = true;
                            companionStore.stopSpeaking();
                        }
                        if (vadSilenceTimer) {
                            clearTimeout(vadSilenceTimer);
                            vadSilenceTimer = null;
                        }
                    }
                } else {
                    speechDurationFrames = 0;
                    if (isUserSpeaking) {
                        if (!vadSilenceTimer) {
                            vadSilenceTimer = setTimeout(() => {
                                isUserSpeaking = false;
                                playChime('stop');
                                speakAcknowledgePlaceholder();
                                stopListening();
                            }, companionStore.vadSilenceTimeout); // silence duration to trigger turn-end
                        }
                    }
                }
            }
        } else {
            currentVolume = 0;
            for(let i=0; i<40; i++) {
                eqHeights[i] = Math.max(10, eqHeights[i] - 2);
            }
            if (oscilloscopeCanvas) {
                const ctx = oscilloscopeCanvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, oscilloscopeCanvas.width, oscilloscopeCanvas.height);
                }
            }
        }
        reqAnimFrame = requestAnimationFrame(updateEQ);
    }

    // Short-circuit the rAF loop while the panel is closed (#13)
    $effect(() => {
        if (companionStore.isOpen) {
            reqAnimFrame = requestAnimationFrame(updateEQ);
        } else {
            cancelAnimationFrame(reqAnimFrame);
        }
    });

    async function toggleCameraOverride(active: boolean) {
        isCameraOverride = active;
        if (active) {
            try {
                videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            } catch (err) {
                console.error('Error accessing webcam', err);
                isCameraOverride = false;
            }
        } else {
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
                videoStream = null;
            }
        }
    }

    $effect(() => {
        if (videoElement && videoStream && videoElement.srcObject !== videoStream) {
            videoElement.srcObject = videoStream;
        }
    });

    function toggleAlwaysOnMic(active: boolean) {
        isMicOverride = active;
        if (active && !isListening && !isTranscribing && !companionStore.isThinking) {
            toggleListening();
        } else if (!active && isListening) {
            stopListening();
        }
    }

    // React to partner finishing speaking to resume listening
    $effect(() => {
        if (isMicOverride && !companionStore.isThinking && !isListening && !isTranscribing && !isPreparingMic) {
            setTimeout(() => {
                if (isMicOverride && !companionStore.isThinking && !isListening && !isTranscribing) {
                    toggleListening();
                }
            }, 1000);
        }
    });

    function playChime(type: 'start' | 'stop' | 'action' | 'data' | 'error') {
        companionStore.playChime(type);
    }

    async function fetchWorkspaceFocus() {
        try {
            const res = await fetch(`${getBaseUrl('orchestrator')}/v1/workspace/focus`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.file) {
                    companionStore.activeFile = data;
                }
            }
        } catch (e) {}
    }

    async function executeVoiceAction(action: string) {
        try {
            await fetch(`${getBaseUrl('orchestrator')}/v1/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
        } catch (e) {
            console.error("Failed to execute voice action", e);
        }
    }

    function checkVoiceCommands(text: string): boolean {
        const lower = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
        
        if (lower.includes("llama build") || lower.includes("llama build project")) {
            executeVoiceAction("build");
            companionStore.showToast("BUILD SEQUENCE DEPLOYED", "success");
            companionStore.speak("Understood. Starting production build execution.");
            return true;
        }
        if (lower.includes("llama clear conversation") || lower.includes("llama clear history") || lower.includes("llama restart")) {
            companionStore.clearConversation();
            companionStore.showToast("MEMORY BANKS PURGED", "success");
            companionStore.speak("Conversation memory banks cleared.");
            return true;
        }
        if (lower.includes("llama open terminal") || lower.includes("llama terminal")) {
            executeVoiceAction("terminal");
            companionStore.showToast("SHELL TERMINAL SPAWNED", "success");
            companionStore.speak("Opening desktop shell terminal.");
            return true;
        }
        return false;
    }

    function speakAcknowledgePlaceholder() {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const phrases = [
                "Thinking",
                "Understood",
                "Let's see",
                "Processing",
                "Analyzing",
                "On it"
            ];
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            const utterance = new SpeechSynthesisUtterance(phrase);
            utterance.rate = 1.3;
            const voices = window.speechSynthesis.getVoices();
            const fallbackVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
            if (fallbackVoice) utterance.voice = fallbackVoice;
            window.speechSynthesis.speak(utterance);
        }
    }

    async function toggleListening() {
        companionStore.initAudio();
        companionStore.stopSpeaking();
        
        if (isListening) {
            playChime('stop');
            stopListening();
            return;
        }

        try {
            isPreparingMic = true;
            
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            if (companionStore.audioCtx && companionStore.analyser) {
                const source = companionStore.audioCtx.createMediaStreamSource(stream);
                source.connect(companionStore.analyser);
            }
            const isDesktop = window.location.protocol === 'app:';
            const host = (isDesktop || !window.location.hostname || window.location.hostname === '') ? '127.0.0.1' : window.location.hostname;
            const orchestratorPort = (window as any).orchestratorPort || '8000';
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsEndpoint = `${wsProtocol}//${host}:${orchestratorPort}/v1/audio/stream`;
            
            const ws = new WebSocket(wsEndpoint);
            
            playChime('start');
            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.ondataavailable = async (e) => {
                if (e.data && e.data.size > 0) {
                    if (ws.readyState === WebSocket.OPEN) {
                        const arrayBuffer = await e.data.arrayBuffer();
                        ws.send(arrayBuffer);
                    }
                }
            };
            
            mediaRecorder.onstop = async () => {
                isListening = false;
                companionStore.isVoiceMode = false;
                isTranscribing = true;
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send("EOF");
                    }
                    
                    const result = await new Promise<any>((resolve, reject) => {
                        ws.onmessage = (event) => {
                            try {
                                resolve(JSON.parse(event.data));
                            } catch (e) {
                                reject(e);
                            }
                        };
                        ws.onerror = (e) => reject(e);
                        ws.onclose = () => resolve({ text: "" });
                    });
                    
                    if (result && result.text && result.text.trim() && result.text.trim().length > 3) {
                        const transcribed = result.text.trim();
                        if (checkVoiceCommands(transcribed)) {
                            return;
                        }
                        inputText = transcribed;
                        await handleSend();
                    }
                } catch (e) {
                    console.error("WebSocket STT Error", e);
                    toast.error("Speech recognition failed");
                } finally {
                    isTranscribing = false;
                    try { ws.close(); } catch(e) {}
                }
                stream.getTracks().forEach(t => t.stop());
            };

            ws.onopen = () => {
                mediaRecorder?.start(250);
                isListening = true;
                companionStore.isVoiceMode = true;
                isPreparingMic = false;
                lastSpeechTime = Date.now();
            };

            ws.onerror = () => {
                isPreparingMic = false;
                isListening = false;
                try { ws.close(); } catch(e) {}
                stream.getTracks().forEach(t => t.stop());
                toast.error("Speech recognition connection failed");
            };

        } catch (error) {
            toast.error("Microphone access denied");
            isMicOverride = false;
            isPreparingMic = false;
        }
    }

    function stopListening() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }

    function captureWebcamFrame(): string | null {
        if (!videoElement || !isCameraOverride) return null;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.7);
            }
        } catch(e) {
            console.error("Failed to capture webcam frame", e);
        }
        return null;
    }

    async function handleSend() {
        if (!inputText.trim() || companionStore.isThinking) return;
        const text = inputText;
        // Track command history
        commandHistory = [text, ...commandHistory.filter(h => h !== text)].slice(0, 50);
        historyIndex = -1;
        inputText = '';

        // Auto-switch persona based on name invocation
        const lowerText = text.toLowerCase();
        for (const p of personas) {
            const firstName = p.name.split(' ')[0].toLowerCase();
            if (lowerText.includes(firstName)) {
                companionStore.activePersonaId = p.id;
                break;
            }
        }

        const imageBase64 = captureWebcamFrame();
        await companionStore.sendMessage(text, imageBase64);
    }

    function handleCommandKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0) {
                historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
                inputText = commandHistory[historyIndex] ?? '';
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) { historyIndex--; inputText = commandHistory[historyIndex] ?? ''; }
            else { historyIndex = -1; inputText = ''; }
        }
    }

    function initParticles() {
        if (!particlesCanvas) return;
        const ctx = particlesCanvas.getContext('2d');
        if (!ctx) return;
        particlesCanvas.width  = particlesCanvas.offsetWidth  || 800;
        particlesCanvas.height = particlesCanvas.offsetHeight || 600;
        type P = { x: number; y: number; vx: number; vy: number; r: number; o: number };
        const pts: P[] = Array.from({ length: 60 }, () => ({
            x: Math.random() * particlesCanvas!.width,
            y: Math.random() * particlesCanvas!.height,
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
            r: Math.random() * 1.3 + 0.3,
            o: Math.random() * 0.3 + 0.05
        }));
        function frame() {
            if (!particlesCanvas || !ctx) return;
            const w = particlesCanvas.width, h = particlesCanvas.height;
            ctx.clearRect(0, 0, w, h);
            const [ph, ps, pl] = personaColors[companionStore.activePersonaId] ?? [200, 80, 50];
            const sp = companionStore.isThinking ? 2.5 : companionStore.isPlayingAudio ? 1.8 : 1;
            for (const p of pts) {
                p.x = (p.x + p.vx * sp + w) % w;
                p.y = (p.y + p.vy * sp + h) % h;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, 6.283);
                ctx.fillStyle = `hsla(${ph},${ps}%,${pl}%,${p.o * (sp > 1 ? 1.7 : 1)})`;
                ctx.fill();
            }
            particleAnimFrame = requestAnimationFrame(frame);
        }
        frame();
    }

    onMount(() => {
        statsInterval = setInterval(updateStats, 200);
        // rAF loop is managed by the $effect that watches companionStore.isOpen
        
        statusInterval = setInterval(fetchSystemStatus, 2000);
        fetchSystemStatus();

        // Face tracking drift simulator
        faceTrackerInterval = setInterval(() => {
            if (isCameraOverride) {
                faceTrackerX = 40 + Math.random() * 20;
                faceTrackerY = 35 + Math.random() * 20;
                faceTrackerScale = 0.95 + Math.random() * 0.1;
                faceTrackerWidth = 70 + Math.round(Math.random() * 20);
                faceTrackerHeight = 70 + Math.round(Math.random() * 20);
            }
        }, 1500);

        // Matrix rain animation
        if (matrixCanvas) {
            const ctx = matrixCanvas.getContext('2d');
            if (ctx) {
                const width = matrixCanvas.width = matrixCanvas.offsetWidth || 300;
                const height = matrixCanvas.height = matrixCanvas.offsetHeight || 400;
                const columns = Math.floor(width / 12);
                const yPositions = Array(columns).fill(0);
                
                matrixInterval = setInterval(() => {
                    if (!matrixCanvas) return;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
                    ctx.fillRect(0, 0, width, height);
                    
                    ctx.fillStyle = `hsla(${orbHue}, 90%, 45%, 0.7)`;
                    ctx.font = '8px monospace';
                    
                    for (let i = 0; i < yPositions.length; i++) {
                        const char = Math.random() > 0.5 ? '1' : '0';
                        const x = i * 12;
                        const y = yPositions[i];
                        ctx.fillText(char, x, y);
                        
                        const threshold = companionStore.isThinking ? 0.96 : 0.99;
                        if (y > height && Math.random() > threshold) {
                            yPositions[i] = 0;
                        } else {
                            yPositions[i] += 10;
                        }
                    }
                }, 50);
            }
        }

        focusInterval = setInterval(fetchWorkspaceFocus, 5000);
        fetchWorkspaceFocus();

        $effect(() => {
            // Safe access defaults are now handled by activePersona
        });

        pulseInterval = setInterval(() => {
            if (companionStore.isThinking) {
                orbScale = 1.15 + Math.random() * 0.15;
                orbHue = 270 + Math.random() * 40; 
                const r1 = 35 + Math.random() * 30;
                const r2 = 35 + Math.random() * 30;
                const r3 = 35 + Math.random() * 30;
                const r4 = 35 + Math.random() * 30;
                orbBorderRadius = `${r1}% ${100-r1}% ${r2}% ${100-r2}% / ${r3}% ${r4}% ${100-r4}% ${100-r3}%`;
            } else if (isListening) {
                orbScale = 1.0 + (currentVolume * 0.8) + Math.random() * 0.05;
                orbHue = 140; 
                const v = Math.round(currentVolume * 25);
                const r1 = 50 - v;
                const r2 = 50 + v;
                orbBorderRadius = `${r2}% ${r1}% ${r2}% ${r1}% / ${r1}% ${r2}% ${r1}% ${r2}%`;
            } else if (companionStore.isPlayingAudio) {
                orbScale = 1.0 + (currentVolume * 0.9) + Math.random() * 0.05;
                orbHue = 35 + Math.random() * 15; 
                const v = Math.round(currentVolume * 35);
                const r1 = 50 - v;
                const r2 = 50 + v;
                orbBorderRadius = `${r1}% ${r2}% ${r1}% ${r2}% / ${r2}% ${r1}% ${r2}% ${r1}%`;
            } else {
                orbScale = 1.0 + Math.sin(Date.now() / 1000) * 0.05;
                orbHue = 200; 
                orbBorderRadius = '50%';
            }
        }, 100);
    });

    onMount(() => { setTimeout(initParticles, 100); });

    onDestroy(() => {
        clearInterval(statsInterval);
        clearInterval(statusInterval);
        cancelAnimationFrame(reqAnimFrame);
        cancelAnimationFrame(particleAnimFrame);
        if (typewriterInterval) clearInterval(typewriterInterval);
        if (pulseInterval) clearInterval(pulseInterval);
        if (matrixInterval) clearInterval(matrixInterval);
        if (faceTrackerInterval) clearInterval(faceTrackerInterval);
        if (focusInterval) clearInterval(focusInterval);
        if (vadSilenceTimer) clearTimeout(vadSilenceTimer);
        if (switchGlitchTimer) clearTimeout(switchGlitchTimer);

        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        companionStore.stopSpeaking();
        if (videoStream) videoStream.getTracks().forEach(track => track.stop());
    });
</script>

<svelte:window onmousemove={() => companionStore.initAudio()} onclick={() => companionStore.initAudio()} />

{#if companionStore.isOpen}
    <div
        class="absolute inset-0 z-[40] mc-root text-foreground font-sans flex flex-col p-4 select-none overflow-hidden"
        style="--pc-h:{activeColor[0]};--pc-s:{activeColor[1]}%;--pc-l:{activeColor[2]}%"
        transition:fade={{duration: 200}}
    >
        <!-- Ambient persona glow -->
        <div class="mc-ambient-glow {companionStore.isThinking ? 'mc-glow-active' : companionStore.isPlayingAudio ? 'mc-glow-speak' : ''}"
             style="background: radial-gradient(ellipse 60% 50% at 30% 60%, hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.07) 0%, transparent 70%)"
        ></div>
        <!-- Particle field -->
        <canvas bind:this={particlesCanvas} class="mc-particles-canvas"></canvas>
        
        <!-- TOP HUD BAR -->
        <div class="mc-topbar shrink-0 z-10" style="border-left: 3px solid hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7); box-shadow: inset 4px 0 12px hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.06), 0 2px 12px rgba(0,0,0,0.2)">
            <div class="flex items-center gap-3">
                <div class="mc-status-orb {companionStore.isThinking ? 'orb-thinking' : companionStore.isPlayingAudio ? 'orb-speaking' : 'orb-ready'}"
                     style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l));box-shadow:0 0 {companionStore.isThinking ? '14px' : '8px'} hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"
                ></div>
                <div class="flex flex-col">
                    <h2 class="text-xs font-black tracking-[0.2em] uppercase leading-tight" style="color:hsl(var(--pc-h),var(--pc-s),calc(var(--pc-l) + 15%))">
                        {companionStore.activePersona?.name || 'Operations Center'}
                        <span class="ml-2 text-[9px] font-mono opacity-60">// {companionStore.activePersona?.department || 'SYSTEM'}</span>
                    </h2>
                    <p class="text-[9px] text-muted-foreground/70 uppercase tracking-widest leading-none pt-0.5 font-mono">{currentDate} &nbsp;{currentTime}</p>
                </div>
            </div>
            <div class="flex items-center gap-1.5">
                <div class="mc-topbar-pill" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l));border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.3)">
                    <span class="w-1 h-1 rounded-full bg-current {companionStore.isThinking ? 'animate-ping' : 'animate-pulse'}"></span>
                    {companionStore.isThinking ? 'PROCESSING' : companionStore.isPlayingAudio ? 'TRANSMITTING' : 'ONLINE'}
                </div>
                <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground rounded-lg" onclick={() => isSettingsOpen = true}>
                    <Settings class="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground rounded-lg" onclick={() => companionStore.close()}>
                    <X class="h-4 w-4" />
                </Button>
            </div>
        </div>

        <div class="flex-1 flex flex-col gap-3 min-h-0 z-10 overflow-hidden relative pt-2">
            
            <!-- TEAM CAROUSEL -->
            <div class="mc-carousel shrink-0">
                {#each personas as persona}
                    <button
                        class="mc-carousel-item {companionStore.activePersonaId === persona.id ? 'mc-carousel-item--active' : ''}"
                        onclick={() => companionStore.activePersonaId = persona.id}
                        title={persona.name}
                    >
                        {#if persona.videoUrl}
                            <video src={persona.videoUrl} autoplay loop muted playsinline class="w-full h-full object-cover rounded-xl pointer-events-none"></video>
                        {:else}
                            <img src={persona.avatarUrl} alt={persona.name} class="w-full h-full object-cover rounded-xl" />
                        {/if}
                        {#if companionStore.activePersonaId === persona.id}
                            <div class="mc-carousel-label">{persona.name.split(' ')[0]}</div>
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- MAIN GRID LAYOUT -->
            <div class="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-4 min-h-0">
                
                <!-- LEFT PANEL: Animated Character Video Card -->
                <div class="flex flex-col h-full min-h-0">
                    <div class="mc-video-card {companionStore.isThinking ? 'mc-card-thinking' : companionStore.isPlayingAudio ? 'mc-card-speaking' : isListening ? 'mc-card-listening' : ''} {isPersonaSwitching ? 'mc-card-glitch' : ''}"
                         style="--pc-h:{activeColor[0]};--pc-s:{activeColor[1]}%;--pc-l:{activeColor[2]}%">
                        <!-- Corner indices -->
                        <div class="mc-card-index">
                            <span class="text-sm font-black">{getCardIndex(companionStore.activePersona?.name, companionStore.activePersona?.title)}</span>
                            <span class="text-xs">{getCardSuit(companionStore.activePersona?.department)}</span>
                        </div>
                        <div class="mc-card-index mc-card-index--br">
                            <span class="text-sm font-black">{getCardIndex(companionStore.activePersona?.name, companionStore.activePersona?.title)}</span>
                            <span class="text-xs">{getCardSuit(companionStore.activePersona?.department)}</span>
                        </div>

                        <!-- Holo-shimmer sweep -->
                        <div class="mc-holo-sweep"></div>

                        <!-- Inner video frame -->
                        <div class="mc-video-inner">
                            <!-- Status badges -->
                            <div class="mc-vid-status-top">
                                <span class="mc-vid-badge">
                                    <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping"></span>
                                    LIVE
                                </span>
                            </div>
                            <div class="mc-vid-status-tr">
                                {#if companionStore.isPlayingAudio}
                                    <span class="mc-vid-state text-amber-400">TX ACTIVE</span>
                                {:else if companionStore.isThinking}
                                    <span class="mc-vid-state text-purple-400 animate-pulse">PROCESSING</span>
                                {:else if isListening}
                                    <span class="mc-vid-state text-green-400 animate-pulse">LISTENING</span>
                                {:else}
                                    <span class="mc-vid-state text-green-500">STANDBY</span>
                                {/if}
                            </div>

                            <!-- Main media -->
                            {#if companionStore.activePersona?.idleVideoUrl || companionStore.activePersona?.videoUrl}
                                <video
                                    bind:this={mainVideoRef}
                                    src={companionStore.activePersona?.idleVideoUrl || companionStore.activePersona?.videoUrl}
                                    loop muted playsinline autoplay
                                    class="w-full h-full object-cover"
                                ></video>
                            {:else}
                                <img src={companionStore.activePersona?.avatarUrl} alt={companionStore.activePersona?.name} class="w-full h-full object-cover" />
                            {/if}

                            <!-- Scanlines -->
                            <div class="mc-scanlines"></div>
                            <!-- Gradient vignette -->
                            <div class="mc-vignette"></div>

                            <!-- EQ spectrum at bottom -->
                            <div class="mc-eq-bar">
                                {#each eqHeights as h}
                                    <div class="mc-eq-band" style="height: {h}%; background:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"></div>
                                {/each}
                            </div>

                            <!-- Animated corner brackets -->
                            <div class="mc-bracket mc-bracket-tl" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"></div>
                            <div class="mc-bracket mc-bracket-tr" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"></div>
                            <div class="mc-bracket mc-bracket-bl" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"></div>
                            <div class="mc-bracket mc-bracket-br" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.7)"></div>

                            <!-- Biometric face-scan reticle -->
                            <div class="mc-reticle" class:mc-reticle-active={!isPersonaSwitching}>
                                <!-- Scan laser -->
                                <div class="mc-scan-laser" style="background:linear-gradient(transparent,hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.25),transparent)"></div>
                                <!-- Face lock box -->
                                <div class="mc-face-lock"
                                     style="left:{faceTrackerX - faceTrackerWidth/2}%;top:{faceTrackerY - faceTrackerHeight/2}%;width:{faceTrackerWidth}%;height:{faceTrackerHeight}%;border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.5)">
                                    <div class="mc-face-corner mc-fc-tl" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))"></div>
                                    <div class="mc-face-corner mc-fc-tr" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))"></div>
                                    <div class="mc-face-corner mc-fc-bl" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))"></div>
                                    <div class="mc-face-corner mc-fc-br" style="border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))"></div>
                                    <div class="mc-biometric-label" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))">ID CONFIRMED</div>
                                </div>
                                <!-- Telemetry readout -->
                                <div class="mc-telemetry">
                                    <span style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))">&#9724;</span>
                                    {companionStore.activePersona?.name}
                                </div>
                            </div>

                            <!-- Webcam PiP -->
                            {#if isCameraOverride}
                                <div class="absolute top-10 right-2 w-20 aspect-video bg-black/85 rounded-md overflow-hidden border border-primary/30 shadow-lg z-30">
                                    <video bind:this={videoElement} autoplay playsinline muted class="w-full h-full object-cover opacity-80"></video>
                                </div>
                            {/if}

                            <!-- Expand toggle -->
                            <button
                                onclick={() => isExpanded = !isExpanded}
                                class="mc-expand-btn"
                                title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                                {#if isExpanded}
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
                                {:else}
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/></svg>
                                {/if}
                            </button>
                        </div>

                        <!-- Card name footer -->
                        <div class="mc-card-footer">
                            <span class="font-black tracking-widest uppercase text-[10px] text-foreground">{companionStore.activePersona?.name}</span>
                            <span class="text-[8px] text-primary/70 font-mono uppercase tracking-wider">{companionStore.activePersona?.department}</span>
                        </div>
                    </div>
                </div>

                <!-- MIDDLE PANEL: Character Dossier Card -->
                <div class="flex flex-col h-full min-h-0">
                    <div class="mc-dossier-card flex-1 flex flex-col min-h-0">
                        <!-- Card corner indices -->
                        <div class="mc-card-index">
                            <span class="text-sm font-black">{getCardIndex(companionStore.activePersona?.name, companionStore.activePersona?.title)}</span>
                            <span class="text-xs">{getCardSuit(companionStore.activePersona?.department)}</span>
                        </div>
                        <div class="mc-card-index mc-card-index--br">
                            <span class="text-sm font-black">{getCardIndex(companionStore.activePersona?.name, companionStore.activePersona?.title)}</span>
                            <span class="text-xs">{getCardSuit(companionStore.activePersona?.department)}</span>
                        </div>

                        <div class="mc-dossier-inner flex-1 flex flex-col overflow-hidden">
                            <!-- Header -->
                            <div class="text-center pt-4 pb-2 px-4 shrink-0">
                                <div class="inline-flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-0.5 mb-2">
                                    <Shield class="w-2.5 h-2.5 text-primary" />
                                    <span class="text-[8px] font-mono text-primary uppercase tracking-widest">{companionStore.activePersona?.department}</span>
                                </div>
                                <h3 class="font-black text-base tracking-wider uppercase text-foreground leading-tight">{companionStore.activePersona?.name}</h3>
                                <p class="text-[10px] text-primary font-mono uppercase tracking-widest mt-0.5">{companionStore.activePersona?.title}</p>
                            </div>

                            <div class="mx-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent shrink-0"></div>

                            <!-- Bio -->
                            <div class="px-4 py-3 shrink-0">
                                <p class="text-[10px] text-muted-foreground/90 leading-relaxed font-sans">{companionStore.activePersona?.description}</p>
                            </div>

                            <div class="mx-4 h-px bg-border/30 shrink-0"></div>

                            <!-- Clearance badge -->
                            <div class="px-4 py-1.5 shrink-0">
                                <div class="mc-clearance-badge">
                                    <span class="mc-clearance-icon">&#9632;</span>
                                    {personaClearance[companionStore.activePersonaId] ?? 'STANDARD ACCESS'}
                                </div>
                            </div>

                            <!-- Radar Chart -->
                            <div class="px-4 pt-1 pb-1 shrink-0">
                                <div class="text-[8px] text-muted-foreground/60 font-mono uppercase tracking-widest mb-1">// Capability Profile</div>
                                <div class="flex justify-center">
                                    <svg viewBox="0 0 100 100" class="mc-radar" style="--pc-h:{activeColor[0]};--pc-s:{activeColor[1]}%;--pc-l:{activeColor[2]}%">
                                        <!-- Grid rings -->
                                        {#each [0.25,0.5,0.75,1.0] as ring}
                                            <polygon
                                                points={getRadarPoints('_grid', 36 * ring)}
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="0.3"
                                                class="text-border/40"
                                            />
                                        {/each}
                                        <!-- Axes -->
                                        {#each radarLabels as _, i}
                                            {@const end = getAxisEnd(i)}
                                            <line x1="50" y1="50" x2={end.x} y2={end.y} stroke="currentColor" stroke-width="0.3" class="text-border/40" />
                                            <text
                                                x={getAxisEnd(i, 46).x}
                                                y={getAxisEnd(i, 46).y}
                                                text-anchor="middle"
                                                dominant-baseline="middle"
                                                font-size="4.5"
                                                class="mc-radar-label"
                                                fill="currentColor"
                                            >{radarLabels[i]}</text>
                                        {/each}
                                        <!-- Data polygon -->
                                        <polygon
                                            points={getRadarPoints(companionStore.activePersonaId)}
                                            fill="hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.15)"
                                            stroke="hsl(var(--pc-h),var(--pc-s),var(--pc-l))"
                                            stroke-width="0.8"
                                            class="mc-radar-data"
                                        />
                                        <!-- Data dots -->
                                        {#each personaStats[companionStore.activePersonaId] ?? [] as v, i}
                                            {@const a = (radarAngles[i] * Math.PI) / 180}
                                            {@const d = (v / 100) * 36}
                                            <circle
                                                cx={50 + d * Math.cos(a)}
                                                cy={50 - d * Math.sin(a)}
                                                r="1.2"
                                                fill="hsl(var(--pc-h),var(--pc-s),var(--pc-l))"
                                            />
                                        {/each}
                                    </svg>
                                </div>
                            </div>

                            <div class="mx-4 h-px bg-border/30 shrink-0"></div>

                            <!-- Protocol Toggles -->
                            <div class="px-4 py-2 flex-1 overflow-y-auto no-scrollbar">
                                <div class="text-[8px] text-muted-foreground/60 font-mono uppercase tracking-widest mb-2">// Active Protocols</div>
                                <div class="flex flex-col gap-1.5">
                                    <div class="mc-protocol-row">
                                        <div class="flex items-center gap-2">
                                            <Eye class="w-3 h-3 text-muted-foreground/60" />
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Ghost Protocol</span>
                                        </div>
                                        <Switch checked={systemStatus.ghostProtocol} onCheckedChange={toggleGhostProtocol} class="scale-[0.7] origin-right" />
                                    </div>
                                    <div class="mc-protocol-row">
                                        <div class="flex items-center gap-2">
                                            <Zap class="w-3 h-3 text-muted-foreground/60" />
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Daemon Loop</span>
                                        </div>
                                        <Switch checked={systemStatus.daemon} onCheckedChange={toggleDaemon} class="scale-[0.7] origin-right" />
                                    </div>
                                    <div class="mc-protocol-row">
                                        <div class="flex items-center gap-2">
                                            <Radio class="w-3 h-3 text-muted-foreground/60" />
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Always-On Mic</span>
                                        </div>
                                        <Switch checked={isMicOverride} onCheckedChange={toggleAlwaysOnMic} class="scale-[0.7] origin-right" />
                                    </div>
                                    <div class="mc-protocol-row">
                                        <div class="flex items-center gap-2">
                                            <Eye class="w-3 h-3 text-muted-foreground/60" />
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Webcam Sensor</span>
                                        </div>
                                        <Switch checked={isCameraOverride} onCheckedChange={toggleCameraOverride} class="scale-[0.7] origin-right" />
                                    </div>
                                </div>
                            </div>

                            <!-- Capability star ratings -->
                            <div class="px-4 pb-1 shrink-0">
                                <div class="text-[8px] text-muted-foreground/60 font-mono uppercase tracking-widest mb-1.5">// Specialization</div>
                                {#each [
                                    { label: 'Cognition', val: Math.round((personaStats[companionStore.activePersonaId]?.[0] ?? 50) / 20) },
                                    { label: 'Authority',  val: Math.round((personaStats[companionStore.activePersonaId]?.[1] ?? 50) / 20) },
                                    { label: 'Technical',  val: Math.round((personaStats[companionStore.activePersonaId]?.[2] ?? 50) / 20) }
                                ] as row}
                                    <div class="flex items-center justify-between text-[8px] mb-0.5">
                                        <span class="font-mono text-muted-foreground/70 uppercase tracking-wide">{row.label}</span>
                                        <span class="mc-stars">
                                            {#each Array(5) as _, si}
                                                <span class={si < row.val ? 'mc-star-on' : 'mc-star-off'}>&#9733;</span>
                                            {/each}
                                        </span>
                                    </div>
                                {/each}
                            </div>

                            <!-- MCP / project badges -->
                            <div class="px-4 pb-3 pt-1 shrink-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <div class="mc-badge-pill">
                                        <span class="w-1 h-1 rounded-full bg-green-400"></span>
                                        MCP: {systemStatus.mcpServers?.length || 0}
                                    </div>
                                    <div class="mc-badge-pill">
                                        <span class="w-1 h-1 rounded-full bg-blue-400"></span>
                                        PROJ: {systemStatus.projects?.length || 0}
                                    </div>
                                    <div class="mc-badge-pill {companionStore.isThinking ? 'text-purple-400' : 'text-muted-foreground'}">
                                        <span class="w-1 h-1 rounded-full {companionStore.isThinking ? 'bg-purple-400 animate-ping' : 'bg-muted-foreground'}"></span>
                                        {companionStore.isThinking ? 'ACTIVE' : 'IDLE'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- RIGHT PANEL: Terminal Dialog -->
                <div class="mc-terminal flex flex-col min-h-0">
                    <canvas bind:this={matrixCanvas} class="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04] dark:opacity-[0.07] rounded-2xl"></canvas>

                    <!-- Terminal titlebar -->
                    <div class="mc-terminal-bar shrink-0">
                        <div class="flex items-center gap-2">
                            <Terminal class="w-3 h-3" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))" />
                            <span class="text-[9px] uppercase tracking-widest text-muted-foreground font-bold font-mono">TERMINAL DIALOG</span>
                            <span class="text-[8px] font-mono text-muted-foreground/40">// {companionStore.messages.filter(m => m.role !== 'system' && !m.hidden).length} entries</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <div class="w-2 h-2 rounded-full bg-red-500/60"></div>
                            <div class="w-2 h-2 rounded-full bg-amber-500/60"></div>
                            <div class="w-2 h-2 rounded-full bg-green-500/60"></div>
                        </div>
                    </div>

                    <!-- Token budget bar -->
                    <div class="mc-token-bar shrink-0">
                        <div class="mc-token-fill {tokenBudget > 85 ? 'mc-token-danger' : tokenBudget > 60 ? 'mc-token-warn' : 'mc-token-ok'}"
                             style="width:{tokenBudget}%"
                        ></div>
                        <span class="mc-token-label {tokenBudget > 85 ? 'text-red-400' : tokenBudget > 60 ? 'text-amber-400' : 'text-muted-foreground/50'}">
                            CTX {Math.round(tokenBudget)}%
                        </span>
                    </div>

                    <!-- Messages -->
                    <div class="flex-1 overflow-y-auto mc-terminal-scroll relative z-20 px-3 py-3 flex flex-col gap-3" id="chat-scroll-container">
                        {#if companionStore.messages.filter(m => m.role !== 'system' && !m.hidden).length === 0}
                            <div class="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                                <BrainCircuit class="w-8 h-8 text-primary" />
                                <span class="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">System online. Awaiting input...</span>
                            </div>
                        {/if}

                        {#each companionStore.messages.filter(m => m.role !== 'system' && !m.hidden) as msg, i}
                            {@const isLastAssistant = msg.role === 'assistant' && (() => {
                                const nonSys = companionStore.messages.filter(m => m.role !== 'system' && !m.hidden);
                                return i === nonSys.length - 1;
                            })()}
                            <div
                                class="flex flex-col {msg.role === 'user' ? 'items-end' : 'items-start'} gap-1"
                                in:fly={{ x: msg.role === 'user' ? 30 : -30, duration: 280, opacity: 0 }}
                            >
                                <div class="flex items-center gap-2 {msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}">
                                    {#if msg.role !== 'user'}
                                        <div class="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                                             style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.12);border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.35)">
                                            <BrainCircuit class="w-2.5 h-2.5" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))" />
                                        </div>
                                    {/if}
                                    <span class="text-[8px] text-muted-foreground/50 tracking-widest uppercase font-mono">
                                        {msg.role === 'user' ? 'YOU' : (companionStore.activePersona?.name?.split(' ')[0] || 'SYS')}
                                    </span>
                                    <span class="text-[7px] text-muted-foreground/30 font-mono">{new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})}</span>
                                </div>
                                {#if msg.role === 'user'}
                                    <div class="mc-msg-user" style="background:hsl(var(--pc-h),var(--pc-s),calc(var(--pc-l) - 5%));box-shadow:0 2px 12px hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.2)">
                                        {msg.content}
                                    </div>
                                {:else}
                                    <div class="relative group w-full">
                                        <div class="mc-msg-assistant prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1 prose-pre:bg-black/40"
                                             style="border-left-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.5);prose-code:color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))">
                                            <MarkdownContent content={typeof msg.content === 'string' ? msg.content : ''} />
                                        </div>
                                        {#if isLastAssistant && !companionStore.isThinking}
                                            <button
                                                onclick={() => companionStore.regenerateLastResponse()}
                                                title="Regenerate"
                                                class="mc-retry-btn opacity-0 group-hover:opacity-100"
                                            >
                                                <RotateCcw class="w-2.5 h-2.5" />
                                                RETRY
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        {/each}

                        {#if companionStore.isThinking || typedText}
                            <div class="flex flex-col items-start gap-1" in:fly={{ x: -30, duration: 280, opacity: 0 }}>
                                <div class="flex items-center gap-2">
                                    <div class="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                                         style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.12);border-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.35)">
                                        <BrainCircuit class="w-2.5 h-2.5 animate-pulse" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l))" />
                                    </div>
                                    <span class="text-[8px] tracking-widest uppercase font-mono animate-pulse" style="color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.8)">PROCESSING...</span>
                                </div>
                                <div class="mc-msg-assistant" style="border-left-color:hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.5)">
                                    {#if typedText}
                                        <div class="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                                            <MarkdownContent content={typedText} />
                                        </div>
                                    {:else}
                                        <div class="flex items-center gap-1.5 py-0.5">
                                            <span class="w-1.5 h-1.5 rounded-full animate-bounce" style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l));animation-delay:0ms"></span>
                                            <span class="w-1.5 h-1.5 rounded-full animate-bounce" style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l));animation-delay:150ms"></span>
                                            <span class="w-1.5 h-1.5 rounded-full animate-bounce" style="background:hsl(var(--pc-h),var(--pc-s),var(--pc-l));animation-delay:300ms"></span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

            </div>

            <!-- MEMORY TIMELINE -->
            {#if companionStore.messages.filter(m => m.role !== 'system' && !m.hidden).length > 0}
                <div class="mc-timeline shrink-0">
                    <div class="mc-timeline-track">
                        {#each companionStore.messages.filter(m => m.role !== 'system' && !m.hidden) as msg, i}
                            <div
                                class="mc-timeline-dot {msg.role === 'user' ? 'mc-td-user' : 'mc-td-ai'}"
                                style="{msg.role !== 'user' ? `background:hsl(var(--pc-h),var(--pc-s),var(--pc-l));box-shadow:0 0 4px hsl(var(--pc-h),var(--pc-s),var(--pc-l),0.6)` : ''}"
                                title="{msg.role === 'user' ? 'You' : companionStore.activePersona?.name}: {(typeof msg.content === 'string' ? msg.content : '').substring(0,60)}..."
                            ></div>
                        {/each}
                    </div>
                    <span class="mc-timeline-label">{companionStore.messages.filter(m => m.role !== 'system' && !m.hidden).length} exchanges</span>
                </div>
            {/if}

            <!-- BOTTOM HUD STATUS STRIP -->
            <div class="mc-status-strip shrink-0">
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[8px] font-mono text-muted-foreground/60 uppercase">COG</span>
                        <span class="text-[8px] font-mono font-bold {companionStore.isThinking ? 'text-purple-400' : 'text-green-400'}">
                            {companionStore.isThinking ? 'PROCESSING' : 'READY'}
                        </span>
                    </div>
                    <div class="w-px h-3 bg-border/40"></div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-[8px] font-mono text-muted-foreground/60 uppercase">VOC</span>
                        <span class="text-[8px] font-mono font-bold {companionStore.isPlayingAudio ? 'text-amber-400 animate-pulse' : 'text-green-400'}">
                            {companionStore.isPlayingAudio ? 'TX' : 'RDY'}
                        </span>
                    </div>
                    <div class="w-px h-3 bg-border/40"></div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-[8px] font-mono text-muted-foreground/60 uppercase">MEM</span>
                        <span class="text-[8px] font-mono font-bold {memoryHeapPct > 80 ? 'text-amber-400' : 'text-primary'}">{Math.round(memoryHeapPct)}%</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 max-w-[50%] truncate">
                    <ChevronRight class="w-3 h-3 text-primary/50 shrink-0" />
                    <span class="text-[8px] font-mono text-muted-foreground/60 uppercase shrink-0">FOCUS</span>
                    <span class="text-[8px] font-mono text-primary truncate" title={companionStore.activeFile?.path}>{companionStore.activeFile?.file || 'NONE'}</span>
                </div>
            </div>

            {#if modelsStore.loadedModelIds.length === 0}
                <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[10px] font-mono font-bold tracking-wide shrink-0">
                    <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
                    NO MODEL LOADED -- Navigate to Model Management to load one.
                </div>
            {/if}

            <!-- COMMAND INPUT BAR -->
            <div class="mc-cmd-bar shrink-0">
                <!-- Left: oscilloscope + auto-listen -->
                <div class="flex items-center gap-2 shrink-0">
                    <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[7px] font-mono text-muted-foreground/60 uppercase tracking-widest leading-none">AUTO</span>
                        <Switch checked={isMicOverride} onCheckedChange={toggleAlwaysOnMic} class="scale-[0.65] origin-center" />
                    </div>
                    <div class="mc-cmd-oscilloscope">
                        <canvas bind:this={oscilloscopeCanvas} width="80" height="32" class="w-full h-full"></canvas>
                        {#if !companionStore.isPlayingAudio && !isListening}
                            <div class="absolute inset-0 flex items-center justify-center">
                                <div class="w-full h-px bg-primary/20"></div>
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Mic button -->
                <Button
                    variant="outline"
                    size="icon"
                    class="mc-mic-btn {isListening ? 'mc-mic-btn--active' : isPreparingMic || isTranscribing ? 'mc-mic-btn--busy' : ''}"
                    onclick={toggleListening}
                    disabled={isPreparingMic || isTranscribing || modelsStore.loadedModelIds.length === 0}
                >
                    <Mic class="h-4 w-4" />
                </Button>

                <!-- Text input -->
                <div class="flex-1 relative">
                    <Textarea
                        bind:value={inputText}
                        placeholder={isPreparingMic ? 'PREPARING AUDIO SYSTEMS...' : isTranscribing ? 'TRANSCRIBING...' : isListening ? 'LISTENING...' : modelsStore.loadedModelIds.length === 0 ? 'LOAD A MODEL TO BEGIN...' : 'ENTER COMMAND...'}
                        class="mc-cmd-input resize-none"
                        onkeydown={handleCommandKeyDown}
                    />
                    {#if historyIndex >= 0}
                        <div class="absolute bottom-full left-0 mb-1 text-[7px] font-mono text-muted-foreground/50 uppercase tracking-wider pointer-events-none">
                            history [{historyIndex + 1}/{commandHistory.length}] &uarr;&darr;
                        </div>
                    {/if}
                </div>

                <!-- Send / Stop -->
                {#if companionStore.isThinking}
                    <Button
                        size="icon"
                        variant="destructive"
                        class="mc-send-btn animate-pulse"
                        onclick={() => companionStore.stopGeneration()}
                        title="Stop generation"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>
                    </Button>
                {:else}
                    <Button
                        size="icon"
                        class="mc-send-btn"
                        onclick={handleSend}
                        disabled={!inputText.trim() || modelsStore.loadedModelIds.length === 0}
                    >
                        <SendHorizontal class="h-4 w-4" />
                    </Button>
                {/if}
            </div>


            
        </div>
        
    </div>

    {#if isSettingsOpen}
        <div class="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" transition:fade={{duration: 150}}>
            <div class="bg-card w-full max-w-lg border border-border shadow-2xl p-6 flex flex-col gap-6 rounded-3xl" transition:scale={{ start: 0.95, duration: 150 }}>
                
                <div class="flex items-center justify-between border-b border-border pb-4">
                    <h2 class="text-base font-bold text-foreground tracking-wide uppercase flex items-center gap-2">
                        <Settings class="h-4.5 w-4.5 text-muted-foreground" /> Core Parameters
                    </h2>
                    <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-foreground" onclick={() => isSettingsOpen = false}>
                        <X class="h-5 w-5" />
                    </Button>
                </div>

                <div class="space-y-4 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/10 p-4 rounded-2xl border border-border/40 backdrop-blur-md">
                        <div class="flex flex-col space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Active Persona</Label>
                            <div class="bg-muted border border-border text-foreground rounded-xl px-3 py-2 text-xs font-mono">{companionStore.activePersona?.name}</div>
                        </div>
                        
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">SUMMON KEYPHRASE (WAKE WORD)</Label>
                            <Input bind:value={companionStore.wakeWord} placeholder="e.g. hey llama" class="bg-background border-border text-foreground rounded-xl h-9 text-xs font-mono" />
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/10 p-4 rounded-2xl border border-border/40 backdrop-blur-md">
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>VAD SILENCE WINDOW</span>
                                <span class="text-primary font-bold">{companionStore.vadSilenceTimeout}ms</span>
                            </div>
                            <input type="range" min="500" max="3000" step="100" bind:value={companionStore.vadSilenceTimeout} class="w-full accent-primary bg-muted rounded-lg appearance-none cursor-pointer h-1.5" />
                        </div>
                        
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>MIC SENSITIVITY THRESHOLD</span>
                                <span class="text-primary font-bold">{companionStore.vadVolumeThreshold.toFixed(3)}</span>
                            </div>
                            <input type="range" min="0.005" max="0.100" step="0.005" bind:value={companionStore.vadVolumeThreshold} class="w-full accent-primary bg-muted rounded-lg appearance-none cursor-pointer h-1.5" />
                        </div>
                    </div>
                    
                    <div class="border-t border-border/60 pt-4 space-y-4">
                        <Label class="text-xs uppercase text-primary font-bold tracking-wider">Autonomous Operations</Label>
                        
                        <!-- Compiler Self-Repair -->
                        <div class="flex items-center justify-between gap-4 bg-muted/20 p-3 rounded-xl border border-border/40">
                            <div class="space-y-0.5">
                                <div class="text-[10px] font-bold text-foreground uppercase tracking-wider font-bold">Compiler Self-Repair</div>
                                <div class="text-[9px] text-muted-foreground">Scan typescript errors and auto-repair compile issues.</div>
                            </div>
                            <Button size="sm" variant="outline" class="rounded-xl uppercase text-[9px] font-bold shrink-0 tracking-wider" onclick={triggerSelfRepair} disabled={isSelfRepairing}>
                                {isSelfRepairing ? 'REPAIRING...' : 'RUN REPAIR'}
                            </Button>
                        </div>
                        
                        <!-- Autonomous Self-Improvement -->
                        <div class="bg-muted/20 p-3 rounded-xl border border-border/40 space-y-3">
                            <div class="flex items-center justify-between gap-4">
                                <div class="space-y-0.5">
                                    <div class="text-[10px] font-bold text-foreground uppercase tracking-wider font-bold">Self-Improvement Daemon</div>
                                    <div class="text-[9px] text-muted-foreground">Scrapes the internet for latest tech trends and refactors its own codebase.</div>
                                </div>
                                <Button size="sm" variant="outline" class="rounded-xl uppercase text-[9px] font-bold shrink-0 tracking-wider" onclick={triggerSelfImprovement} disabled={isSelfImproving}>
                                    {isSelfImproving ? 'UPGRADING...' : 'RUN SCAN'}
                                </Button>
                            </div>
                            <div class="flex items-center justify-between border-t border-border/20 pt-2 text-[9px]">
                                <span class="text-muted-foreground uppercase font-semibold">Continuous Daily Self-Improvement Loop</span>
                                <input type="checkbox" checked={companionStore.selfImproveContinuous} onchange={(e) => companionStore.toggleSelfImproveContinuous(e.currentTarget.checked)} class="w-4 h-4 rounded border-border accent-primary cursor-pointer" />
                            </div>
                        </div>
                        
                        <!-- Dynamic MCP Server Installer -->
                        <div class="bg-muted/20 p-3 rounded-xl border border-border/40 space-y-2">
                            <div class="text-[10px] font-bold text-foreground uppercase tracking-wider">Install Dynamic MCP Server</div>
                            <div class="flex gap-2">
                                <Input bind:value={mcpInstallName} placeholder="npm-package-name" class="bg-background border-border text-foreground rounded-xl h-8 text-[10px] font-mono" />
                                <select bind:value={mcpInstallManager} class="bg-background border border-border text-foreground text-[10px] rounded-xl px-2 h-8 outline-none">
                                    <option value="npm">NPM</option>
                                    <option value="pip">PIP</option>
                                </select>
                                <Button size="sm" class="rounded-xl uppercase text-[9px] font-bold shrink-0 tracking-wider h-8" onclick={triggerMcpInstall} disabled={isMcpInstalling}>
                                    {isMcpInstalling ? 'INSTALLING...' : 'INSTALL'}
                                </Button>
                            </div>
                        </div>

                        <!-- Self-Improvement Logs -->
                        <div class="bg-muted/20 p-3 rounded-xl border border-border/40 space-y-2">
                            <div class="text-[10px] font-bold text-foreground uppercase tracking-wider font-bold">Upgrade & Improvement Logs</div>
                            {#if upgradeLogs.length === 0}
                                <div class="text-[8px] text-muted-foreground italic font-mono uppercase">No upgrade logs compiled. Run scan to initialize.</div>
                            {:else}
                                <div class="max-h-[100px] overflow-y-auto space-y-1.5 pr-1 no-scrollbar">
                                    {#each upgradeLogs as log}
                                        <div class="text-[8px] font-mono text-muted-foreground bg-background border border-border/20 p-1.5 rounded-lg flex justify-between gap-2">
                                            <div class="truncate">
                                                <span class="text-primary font-bold">UPGRADE:</span> Optimized {log.file}
                                            </div>
                                            <span class="shrink-0 text-muted-foreground/60">{new Date(log.timestamp * 1000).toLocaleDateString()}</span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
                
                <div class="flex justify-end pt-4 border-t border-border gap-3">
                    <Button variant="outline" class="rounded-xl" onclick={() => isSettingsOpen = false}>Cancel</Button>
                    <Button class="rounded-xl uppercase tracking-wider font-bold text-xs" onclick={() => { companionStore.saveSettings(); isSettingsOpen = false; }}>Save Parameters</Button>
                </div>
                
            </div>
        </div>
    {/if}
    <!-- Holographic HUD Toast Notification Queue -->
    <div class="absolute top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-xs">
        {#each companionStore.toasts as toast (toast.id)}
            <div class="pointer-events-auto bg-zinc-950/85 border border-primary/30 rounded-xl p-3 shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)] backdrop-blur-md text-[10px] font-mono uppercase tracking-wider flex items-center justify-between gap-3 text-foreground transition-all duration-300" transition:fade={{duration: 150}}>
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
                    <span>{toast.message}</span>
                </div>
                <button class="text-[9px] text-muted-foreground hover:text-foreground" onclick={() => companionStore.toasts = companionStore.toasts.filter(t => t.id !== toast.id)}>✕</button>
            </div>
        {/each}
    </div>
{/if}

<style>
    /* ---- Scrollbar: persona-tinted thin scrollbar in terminal ---- */
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .mc-terminal-scroll::-webkit-scrollbar { width: 3px; }
    .mc-terminal-scroll::-webkit-scrollbar-track { background: transparent; }
    .mc-terminal-scroll::-webkit-scrollbar-thumb {
        background: hsl(var(--pc-h, 200) var(--pc-s, 80%) var(--pc-l, 50%) / 0.35);
        border-radius: 9999px;
    }
    .mc-terminal-scroll::-webkit-scrollbar-thumb:hover {
        background: hsl(var(--pc-h, 200) var(--pc-s, 80%) var(--pc-l, 50%) / 0.6);
    }
    .mc-terminal-scroll { scrollbar-width: thin; scrollbar-color: hsl(var(--pc-h, 200) var(--pc-s, 80%) var(--pc-l, 50%) / 0.35) transparent; }

    /* ---- Root ---- */
    .mc-root { background: var(--background); }

    /* ---- Top bar ---- */
    .mc-topbar {
        display: flex; align-items: center; justify-content: space-between;
        background: color-mix(in srgb, var(--card) 85%, transparent);
        border: 1px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.28);
        border-radius: 1rem;
        backdrop-filter: blur(16px);
        padding: 0.5rem 0.6rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.03), 0 0 16px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.08);
        transition: border-color 0.5s, box-shadow 0.5s;
    }
    .mc-topbar-pill {
        display: flex; align-items: center; gap: 0.375rem;
        font-size: 0.5rem; font-family: monospace; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.14em;
        padding: 0.22rem 0.65rem;
        background: color-mix(in srgb, var(--muted) 30%, transparent);
        border: 1px solid;
        border-radius: 9999px;
        transition: color 0.5s, border-color 0.5s;
    }
    .mc-status-orb {
        width: 9px; height: 9px; border-radius: 50%;
        transition: background 0.5s, box-shadow 0.5s;
        flex-shrink: 0;
    }
    .orb-ready   { animation: orbPulse 2s ease-in-out infinite alternate; }
    .orb-thinking { animation: orbPulse 0.8s ease-in-out infinite alternate; }
    .orb-speaking { animation: orbPulse 0.45s ease-in-out infinite alternate; }
    @keyframes orbPulse { from { transform: scale(1); opacity: 0.8; } to { transform: scale(1.5); opacity: 1; } }

    /* ---- Carousel ---- */
    .mc-carousel {
        display: flex; align-items: center; gap: 0.6rem;
        overflow-x: auto; padding: 0.5rem 0.25rem 1rem;
        scrollbar-width: none;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
    }
    .mc-carousel::-webkit-scrollbar { display: none; }
    .mc-carousel-item {
        position: relative; flex-shrink: 0;
        width: 72px; height: 72px;
        border-radius: 0.75rem;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        opacity: 0.55;
        border: 1.5px solid transparent;
        overflow: hidden;
    }
    .mc-carousel-item:hover { opacity: 0.9; transform: scale(1.08); }
    .mc-carousel-item--active {
        opacity: 1; transform: scale(1.25);
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l));
        box-shadow: 0 0 18px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.6);
        z-index: 20;
    }
    .mc-carousel-label {
        position: absolute; bottom: 0; left: 0; right: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
        font-size: 0.45rem; font-weight: 900; text-transform: uppercase;
        letter-spacing: 0.08em; color: white;
        padding: 0.2rem 0.25rem 0.25rem; text-align: center;
    }

    /* ---- Video Card ---- */
    .mc-video-card {
        position: relative; width: 100%; height: 100%;
        border: 2px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.22);
        border-radius: 1.25rem;
        background: var(--card);
        overflow: hidden;
        display: flex; flex-direction: column;
        transition: border-color 0.5s ease, box-shadow 0.5s ease;
        box-shadow: 0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.03);
    }
    .mc-video-card:hover {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.5);
        box-shadow: 0 8px 40px rgba(0,0,0,0.35), 0 0 20px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.15);
    }
    .mc-card-thinking {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l)) !important;
        box-shadow: 0 0 32px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.5), 0 8px 40px rgba(0,0,0,0.35) !important;
        animation: cardBreath 0.85s ease-in-out infinite alternate;
    }
    .mc-card-speaking {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l)) !important;
        box-shadow: 0 0 24px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.45), 0 8px 40px rgba(0,0,0,0.35) !important;
        animation: cardBreath 0.45s ease-in-out infinite alternate;
    }
    .mc-card-listening {
        border-color: #22c55e !important;
        box-shadow: 0 0 22px #22c55e50, 0 8px 40px rgba(0,0,0,0.35) !important;
        animation: cardBreath 1.4s ease-in-out infinite alternate;
    }
    @keyframes cardBreath {
        from { box-shadow: 0 0 18px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.32), 0 8px 40px rgba(0,0,0,0.35); }
        to   { box-shadow: 0 0 48px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.68), 0 8px 40px rgba(0,0,0,0.35); }
    }
    .mc-holo-sweep {
        position: absolute; inset: 0; z-index: 30;
        background: linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%);
        background-size: 200% 200%;
        animation: holoSweep 4s linear infinite;
        pointer-events: none;
    }
    @keyframes holoSweep {
        0%   { background-position: 200% 200%; }
        100% { background-position: -100% -100%; }
    }
    .mc-card-index {
        position: absolute; top: 0.5rem; left: 0.5rem; z-index: 40;
        display: flex; flex-direction: column; align-items: center;
        color: hsl(var(--pc-h) var(--pc-s) var(--pc-l)); font-family: monospace;
        line-height: 1; user-select: none;
        text-shadow: 0 0 10px currentColor;
        transition: color 0.5s;
    }
    .mc-card-index--br {
        top: auto; left: auto;
        bottom: 0.5rem; right: 0.5rem;
        transform: rotate(180deg);
    }
    .mc-video-inner {
        flex: 1; position: relative;
        border: 1px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.18);
        border-radius: 1rem; overflow: hidden; margin: 0.5rem;
        background: #000;
        transition: border-color 0.5s;
    }
    .mc-vid-status-top {
        position: absolute; top: 0.5rem; left: 0.75rem;
        display: flex; align-items: center; gap: 0.5rem;
        z-index: 25;
    }
    .mc-vid-badge {
        display: flex; align-items: center; gap: 0.375rem;
        font-size: 0.5rem; font-family: monospace; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.12em;
        color: #4ade80;
        background: rgba(0,0,0,0.6);
        border: 1px solid rgba(74,222,128,0.3);
        padding: 0.15rem 0.4rem; border-radius: 4px;
    }
    .mc-vid-status-tr {
        position: absolute; top: 0.5rem; right: 0.75rem;
        z-index: 25;
    }
    .mc-vid-state {
        font-size: 0.5rem; font-family: monospace; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.12em;
        background: rgba(0,0,0,0.65);
        padding: 0.15rem 0.4rem; border-radius: 4px;
    }
    .mc-scanlines {
        position: absolute; inset: 0; pointer-events: none; z-index: 10;
        background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px);
    }
    .mc-vignette {
        position: absolute; inset: 0; pointer-events: none; z-index: 11;
        background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%);
    }
    .mc-eq-bar {
        position: absolute; bottom: 0; left: 0; right: 0;
        height: 48px; display: flex; align-items: flex-end;
        justify-content: space-between; padding: 0 0.5rem 0.25rem;
        gap: 1px; pointer-events: none; z-index: 20;
    }
    .mc-eq-band {
        flex: 1;
        background: hsl(var(--primary) / 0.65);
        border-radius: 2px 2px 0 0;
        transition: height 75ms linear;
    }
    .mc-bracket {
        position: absolute; width: 10px; height: 10px; z-index: 22;
        border-color: hsl(var(--primary) / 0.6);
        border-style: solid;
        animation: bracketPulse 2s ease-in-out infinite alternate;
    }
    .mc-bracket-tl { top: 0.3rem; left: 0.3rem; border-width: 1.5px 0 0 1.5px; }
    .mc-bracket-tr { top: 0.3rem; right: 0.3rem; border-width: 1.5px 1.5px 0 0; }
    .mc-bracket-bl { bottom: 0.3rem; left: 0.3rem; border-width: 0 0 1.5px 1.5px; }
    .mc-bracket-br { bottom: 0.3rem; right: 0.3rem; border-width: 0 1.5px 1.5px 0; }
    @keyframes bracketPulse { from { opacity: 0.4; } to { opacity: 1; } }
    .mc-card-footer {
        display: flex; flex-direction: column; align-items: center;
        padding: 0.4rem 0.75rem 0.5rem;
        background: linear-gradient(to top, rgba(0,0,0,0.5), transparent);
        gap: 0.1rem;
    }

    /* ---- Dossier Card ---- */
    .mc-dossier-card {
        position: relative;
        border: 2px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.18);
        border-radius: 1.25rem;
        background: var(--card);
        box-shadow: 0 8px 32px rgba(0,0,0,0.25);
        overflow: hidden;
        transition: border-color 0.5s, box-shadow 0.5s;
    }
    .mc-dossier-card:hover {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.4);
        box-shadow: 0 8px 32px rgba(0,0,0,0.25), 0 0 24px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.08);
    }
    .mc-dossier-inner {
        border: 1px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.08);
        border-radius: 1rem;
        margin: 0.5rem;
    }
    .mc-stat-bar {
        width: 100%; height: 3px;
        background: color-mix(in srgb, var(--muted) 80%, transparent);
        border-radius: 9999px; overflow: hidden;
    }
    .mc-stat-fill {
        height: 100%; border-radius: 9999px;
        transition: width 0.4s ease;
    }
    .mc-protocol-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.35rem 0.5rem;
        border-radius: 0.5rem;
        background: color-mix(in srgb, var(--muted) 20%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
        transition: background 0.2s;
    }
    .mc-protocol-row:hover {
        background: color-mix(in srgb, var(--muted) 40%, transparent);
    }
    .mc-badge-pill {
        display: flex; align-items: center; gap: 0.3rem;
        font-size: 0.5rem; font-family: monospace; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.12em;
        padding: 0.2rem 0.6rem;
        background: hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.07);
        border: 1px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.22);
        border-radius: 9999px;
        color: hsl(var(--pc-h) var(--pc-s) calc(var(--pc-l) + 10%) / 0.75);
        transition: background 0.4s, border-color 0.4s, color 0.4s;
    }

    /* ---- Terminal ---- */
    .mc-terminal {
        position: relative;
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
        border-radius: 1rem;
        background: color-mix(in srgb, var(--card) 95%, transparent);
        box-shadow: inset 0 0 40px rgba(0,0,0,0.15), 0 4px 24px rgba(0,0,0,0.2);
        overflow: hidden;
    }
    .mc-terminal-bar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.4rem 0.75rem;
        background: color-mix(in srgb, var(--muted) 40%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
        backdrop-filter: blur(8px);
    }
    .mc-msg-user {
        max-width: 85%;
        padding: 0.5rem 0.75rem;
        border-radius: 1rem 1rem 0.25rem 1rem;
        font-size: 0.8rem; line-height: 1.5;
        white-space: pre-wrap;
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
        border: 1px solid color-mix(in srgb, hsl(var(--primary)) 60%, transparent);
        box-shadow: 0 2px 12px color-mix(in srgb, hsl(var(--primary)) 25%, transparent);
    }
    .mc-msg-assistant {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border-radius: 0.25rem 1rem 1rem 1rem;
        font-size: 0.8rem; line-height: 1.5;
        background: color-mix(in srgb, var(--muted) 60%, transparent);
        color: var(--foreground);
        border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
        border-left: 2px solid color-mix(in srgb, hsl(var(--primary)) 50%, transparent);
    }
    .mc-retry-btn {
        position: absolute; bottom: -0.5rem; right: 0.25rem;
        display: flex; align-items: center; gap: 0.25rem;
        padding: 0.15rem 0.5rem;
        border-radius: 9999px;
        background: var(--muted);
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
        color: var(--muted-foreground);
        font-size: 0.5rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.1em;
        cursor: pointer; transition: all 0.2s;
    }
    .mc-retry-btn:hover { color: var(--foreground); }

    /* ---- Status strip ---- */
    .mc-status-strip {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.35rem 0.75rem;
        background: color-mix(in srgb, var(--card) 60%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
        border-radius: 0.75rem;
        backdrop-filter: blur(8px);
    }

    /* ---- Terminal panel ---- */
    .mc-terminal-panel {
        border: 1px solid hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.18);
        transition: border-color 0.5s;
    }
    .mc-terminal-panel:focus-within {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.35);
        box-shadow: 0 0 20px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.06);
    }

    /* ---- Command bar ---- */
    .mc-cmd-bar {
        display: flex; align-items: center; gap: 0.625rem;
        padding: 0.625rem 0.75rem;
        background: color-mix(in srgb, var(--card) 80%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
        border-radius: 1rem;
        backdrop-filter: blur(16px);
        box-shadow: 0 -2px 24px rgba(0,0,0,0.15), 0 0 0 1px color-mix(in srgb, hsl(var(--primary)) 10%, transparent);
    }
    .mc-cmd-oscilloscope {
        position: relative;
        width: 80px; height: 32px;
        background: color-mix(in srgb, var(--muted) 30%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
        border-radius: 0.5rem;
        overflow: hidden;
        flex-shrink: 0;
    }
    .mc-mic-btn {
        width: 2.5rem; height: 2.5rem;
        flex-shrink: 0; border-radius: 0.75rem;
        transition: all 0.3s;
    }
    .mc-mic-btn--active {
        background: #22c55e !important;
        color: white !important;
        border-color: transparent !important;
        box-shadow: 0 0 16px #22c55e60 !important;
        animation: micPulse 1s ease-in-out infinite;
    }
    .mc-mic-btn--busy {
        background: color-mix(in srgb, var(--muted) 60%, transparent);
        animation: micPulse 2s ease-in-out infinite;
    }
    @keyframes micPulse { 0%,100% { box-shadow: 0 0 8px currentColor; } 50% { box-shadow: 0 0 20px currentColor; } }
    .mc-cmd-input {
        width: 100%;
        min-height: 2.5rem; max-height: 7rem;
        padding: 0.5rem 0.75rem;
        background: color-mix(in srgb, var(--background) 70%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
        border-radius: 0.75rem;
        font-size: 0.8rem;
        font-family: monospace; letter-spacing: 0.02em;
        color: var(--foreground);
        resize: none;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
    }
    .mc-cmd-input::placeholder {
        color: var(--muted-foreground); opacity: 0.5;
        text-transform: uppercase; font-size: 0.7rem;
        letter-spacing: 0.08em;
    }
    .mc-cmd-input:focus {
        border-color: hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.5);
        box-shadow: 0 0 0 2px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.12);
    }
    .mc-send-btn {
        width: 2.5rem; height: 2.5rem;
        flex-shrink: 0; border-radius: 0.75rem;
        transition: box-shadow 0.2s;
    }
    .mc-send-btn:not([disabled]):hover {
        box-shadow: 0 0 14px hsl(var(--pc-h) var(--pc-s) var(--pc-l) / 0.45);
    }

    /* ---- Glitch ---- */
    @keyframes hudGlitch {
        0%   { clip-path: inset(40% 0 61% 0); transform: skew(0.3deg); }
        20%  { clip-path: inset(92% 0 1% 0);  transform: skew(-0.5deg); }
        40%  { clip-path: inset(15% 0 80% 0); transform: skew(0.8deg); }
        60%  { clip-path: inset(80% 0 5% 0);  transform: skew(-0.3deg); }
        80%  { clip-path: inset(3% 0 92% 0);  transform: skew(0.5deg); }
        100% { clip-path: inset(40% 0 61% 0); transform: skew(0deg); }
    }
    .hud-glitched {
        animation: hudGlitch 0.25s linear infinite;
        filter: hue-rotate(90deg) saturate(1.5);
    }
    @keyframes scanLaser {
        0% { top: 0%; } 50% { top: 100%; } 100% { top: 0%; }
    }

    /* ---- Persona card glitch transition ---- */
    @keyframes cardGlitch {
        0%   { opacity:1; transform:translateX(0) skewX(0deg); filter:none; }
        10%  { opacity:0.6; transform:translateX(-4px) skewX(-2deg); filter:hue-rotate(90deg) saturate(3); }
        20%  { opacity:0.8; transform:translateX(6px) skewX(1deg);  filter:invert(0.1); }
        35%  { opacity:0.5; transform:translateX(-3px) skewX(3deg); filter:hue-rotate(180deg); }
        50%  { opacity:0.9; transform:translateX(2px); filter:none; }
        70%  { opacity:0.7; transform:translateX(-2px) skewX(-1deg); filter:brightness(1.4); }
        100% { opacity:1; transform:translateX(0) skewX(0deg); filter:none; }
    }
    .mc-card-glitch {
        animation: cardGlitch 0.6s steps(1) forwards;
    }
    .mc-card-glitch::after {
        content: '';
        position: absolute; inset: 0;
        background: repeating-linear-gradient(
            transparent 0px, transparent 3px,
            rgba(255,255,255,0.03) 3px, rgba(255,255,255,0.03) 4px
        );
        animation: cardGlitch 0.6s steps(1) forwards;
        mix-blend-mode: screen;
        pointer-events: none;
    }

    /* ---- Particles canvas ---- */
    .mc-particles-canvas {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 0;
        opacity: 0.6;
    }

    /* ---- Ambient glow ---- */
    .mc-ambient-glow {
        position: absolute; inset: 0;
        pointer-events: none;
        z-index: 0;
        transition: opacity 1.2s ease;
    }
    .mc-glow-active { opacity: 1.8; }
    .mc-glow-speak  { opacity: 1.4; }

    /* ---- Biometric reticle ---- */
    .mc-reticle {
        position: absolute; inset: 0;
        pointer-events: none;
        z-index: 20;
        opacity: 0;
        transition: opacity 0.5s ease;
    }
    .mc-reticle-active { opacity: 1; }

    /* Scan laser */
    .mc-scan-laser {
        position: absolute;
        left: 0; right: 0;
        height: 6px;
        top: 0;
        animation: scanLaser 3s linear infinite;
        pointer-events: none;
    }

    /* Face lock box */
    .mc-face-lock {
        position: absolute;
        border: 1px solid;
        border-radius: 2px;
        transition: all 1.2s ease;
    }

    /* Face corner accent marks */
    .mc-face-corner {
        position: absolute;
        width: 8px; height: 8px;
        border-style: solid;
        border-color: inherit;
    }
    .mc-fc-tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
    .mc-fc-tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; }
    .mc-fc-bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
    .mc-fc-br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }

    .mc-biometric-label {
        position: absolute;
        bottom: calc(100% + 3px); left: 50%;
        transform: translateX(-50%);
        font-size: 5px; font-family: monospace;
        font-weight: 700; letter-spacing: 0.15em;
        white-space: nowrap; opacity: 0.9;
    }
    .mc-telemetry {
        position: absolute;
        bottom: 4px; left: 6px;
        font-size: 6px; font-family: monospace;
        color: rgba(255,255,255,0.6);
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    /* ---- Expand button ---- */
    .mc-expand-btn {
        position: absolute; top: 6px; right: 6px;
        width: 20px; height: 20px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        color: rgba(255,255,255,0.7);
        cursor: pointer; z-index: 30;
        transition: all 0.15s;
    }
    .mc-expand-btn:hover { background: rgba(0,0,0,0.7); color: white; }

    /* ---- Radar chart ---- */
    .mc-radar {
        width: 120px; height: 120px;
        overflow: visible;
    }
    .mc-radar-label {
        fill: hsl(var(--muted-foreground) / 0.6);
        font-family: monospace;
        font-weight: 600;
        letter-spacing: 0.04em;
    }
    .mc-radar-data {
        transition: all 0.6s cubic-bezier(0.34,1.56,0.64,1);
    }

    /* ---- Clearance badge ---- */
    .mc-clearance-badge {
        display: flex; align-items: center; gap: 0.375rem;
        padding: 0.25rem 0.6rem;
        background: linear-gradient(90deg, rgba(255,50,50,0.08), rgba(255,100,50,0.05));
        border: 1px solid rgba(255,80,80,0.25);
        border-radius: 4px;
        font-size: 0.5rem; font-family: monospace;
        font-weight: 800; letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(255, 120, 120, 0.85);
    }
    .mc-clearance-icon {
        font-size: 0.45rem;
        color: rgba(255,80,80,0.7);
        animation: clearancePulse 2s ease-in-out infinite;
    }
    @keyframes clearancePulse {
        0%,100% { opacity: 0.5; } 50% { opacity: 1; }
    }

    /* ---- Star ratings ---- */
    .mc-stars { display: flex; gap: 1px; }
    .mc-star-on  { color: hsl(var(--pc-h, 200), var(--pc-s, 80%), var(--pc-l, 50%)); font-size: 0.65rem; }
    .mc-star-off { color: rgba(255,255,255,0.15); font-size: 0.65rem; }

    /* ---- Token budget bar ---- */
    .mc-token-bar {
        position: relative;
        height: 3px;
        background: rgba(255,255,255,0.05);
        border-radius: 0;
        overflow: hidden;
        flex-shrink: 0;
    }
    .mc-token-fill {
        height: 100%;
        border-radius: 0;
        transition: width 0.6s ease;
    }
    .mc-token-ok     { background: linear-gradient(90deg, hsl(var(--pc-h,200), 80%, 50%, 0.5), hsl(var(--pc-h,200), 80%, 60%, 0.8)); }
    .mc-token-warn   { background: linear-gradient(90deg, #f59e0b88, #f59e0bcc); }
    .mc-token-danger { background: linear-gradient(90deg, #ef444488, #ef4444cc); }
    .mc-token-label {
        position: absolute;
        right: 6px; top: 50%;
        transform: translateY(-50%);
        font-size: 0.45rem; font-family: monospace;
        font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    /* ---- Memory timeline ---- */
    .mc-timeline {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.3rem 0.75rem;
        flex-shrink: 0;
    }
    .mc-timeline-track {
        flex: 1;
        display: flex; align-items: center; gap: 2px;
        overflow: hidden;
    }
    .mc-timeline-dot {
        width: 5px; height: 5px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: all 0.3s;
    }
    .mc-td-user {
        background: rgba(255,255,255,0.25);
        width: 4px; height: 4px;
    }
    .mc-td-ai {
        width: 6px; height: 6px;
    }
    .mc-timeline-label {
        font-size: 0.45rem; font-family: monospace;
        font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.25);
        white-space: nowrap; flex-shrink: 0;
    }
</style>



