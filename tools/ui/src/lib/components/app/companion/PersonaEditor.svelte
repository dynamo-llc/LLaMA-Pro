<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import {
        X, Save, Trash2, Plus, RotateCcw, BrainCircuit, Mic,
        IdCard, Database, AudioLines, WifiOff
    } from '@lucide/svelte';
    import { fade, scale } from 'svelte/transition';
    import { toast } from 'svelte-sonner';
    import { companionStore } from '$lib/services/companion.svelte';
    import { companiesStore } from '$lib/stores/companies.svelte';
    import {
        jarvisBackend,
        type JarvisPersona,
        type DeepPartial
    } from '$lib/services/jarvis-backend.service';
    import type { Persona } from '$lib/services/personas';
    import { modelsStore } from '$lib/stores/models.svelte';

    let {
        open = $bindable(false),
        mode = 'edit'
    }: { open?: boolean; mode?: 'edit' | 'create' } = $props();

    const ORPHEUS_VOICES = ['tara', 'leah', 'jess', 'leo', 'dan', 'mia', 'zac', 'zoe'];
    const KOKORO_VOICES = [
        'af_bella', 'af_nicole', 'af_sarah', 'bf_emma',
        'am_adam', 'am_echo', 'am_eric', 'am_michael', 'am_puck', 'bm_daniel', 'bm_george'
    ];

    type Tab = 'profile' | 'voice' | 'mind' | 'wake' | 'memory' | 'mcp';
    let tab = $state<Tab>('profile');
    let loading = $state(false);
    let saving = $state(false);
    let online = $state(true);
    let backendName = $state('');
    let isBuiltin = $state(false);

    // Flat editable draft (mapped to/from the backend persona)
    let draft = $state({
        display_name: '',
        title: '',
        department: '',
        description: '',
        greeting: '',
        system_prompt: '',
        traits: '',
        voice: 'tara',
        speed: 1.0,
        kokoro_voice: 'af_bella',
        kokoro_speed: 1.0,
        temperature: 0.7,
        top_p: 0.9,
        max_response_tokens: 512,
        style_notes: '',
        working_memory_turns: 20,
        auto_remember: true,
        wake_phrase: '',
        wake_threshold: 0.5,
        wake_enabled: true,
        avatar_url: '',
        glow_color: '#3498db',
        mcp_servers: [] as string[],
        model_name: ''
    });

    let memoryFacts = $state<{ id: number; content: string }[]>([]);
    let newFact = $state('');
    let createId = $state('');

    const TABS = [
        { id: 'profile', label: 'Profile', icon: IdCard },
        { id: 'voice', label: 'Voice', icon: Mic },
        { id: 'mind', label: 'Mind', icon: BrainCircuit },
        { id: 'memory', label: 'Memory', icon: Database },
        { id: 'wake', label: 'Wake', icon: AudioLines },
        { id: 'mcp', label: 'MCP', icon: Database }
    ] as const;

    function slugify(value: string): string {
        return value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32);
    }

    function fromBackend(p: JarvisPersona) {
        draft = {
            display_name: p.display_name,
            title: p.title,
            department: p.department,
            description: p.description,
            greeting: p.greeting,
            system_prompt: p.system_prompt,
            traits: p.traits.join(', '),
            voice: p.voice.voice,
            speed: p.voice.speed,
            kokoro_voice: (p.meta?.['kokoroVoiceId'] as string) ?? 'af_bella',
            kokoro_speed: (p.meta?.['kokoroSpeed'] as number) ?? 1.0,
            temperature: p.llm.temperature,
            top_p: p.llm.top_p,
            max_response_tokens: p.llm.max_response_tokens,
            style_notes: p.llm.style_notes,
            working_memory_turns: p.memory.working_memory_turns,
            auto_remember: p.memory.auto_remember,
            wake_phrase: p.wake.phrase,
            wake_threshold: p.wake.threshold,
            wake_enabled: p.wake.enabled,
            avatar_url: p.meta?.avatarUrl || '',
            glow_color: p.meta?.glowColor || '#3498db',
            mcp_servers: p.meta?.mcpServers || [],
            model_name: p.llm.model_name || ''
        };
    }

    function toBackendPatch(): DeepPartial<JarvisPersona> {
        return {
            display_name: draft.display_name,
            title: draft.title,
            department: draft.department,
            description: draft.description,
            greeting: draft.greeting,
            system_prompt: draft.system_prompt,
            traits: draft.traits.split(',').map((t) => t.trim()).filter(Boolean),
            voice: { voice: draft.voice, speed: Number(draft.speed) },
            llm: {
                temperature: Number(draft.temperature),
                top_p: Number(draft.top_p),
                max_response_tokens: Number(draft.max_response_tokens),
                style_notes: draft.style_notes,
                model_name: draft.model_name
            },
            memory: {
                working_memory_turns: Number(draft.working_memory_turns),
                auto_remember: draft.auto_remember
            },
            wake: {
                phrase: draft.wake_phrase,
                threshold: Number(draft.wake_threshold),
                enabled: draft.wake_enabled
            },
            meta: {
                kokoroVoiceId: draft.kokoro_voice,
                kokoroSpeed: Number(draft.kokoro_speed),
                avatarUrl: draft.avatar_url,
                glowColor: draft.glow_color,
                mcpServers: draft.mcp_servers
            }
        };
    }

    async function load() {
        loading = true;
        tab = 'profile';
        try {
            if (mode === 'create') {
                online = await jarvisBackend.isOnline();
                backendName = '';
                isBuiltin = false;
                createId = '';
                draft = {
                    ...draft,
                    display_name: '', title: '', department: '', description: '',
                    greeting: 'Online and ready.', system_prompt: '', traits: '',
                    voice: 'tara', speed: 1.0, kokoro_voice: 'af_bella', kokoro_speed: 1.0,
                    temperature: 0.7, top_p: 0.9, max_response_tokens: 512, style_notes: '',
                    working_memory_turns: 20, auto_remember: true,
                    wake_phrase: '', wake_threshold: 0.5, wake_enabled: true,
                    avatar_url: '', glow_color: '#3498db', mcp_servers: [], model_name: ''
                };
                memoryFacts = [];
                return;
            }
            const appId = companionStore.activePersonaId;
            const backend =
                (await jarvisBackend.findByAppId(appId)) ??
                (await jarvisBackend.getPersona(appId).catch(() => undefined));
            if (backend) {
                online = true;
                backendName = backend.name;
                isBuiltin = backend.builtin;
                fromBackend(backend);
                memoryFacts = await jarvisBackend.getMemory(backend.name).catch(() => []);
            } else {
                online = false;
                backendName = '';
                const local = companionStore.activePersona;
                draft = {
                    ...draft,
                    display_name: local?.name ?? '',
                    title: local?.title ?? '',
                    department: local?.department ?? '',
                    description: local?.description ?? '',
                    system_prompt: local?.prompt ?? '',
                    model_name: local?.model_name ?? '',
                    mcp_servers: local?.mcp_servers ?? []
                };
                memoryFacts = [];
            }
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (open) void load();
    });

    async function save() {
        saving = true;
        try {
            if (mode === 'create') {
                await createPersona();
                return;
            }
            // Always sync the local app persona so in-app chat matches.
            companionStore.updatePersonaLocal(companionStore.activePersonaId, {
                name: draft.display_name,
                title: draft.title,
                department: draft.department,
                description: draft.description,
                prompt: draft.system_prompt,
                voiceSettings: {
                    ...(companionStore.activePersona?.voiceSettings ?? {
                        pitch: 1, rate: 1, voiceRegex: /./i, kokoroVoiceId: 'af_bella', kokoroSpeed: 1
                    }),
                    kokoroVoiceId: draft.kokoro_voice,
                    kokoroSpeed: Number(draft.kokoro_speed)
                },
                avatarUrl: draft.avatar_url || '/avatars/custom.png',
                model_name: draft.model_name,
                mcp_servers: draft.mcp_servers
            });
            if (online && backendName) {
                await jarvisBackend.updatePersona(backendName, toBackendPatch());
                toast.success(`${draft.display_name} updated`);
            } else {
                toast.success(`${draft.display_name} updated locally (voice backend offline)`);
            }
            open = false;
        } catch (error) {
            toast.error(`Save failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            saving = false;
        }
    }

    async function createPersona() {
        const id = createId || slugify(draft.display_name);
        if (!id || !draft.display_name.trim() || !draft.system_prompt.trim()) {
            toast.error('Name and personality prompt are required.');
            return;
        }
        if (online) {
            await jarvisBackend.createPersona({
                name: id,
                display_name: draft.display_name,
                ...toBackendPatch(),
                meta: {
                    app_id: id,
                    kokoroVoiceId: draft.kokoro_voice,
                    kokoroSpeed: Number(draft.kokoro_speed),
                    avatarUrl: draft.avatar_url,
                    glowColor: draft.glow_color,
                    mcpServers: draft.mcp_servers
                }
            } as DeepPartial<JarvisPersona> & { name: string; system_prompt: string });
        }
        companionStore.registerPersona({
            id,
            name: draft.display_name,
            title: draft.title || 'Custom Agent',
            department: draft.department || 'User Defined',
            description: draft.description,
            prompt: draft.system_prompt,
            avatarUrl: '/avatars/custom.png',
            voiceSettings: {
                pitch: 1.0,
                rate: 1.0,
                voiceRegex: /./i,
                kokoroVoiceId: draft.kokoro_voice,
                kokoroSpeed: Number(draft.kokoro_speed)
            },
            model_name: draft.model_name,
            mcp_servers: draft.mcp_servers
        } satisfies Persona);
        
        // Auto-hire into active company
        if (companiesStore.activeCompanyId) {
            await companiesStore.hireEmployee(companiesStore.activeCompanyId, id);
        }

        companionStore.setActivePersona(id);
        toast.success(`${draft.display_name} joined the team${online ? '' : ' (local only: voice backend offline)'}`);
        open = false;
    }

    async function resetToDefaults() {
        if (!online || !backendName || !isBuiltin) return;
        try {
            await jarvisBackend.deletePersona(backendName);
            await load();
            toast.success('Reverted to factory defaults');
        } catch (error) {
            toast.error(`Reset failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    async function deleteUserPersona() {
        if (!backendName || isBuiltin) return;
        try {
            await jarvisBackend.deletePersona(backendName);
            companionStore.removePersonaLocal(companionStore.activePersonaId);
            toast.success('Persona deleted');
            open = false;
        } catch (error) {
            toast.error(`Delete failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    async function addFact() {
        if (!newFact.trim() || !backendName) return;
        await jarvisBackend.addMemory(backendName, newFact.trim());
        newFact = '';
        memoryFacts = await jarvisBackend.getMemory(backendName);
    }

    async function clearMemory() {
        if (!backendName) return;
        await jarvisBackend.clearMemory(backendName);
        memoryFacts = [];
        toast.success('Memory wiped');
    }
</script>

{#if open}
    <div class="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
        <div class="bg-card w-full max-w-2xl border border-border shadow-2xl p-6 flex flex-col gap-4 rounded-3xl max-h-[92vh]" transition:scale={{ start: 0.95, duration: 150 }}>

            <!-- Header -->
            <div class="flex items-center justify-between border-b border-border pb-3">
                <h2 class="text-base font-bold text-foreground tracking-wide uppercase flex items-center gap-2">
                    {#if mode === 'create'}
                        <Plus class="h-4.5 w-4.5 text-primary" /> New Team Member
                    {:else}
                        <BrainCircuit class="h-4.5 w-4.5 text-primary" /> Persona Studio
                        <span class="text-[10px] font-mono text-muted-foreground normal-case">// {draft.display_name}</span>
                    {/if}
                </h2>
                <div class="flex items-center gap-2">
                    {#if !online}
                        <span class="flex items-center gap-1.5 text-[9px] font-mono uppercase text-amber-500 border border-amber-500/30 rounded-full px-2 py-0.5">
                            <WifiOff class="h-3 w-3" /> Voice backend offline
                        </span>
                    {/if}
                    <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-foreground" onclick={() => (open = false)}>
                        <X class="h-5 w-5" />
                    </Button>
                </div>
            </div>

            <!-- Tabs -->
            <div class="flex gap-1.5">
                {#each TABS as t}
                    {#if t.id !== 'memory' || mode === 'edit'}
                        <button
                            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-colors
                                   {tab === t.id ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground border-border/40 hover:text-foreground'}"
                            onclick={() => (tab = t.id)}
                        >
                            <t.icon class="h-3 w-3" /> {t.label}
                        </button>
                    {/if}
                {/each}
            </div>

            <!-- Body -->
            <div class="space-y-4 overflow-y-auto pr-1 no-scrollbar min-h-[280px]">
                {#if loading}
                    <div class="text-center py-16 text-[10px] font-mono uppercase text-muted-foreground animate-pulse">Loading agent profile...</div>
                {:else if tab === 'profile'}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Name</Label>
                            <Input bind:value={draft.display_name} placeholder="e.g. Marvin Droid" class="bg-background border-border rounded-xl h-9 text-xs" />
                        </div>
                        {#if mode === 'create'}
                            <div class="space-y-1.5">
                                <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Agent ID (optional)</Label>
                                <Input bind:value={createId} placeholder={slugify(draft.display_name) || 'auto'} class="bg-background border-border rounded-xl h-9 text-xs font-mono" />
                            </div>
                        {:else}
                            <div class="space-y-1.5">
                                <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Title</Label>
                                <Input bind:value={draft.title} class="bg-background border-border rounded-xl h-9 text-xs" />
                            </div>
                        {/if}
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Department</Label>
                            <Input bind:value={draft.department} placeholder="e.g. Research Division" class="bg-background border-border rounded-xl h-9 text-xs" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Personality Traits (comma separated)</Label>
                            <Input bind:value={draft.traits} placeholder="witty, precise, loyal" class="bg-background border-border rounded-xl h-9 text-xs" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Avatar URL</Label>
                            <Input bind:value={draft.avatar_url} placeholder="https://..." class="bg-background border-border rounded-xl h-9 text-xs" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Glow Color</Label>
                            <input type="color" bind:value={draft.glow_color} class="w-full h-9 mt-1 cursor-pointer bg-transparent border-0 rounded-lg p-0" />
                        </div>
                    </div>
                    <div class="space-y-1.5">
                        <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Description</Label>
                        <Textarea bind:value={draft.description} rows={2} class="bg-background border-border rounded-xl text-xs" />
                    </div>
                    <div class="space-y-1.5">
                        <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Personality Prompt</Label>
                        <Textarea bind:value={draft.system_prompt} rows={6} placeholder="You are..." class="bg-background border-border rounded-xl text-xs font-mono" />
                    </div>
                    <div class="space-y-1.5">
                        <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Spoken Greeting</Label>
                        <Input bind:value={draft.greeting} class="bg-background border-border rounded-xl h-9 text-xs" />
                    </div>
                {:else if tab === 'voice'}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Voice (Orpheus / Jarvis backend)</Label>
                            <select bind:value={draft.voice} class="w-full bg-background border border-border rounded-xl px-3 h-9 text-xs text-foreground outline-none">
                                {#each ORPHEUS_VOICES as v}<option value={v}>{v}</option>{/each}
                            </select>
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>Speaking Rate</span><span class="text-primary">{Number(draft.speed).toFixed(2)}x</span>
                            </div>
                            <input type="range" min="0.5" max="2" step="0.02" bind:value={draft.speed} class="w-full accent-primary h-1.5 mt-3" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Voice (Kokoro / in-app)</Label>
                            <select bind:value={draft.kokoro_voice} class="w-full bg-background border border-border rounded-xl px-3 h-9 text-xs text-foreground outline-none">
                                {#each KOKORO_VOICES as v}<option value={v}>{v}</option>{/each}
                            </select>
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>Kokoro Rate</span><span class="text-primary">{Number(draft.kokoro_speed).toFixed(2)}x</span>
                            </div>
                            <input type="range" min="0.5" max="2" step="0.02" bind:value={draft.kokoro_speed} class="w-full accent-primary h-1.5 mt-3" />
                        </div>
                    </div>
                {:else if tab === 'mind'}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>Temperature</span><span class="text-primary">{Number(draft.temperature).toFixed(2)}</span>
                            </div>
                            <input type="range" min="0" max="2" step="0.05" bind:value={draft.temperature} class="w-full accent-primary h-1.5 mt-3" />
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>Top P</span><span class="text-primary">{Number(draft.top_p).toFixed(2)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.01" bind:value={draft.top_p} class="w-full accent-primary h-1.5 mt-3" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Max Response Tokens</Label>
                            <Input type="number" bind:value={draft.max_response_tokens} min={16} max={8192} class="bg-background border-border rounded-xl h-9 text-xs font-mono" />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Working Memory (turns)</Label>
                            <Input type="number" bind:value={draft.working_memory_turns} min={2} max={200} class="bg-background border-border rounded-xl h-9 text-xs font-mono" />
                        </div>
                        <div class="space-y-1.5 md:col-span-2">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Model Override</Label>
                            <select bind:value={draft.model_name} class="w-full bg-background border border-border rounded-xl px-3 h-9 text-xs text-foreground outline-none">
                                <option value="">System Default</option>
                                {#each modelsStore.models as model}
                                    <option value={model.id}>{model.name} ({model.id})</option>
                                {/each}
                            </select>
                        </div>
                    </div>
                    <div class="space-y-1.5">
                        <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Style Notes</Label>
                        <Textarea bind:value={draft.style_notes} rows={3} placeholder="Extra delivery directives, e.g. 'Short sentences. One dry joke per reply.'" class="bg-background border-border rounded-xl text-xs" />
                    </div>
                    <label class="flex items-center gap-2 cursor-pointer select-none pt-1">
                        <input type="checkbox" bind:checked={draft.auto_remember} class="w-4 h-4 rounded border-border accent-primary" />
                        <span class="text-[10px] font-bold uppercase tracking-wider text-foreground">Automatically remember facts from conversation</span>
                    </label>
                {:else if tab === 'wake'}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Wake Phrase</Label>
                            <Input bind:value={draft.wake_phrase} placeholder="e.g. denise" class="bg-background border-border rounded-xl h-9 text-xs font-mono" />
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                <span>Detection Threshold</span><span class="text-primary">{Number(draft.wake_threshold).toFixed(2)}</span>
                            </div>
                            <input type="range" min="0.1" max="0.95" step="0.05" bind:value={draft.wake_threshold} class="w-full accent-primary h-1.5 mt-3" />
                        </div>
                    </div>
                    <label class="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" bind:checked={draft.wake_enabled} class="w-4 h-4 rounded border-border accent-primary" />
                        <span class="text-[10px] font-bold uppercase tracking-wider text-foreground">Wake word active for this persona</span>
                    </label>
                    <div class="text-[9px] text-muted-foreground font-mono leading-relaxed bg-muted/20 border border-border/40 rounded-xl p-3">
                        Saying "<span class="text-primary">{draft.wake_phrase || 'name'}</span>" activates this persona hands-free.
                        Name addressing ("{draft.display_name.split(' ')[0] || 'Name'}, do X") always works.
                        For acoustic wake detection of custom names, drop a trained model at
                        ~/.jarvis/wakewords/{backendName || slugify(draft.display_name) || 'persona'}.onnx
                    </div>
                {:else if tab === 'memory'}
                    <div class="flex gap-2">
                        <Input bind:value={newFact} placeholder="Teach this persona a fact..." class="bg-background border-border rounded-xl h-9 text-xs flex-1"
                               onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && addFact()} disabled={!online} />
                        <Button size="sm" class="rounded-xl h-9 text-[10px] font-bold uppercase" onclick={addFact} disabled={!online || !newFact.trim()}>
                            <Plus class="h-3.5 w-3.5 mr-1" /> Teach
                        </Button>
                    </div>
                    {#if memoryFacts.length === 0}
                        <div class="text-center py-10 text-[10px] font-mono uppercase text-muted-foreground border-2 border-dashed border-border/40 rounded-xl">
                            {online ? 'No memories stored for this persona yet.' : 'Voice backend offline - memory unavailable.'}
                        </div>
                    {:else}
                        <div class="space-y-1.5 max-h-[240px] overflow-y-auto pr-1 no-scrollbar">
                            {#each memoryFacts as fact (fact.id)}
                                <div class="text-[10px] font-mono text-muted-foreground bg-background border border-border/30 rounded-lg px-3 py-2">
                                    {fact.content}
                                </div>
                            {/each}
                        </div>
                        <Button size="sm" variant="outline" class="rounded-xl text-[9px] font-bold uppercase tracking-wider text-destructive" onclick={clearMemory}>
                            <Trash2 class="h-3 w-3 mr-1" /> Wipe all memories
                        </Button>
                    {/if}
                {:else if tab === 'mcp'}
                    <div class="space-y-4">
                        <Label class="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Model Context Protocol Servers</Label>
                        <p class="text-[10px] text-muted-foreground leading-relaxed">
                            Specify which MCP servers this agent can access. 
                            Enter server names (comma separated). Leave blank to allow all tools.
                        </p>
                        <Input 
                            value={draft.mcp_servers.join(', ')} 
                            oninput={(e) => draft.mcp_servers = e.currentTarget.value.split(',').map(s => s.trim()).filter(Boolean)} 
                            placeholder="e.g. weather, github, local_files" 
                            class="bg-background border-border rounded-xl h-9 text-xs font-mono" 
                        />
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-between pt-3 border-t border-border">
                <div class="flex gap-2">
                    {#if mode === 'edit' && online && isBuiltin}
                        <Button variant="outline" size="sm" class="rounded-xl text-[9px] font-bold uppercase tracking-wider" onclick={resetToDefaults}>
                            <RotateCcw class="h-3 w-3 mr-1" /> Factory Reset
                        </Button>
                    {/if}
                    {#if mode === 'edit' && online && !isBuiltin && backendName}
                        <Button variant="outline" size="sm" class="rounded-xl text-[9px] font-bold uppercase tracking-wider text-destructive" onclick={deleteUserPersona}>
                            <Trash2 class="h-3 w-3 mr-1" /> Delete Persona
                        </Button>
                    {/if}
                </div>
                <div class="flex gap-3">
                    <Button variant="outline" class="rounded-xl" onclick={() => (open = false)}>Cancel</Button>
                    <Button class="rounded-xl uppercase tracking-wider font-bold text-xs" onclick={save} disabled={saving || loading}>
                        <Save class="h-3.5 w-3.5 mr-1.5" />
                        {saving ? 'Saving...' : mode === 'create' ? 'Create Agent' : 'Save Changes'}
                    </Button>
                </div>
            </div>
        </div>
    </div>
{/if}
