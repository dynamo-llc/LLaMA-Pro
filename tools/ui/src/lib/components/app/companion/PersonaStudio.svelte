<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Building2, Users, Plus, Pencil, Trash2, X, Upload, Download, Coins, Handshake } from '@lucide/svelte';
    import { fade, slide } from 'svelte/transition';
    import { toast } from 'svelte-sonner';
    import { companiesStore } from '$lib/stores/companies.svelte';
    import { companionStore } from '$lib/services/companion.svelte';
    import { economyStore } from '$lib/stores/economy.svelte';
    import { getPersonaCost } from '$lib/services/personas';
    import PersonaEditor from './PersonaEditor.svelte';
    import type { Persona } from '$lib/types';
    import { SFX } from '$lib/utils/sound-effects';
    
    let { open = $bindable(false) } = $props<{ open?: boolean }>();
    
    // Editor state
    let isEditorOpen = $state(false);
    let editorMode = $state<'create'|'edit'>('create');
    let editingPersona = $state<Persona | null>(null);
    let isRecruitmentCenterOpen = $state(false);
    
    // Company form
    let showCompanyForm = $state(false);
    let companyDraft = $state({ name: '', description: '', themeColor: '#10a37f' });

    $effect(() => {
        if (open) {
            companiesStore.initialize();
            companionStore.syncWithBackend(); // ensure personas are loaded
            economyStore.initialize();
        }
    });

    async function saveCompany() {
        if (!companyDraft.name.trim()) {
            toast.error('Company name required');
            return;
        }
        await companiesStore.createCompany(companyDraft.name, companyDraft.description, companyDraft.themeColor);
        showCompanyForm = false;
        companyDraft = { name: '', description: '', themeColor: '#10a37f' };
        toast.success('Company created');
    }

    async function deleteCompany(id: string) {
        if (confirm('Are you sure you want to dissolve this company?')) {
            await companiesStore.deleteCompany(id);
            toast.success('Company dissolved');
        }
    }

    function editEmployee(id: string) {
        companionStore.setActivePersona(id);
        editorMode = 'edit';
        isEditorOpen = true;
    }

    function openRecruitmentCenter() {
        if (!companiesStore.activeCompanyId) return;
        isRecruitmentCenterOpen = true;
    }

    function hireNewEmployee() {
        isRecruitmentCenterOpen = false;
        editorMode = 'create';
        isEditorOpen = true;
    }

    async function hireExistingEmployee(persona: Persona, cost: number) {
        if (!companiesStore.activeCompanyId) return;
        
        if (!economyStore.spend(cost)) {
            toast.error("Insufficient LLaMA Coins!");
            SFX.playError();
            return;
        }

        await companiesStore.hireEmployee(companiesStore.activeCompanyId, persona.id);
        SFX.playSuccess();
        toast.success(`${persona.name} hired successfully for â‚½${cost.toLocaleString()}!`);
    }

    async function negotiateHire(persona: Persona, cost: number) {
        if (!companiesStore.activeCompanyId) return;
        
        // Let's do a simple minigame: Offer 70-90% of the cost.
        // The lower the offer, the higher chance of rejection.
        const offerPercentage = 0.75; // offering 75%
        const offerAmount = Math.floor(cost * offerPercentage);
        
        if (!economyStore.canAfford(offerAmount)) {
            toast.error("You can't even afford to lowball them!");
            SFX.playError();
            return;
        }

        // Random chance based on offer (75% offer means ~50% chance of success)
        const roll = Math.random();
        // Base chance to accept a 75% offer is 0.5. 
        if (roll > 0.5) {
            // Success!
            economyStore.spend(offerAmount);
            await companiesStore.hireEmployee(companiesStore.activeCompanyId, persona.id);
            SFX.playSuccess();
            toast.success(`Negotiation Successful! ${persona.name} accepted â‚½${offerAmount.toLocaleString()}!`);
        } else {
            SFX.playError();
            toast.error(`Negotiation Failed! ${persona.name} was insulted by your low offer.`);
        }
    }

    // --- Import / Export ---
    async function exportCompany(companyId: string) {
        const company = companiesStore.companies.find(c => c.id === companyId);
        if (!company) return;
        
        const employees = company.employeeIds.map(id => companionStore.personaList.find(p => p.id === id)).filter(Boolean);
        
        const data = {
            version: 1,
            company,
            employees
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `company_${company.name.replace(/\s+/g, '_').toLowerCase()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    let fileInput: HTMLInputElement | undefined = $state();
    async function handleImport(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (data.version === 1 && data.company && data.employees) {
                // Import company
                const newCompany = await companiesStore.createCompany(data.company.name, data.company.description, data.company.themeColor);
                
                // Import personas (mocked for now since backend create isn't exposed directly here easily, 
                // but we can register them locally or rely on the user to use the editor)
                // For a robust implementation we would call jarvisBackend.createPersona for each
                toast.success('Company imported successfully');
            } else {
                toast.error('Invalid import file format');
            }
        } catch (err) {
            toast.error('Failed to parse import file');
        }
        
        fileInput.value = '';
    }
</script>

{#if open}
    <!-- Main Modal Background -->
    <div class="fixed inset-0 z-[9000] bg-black/60 backdrop-blur-md flex items-center justify-center p-6" transition:fade={{ duration: 200 }}>
        <!-- Main Container -->
        <div class="bg-card w-full max-w-7xl h-[90vh] border border-border/50 shadow-2xl rounded-3xl flex overflow-hidden relative">
            
            <!-- Sidebar: Companies -->
            <div class="w-80 bg-muted/20 border-r border-border/50 flex flex-col">
                <div class="p-6 border-b border-border/50">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-black tracking-wider uppercase flex items-center gap-2">
                            <Building2 class="text-primary h-5 w-5" />
                            Organizations
                        </h2>
                        <Button variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground" onclick={() => fileInput.click()} title="Import Company">
                            <Upload class="h-3 w-3" />
                        </Button>
                        <input type="file" accept=".json" bind:this={fileInput} onchange={handleImport} class="hidden" />
                    </div>
                    <p class="text-xs font-mono text-muted-foreground mt-1">Select an active company team.</p>
                </div>
                
                <div class="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                    {#each companiesStore.companies as company (company.id)}
                        <button
                            class="w-full text-left p-4 rounded-2xl border transition-all {companiesStore.activeCompanyId === company.id ? 'bg-primary/10 border-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.15)]' : 'bg-background/50 border-border/30 hover:border-primary/50'}"
                            onclick={() => companiesStore.setActiveCompany(company.id)}
                        >
                            <div class="flex justify-between items-start mb-1">
                                <h3 class="font-bold text-sm" style="color: {company.themeColor}">{company.name}</h3>
                                {#if companiesStore.activeCompanyId === company.id}
                                    <div class="w-2 h-2 rounded-full mt-1" style="background-color: {company.themeColor}; box-shadow: 0 0 8px {company.themeColor}"></div>
                                {/if}
                            </div>
                            {#if company.description}
                                <p class="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{company.description}</p>
                            {/if}
                            <div class="mt-3 flex gap-1 flex-wrap">
                                <!-- Mini avatars for employees -->
                                {#each company.employeeIds.slice(0, 5) as empId}
                                    {@const emp = companionStore.personaList.find(p => p.id === empId)}
                                    {#if emp}
                                        <div class="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden border border-border/50" title={emp.name}>
                                            {#if emp.avatarUrl}
                                                <img src={emp.avatarUrl} class="w-full h-full object-cover" alt={emp.name} />
                                            {:else}
                                                <span class="text-[8px] font-bold">{emp.name.substring(0, 2).toUpperCase()}</span>
                                            {/if}
                                        </div>
                                    {/if}
                                {/each}
                                {#if company.employeeIds.length > 5}
                                    <div class="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center border border-border/50">
                                        <span class="text-[8px] font-bold text-muted-foreground">+{company.employeeIds.length - 5}</span>
                                    </div>
                                {/if}
                            </div>
                        </button>
                    {/each}
                    
                    {#if showCompanyForm}
                        <div class="p-4 bg-background border border-primary/40 rounded-2xl space-y-3" transition:slide>
                            <div>
                                <Label class="text-[10px] uppercase font-bold text-muted-foreground">Company Name</Label>
                                <Input bind:value={companyDraft.name} placeholder="North Korean Hackers" class="h-8 text-xs mt-1 bg-muted/30" />
                            </div>
                            <div>
                                <Label class="text-[10px] uppercase font-bold text-muted-foreground">Description</Label>
                                <Input bind:value={companyDraft.description} placeholder="Motto or description" class="h-8 text-xs mt-1 bg-muted/30" />
                            </div>
                            <div>
                                <Label class="text-[10px] uppercase font-bold text-muted-foreground">Theme Color</Label>
                                <input type="color" bind:value={companyDraft.themeColor} class="w-full h-8 mt-1 cursor-pointer bg-transparent border-0 rounded-lg p-0" />
                            </div>
                            <div class="flex gap-2 pt-2">
                                <Button size="sm" variant="outline" class="flex-1 h-8 text-[10px] uppercase" onclick={() => showCompanyForm = false}>Cancel</Button>
                                <Button size="sm" class="flex-1 h-8 text-[10px] uppercase" onclick={saveCompany}>Create</Button>
                            </div>
                        </div>
                    {:else}
                        <Button variant="outline" class="w-full py-6 border-dashed border-border/50 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors rounded-2xl" onclick={() => showCompanyForm = true}>
                            <Plus class="h-4 w-4 mr-2" />
                            <span class="text-xs uppercase font-bold tracking-widest">Add Company</span>
                        </Button>
                    {/if}
                </div>
            </div>
            
            <!-- Main Content: Employees Grid -->
            <div class="flex-1 flex flex-col relative bg-background/50">
                <div class="absolute top-4 right-4 z-50 flex items-center gap-3">
                    <!-- Wallet Badge -->
                    <button class="bg-card border border-primary/30 rounded-full px-3 py-1 flex items-center gap-2 shadow-sm hover:border-primary/60 transition-colors" onclick={() => economyStore.grantDeveloperFunds()} title="Secret: Grant Developer Funds">
                        <Coins class="h-4 w-4 text-primary" />
                        <span class="text-xs font-black font-mono tracking-wider">â‚½{economyStore.balance.toLocaleString()}</span>
                    </button>
                    
                    <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-foreground bg-background/50 backdrop-blur rounded-full" onclick={() => open = false}>
                        <X class="h-5 w-5" />
                    </Button>
                </div>
                
                {#if companiesStore.activeCompany}
                    {@const company = companiesStore.activeCompany}
                    <div class="p-8 border-b border-border/30 bg-gradient-to-br from-background to-muted/10 relative overflow-hidden">
                        <!-- Decorative glow -->
                        <div class="absolute -right-20 -top-20 w-64 h-64 rounded-full blur-[100px] opacity-20" style="background-color: {company.themeColor}; pointer-events: none;"></div>
                        
                        <div class="flex items-start justify-between relative z-10">
                            <div>
                                <h1 class="text-4xl font-black tracking-tight" style="color: {company.themeColor}">{company.name}</h1>
                                <p class="text-sm font-mono text-muted-foreground mt-2">{company.description || 'No description provided.'}</p>
                            </div>
                            <div class="flex gap-2">
                                <Button variant="outline" size="sm" class="rounded-xl uppercase font-bold text-[10px] tracking-wider border-border/30 hover:bg-muted/10" onclick={() => exportCompany(company.id)}>
                                    <Download class="h-3.5 w-3.5 mr-1.5" /> Export
                                </Button>
                                <Button variant="outline" size="sm" class="rounded-xl uppercase font-bold text-[10px] tracking-wider border-destructive/30 text-destructive hover:bg-destructive/10" onclick={() => deleteCompany(company.id)}>
                                    <Trash2 class="h-3.5 w-3.5 mr-1.5" /> Dissolve
                                </Button>
                                <Button size="sm" class="rounded-xl uppercase font-bold text-[10px] tracking-wider" onclick={openRecruitmentCenter} style="background-color: {company.themeColor}; color: white;">
                                    <Plus class="h-3.5 w-3.5 mr-1.5" /> Recruit Talent
                                </Button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto p-8 no-scrollbar">
                        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {#each company.employeeIds as empId}
                                {@const emp = companionStore.personaList.find(p => p.id === empId)}
                                {#if emp}
                                    <div class="group bg-card border border-border/50 rounded-3xl overflow-hidden hover:border-primary/50 transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:-translate-y-1 relative">
                                        <!-- Model Card Header Image -->
                                        <div class="h-32 bg-muted/30 relative overflow-hidden border-b border-border/30">
                                            {#if emp.avatarUrl}
                                                <img src={emp.avatarUrl} class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={emp.name} />
                                            {:else}
                                                <div class="absolute inset-0 flex items-center justify-center font-black text-6xl text-muted-foreground/20">
                                                    {emp.name.substring(0, 1)}
                                                </div>
                                            {/if}
                                            <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                                            <div class="absolute bottom-3 left-4 right-4">
                                                <h3 class="text-white font-black text-lg leading-tight truncate">{emp.name}</h3>
                                                <p class="text-white/70 text-[9px] font-mono uppercase tracking-widest truncate">{emp.title || 'Agent'}</p>
                                            </div>
                                        </div>
                                        
                                        <!-- Specs -->
                                        <div class="p-4 space-y-3">
                                            <div class="flex justify-between items-center border-b border-border/30 pb-2">
                                                <span class="text-[9px] font-bold uppercase text-muted-foreground tracking-widest">Dept</span>
                                                <span class="text-[10px] font-mono text-foreground truncate max-w-[120px]">{emp.department || 'N/A'}</span>
                                            </div>
                                            <div class="flex justify-between items-center border-b border-border/30 pb-2">
                                                <span class="text-[9px] font-bold uppercase text-muted-foreground tracking-widest">Voice</span>
                                                <span class="text-[10px] font-mono text-primary">{emp.voiceSettings?.kokoroVoiceId || 'System'}</span>
                                            </div>
                                            
                                            <!-- Actions Overlay -->
                                            <div class="pt-2 flex justify-between">
                                                <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive h-8 px-2" onclick={() => companiesStore.fireEmployee(company.id, emp.id)} title="Fire from Company">
                                                    <Trash2 class="h-4 w-4" />
                                                </Button>
                                                <Button size="sm" class="h-8 rounded-lg uppercase text-[9px] font-bold tracking-widest w-full ml-2" onclick={() => editEmployee(emp.id)}>
                                                    Configure
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                {/if}
                            {/each}
                            
                            <!-- Hire Card -->
                            <button class="bg-card/30 border-2 border-dashed border-border/50 rounded-3xl flex flex-col items-center justify-center p-6 min-h-[280px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors group" onclick={openRecruitmentCenter}>
                                <div class="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <Plus class="h-8 w-8" />
                                </div>
                                <h3 class="font-black uppercase tracking-widest text-sm">Recruit</h3>
                                <p class="text-[10px] font-mono mt-2 text-center opacity-70">Add a new agent to the team</p>
                            </button>
                        </div>
                    </div>
                {:else}
                    <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                        <Users class="h-16 w-16 mb-4 opacity-20" />
                        <h2 class="text-xl font-black uppercase tracking-widest opacity-50">No Active Company</h2>
                        <p class="text-sm font-mono mt-2 opacity-50">Select or create a company to manage your agents.</p>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Recruitment Center Modal -->
        {#if isRecruitmentCenterOpen}
            <div class="absolute inset-0 z-[60] bg-background/95 backdrop-blur-xl flex flex-col p-12 overflow-hidden" transition:fade>
                <div class="flex justify-between items-center mb-8">
                    <div>
                        <h2 class="text-3xl font-black uppercase tracking-tight">Recruitment Center</h2>
                        <p class="text-muted-foreground font-mono">Select candidates to recruit into {companiesStore.activeCompany?.name}</p>
                    </div>
                    <div class="flex gap-4">
                        <Button variant="default" onclick={hireNewEmployee} class="uppercase tracking-widest font-bold">
                            <Plus class="w-4 h-4 mr-2" /> Create New Talent
                        </Button>
                        <Button variant="ghost" size="icon" onclick={() => isRecruitmentCenterOpen = false}>
                            <X class="w-6 h-6" />
                        </Button>
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto no-scrollbar grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {#each companionStore.personaList.filter(p => !companiesStore.activeCompany?.employeeIds.includes(p.id)) as candidate}
                        {@const cost = getPersonaCost(candidate)}
                        <div class="bg-card border border-border/50 rounded-2xl overflow-hidden hover:border-primary hover:shadow-[0_0_20px_rgba(0,150,255,0.2)] transition-all text-left flex flex-col group relative">
                            <div class="h-32 bg-muted w-full relative overflow-hidden">
                                {#if candidate.avatarUrl}
                                    <img src={candidate.avatarUrl} class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt={candidate.name} />
                                {:else}
                                    <div class="w-full h-full flex items-center justify-center font-black text-5xl text-muted-foreground/30">
                                        {candidate.name.substring(0, 1)}
                                    </div>
                                {/if}
                                <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-60"></div>
                            </div>
                            <div class="p-4 relative flex-1 flex flex-col">
                                <h4 class="font-bold text-sm truncate leading-none text-white drop-shadow-md">{candidate.name}</h4>
                                <p class="text-[9px] font-mono text-muted-foreground uppercase truncate mt-1.5">{candidate.department || 'General'}</p>
                                <p class="text-xs font-mono font-bold text-primary mt-2">â‚½{cost.toLocaleString()}</p>
                            </div>
                            
                            <!-- Action buttons -->
                            <div class="p-2 border-t border-border/30 bg-muted/10 grid grid-cols-2 gap-1">
                                <Button variant="outline" size="sm" class="h-8 text-[9px] uppercase font-bold tracking-widest px-1 hover:text-primary" onclick={() => negotiateHire(candidate, cost)} title="Offer 75% and pray">
                                    <Handshake class="h-3 w-3 mr-1" /> Offer
                                </Button>
                                <Button size="sm" class="h-8 text-[9px] uppercase font-bold tracking-widest px-1" onclick={() => hireExistingEmployee(candidate, cost)}>
                                    Hire
                                </Button>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

    </div>
{/if}

<PersonaEditor bind:open={isEditorOpen} mode={editorMode} />
