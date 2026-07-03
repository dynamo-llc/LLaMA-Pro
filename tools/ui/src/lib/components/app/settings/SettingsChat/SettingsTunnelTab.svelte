<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Switch } from '$lib/components/ui/switch';
    import { onMount } from 'svelte';
    import QRCode from 'qrcode';
    import { ExternalLink, Copy, Check, Wifi, Smartphone, Globe, ShieldCheck, RefreshCw, Zap } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button';
    import { toast } from 'svelte-sonner';

    let isEnabled = $state(false);
    let isLoading = $state(false);
    let publicUrl = $state<string | null>(null);
    let localUrl = $state<string | null>(null);
    let error = $state<string | null>(null);
    
    let copiedLocal = $state(false);
    let copiedPublic = $state(false);
    
    let publicCanvas = $state<HTMLCanvasElement>();
    let localCanvas = $state<HTMLCanvasElement>();

    // Use high-contrast black on white for QR codes to guarantee instant scanning on all phone cameras
    function getThemeColors() {
        return { dark: '#000000', light: '#ffffff' };
    }

    function handleCopy(url: string | null, isLocal: boolean) {
        if (!url) return;
        navigator.clipboard.writeText(url);
        toast.success("URL copied to clipboard!", { description: "You can now paste it into your device's browser." });
        if (isLocal) {
            copiedLocal = true;
            setTimeout(() => copiedLocal = false, 2000);
        } else {
            copiedPublic = true;
            setTimeout(() => copiedPublic = false, 2000);
        }
    }

    async function toggleTunnel(enabled: boolean) {
        isLoading = true;
        error = null;
        try {
            if (enabled) {
                const res = await fetch('/api/tunnel/start');
                const data = await res.json();
                if (data.url) {
                    publicUrl = data.url;
                    isEnabled = true;
                } else {
                    error = data.error || 'Failed to start tunnel';
                    isEnabled = false;
                }
            } else {
                await fetch('/api/tunnel/stop');
                publicUrl = null;
                isEnabled = false;
            }
        } catch (e: any) {
            error = e.message;
            isEnabled = false;
        } finally {
            isLoading = false;
        }
    }

    onMount(async () => {
        try {
            // Fetch local IP
            const res = await fetch('/api/tunnel/local');
            const data = await res.json();
            if (data.ip) {
                // Determine port - use window.location.port if in browser, or default 8000
                const port = window.location.port || '8000';
                localUrl = `http://${data.ip}:${port}`;
            }
        } catch (e) {
            console.error("Failed to get local IP", e);
        }
    });

    $effect(() => {
        const colors = getThemeColors();
        
        if (publicUrl && publicCanvas) {
            QRCode.toCanvas(publicCanvas, publicUrl, { 
                width: 220, 
                margin: 2, 
                color: colors 
            });
        }
        
        if (localUrl && localCanvas) {
            QRCode.toCanvas(localCanvas, localUrl, { 
                width: 220, 
                margin: 2, 
                color: colors 
            });
        }
    });
</script>

<div class="space-y-8 relative animate-in fade-in slide-in-from-bottom-4 duration-500">
	<div>
		<h2 class="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/50">Edge Devices</h2>
		<p class="text-sm text-muted-foreground mt-2 max-w-2xl">
			Seamlessly connect your phones, tablets, and laptops to your AI. Access your assistant locally over Wi-Fi, or securely over the public internet when you're away from home.
		</p>
	</div>

    <!-- LOCAL NETWORK SECTION -->
    <div class="group relative rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 to-card/30 backdrop-blur-xl p-6 shadow-xl transition-all hover:shadow-2xl hover:border-primary/20 overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
        <div class="relative flex flex-col md:flex-row items-start gap-6">
            <div class="rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-4 text-primary shrink-0 shadow-inner ring-1 ring-primary/20">
                <Wifi class="h-7 w-7" />
            </div>
            <div class="flex-1 min-w-0 w-full">
                <h3 class="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">Local Network Access</h3>
                <p class="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
                    Access your AI instantly from any device on your local Wi-Fi. 
                    This connection is direct, incredibly fast, and keeps all your data strictly within your home network.
                </p>
                
                {#if localUrl}
                    <div class="mt-8 flex flex-col sm:flex-row items-center sm:items-start gap-8 animate-in zoom-in-95 duration-500 fade-in">
                        <!-- QR Code with Scanner Reticle & Glow -->
                        <div class="relative group/qr shrink-0">
                            <!-- Animated Glow -->
                            <div class="absolute -inset-2 bg-gradient-to-tr from-primary/40 via-secondary/40 to-primary/40 rounded-3xl blur-xl opacity-60 group-hover/qr:opacity-100 animate-pulse transition-opacity duration-700"></div>
                            
                            <div class="relative flex justify-center items-center rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/10 dark:ring-white/10 z-10 transition-transform duration-300 group-hover/qr:scale-[1.02]">
                                <!-- Scanner Reticles -->
                                <div class="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-primary/70 rounded-tl-sm transition-all duration-300 group-hover/qr:border-primary group-hover/qr:scale-110 -translate-x-1 -translate-y-1"></div>
                                <div class="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-primary/70 rounded-tr-sm transition-all duration-300 group-hover/qr:border-primary group-hover/qr:scale-110 translate-x-1 -translate-y-1"></div>
                                <div class="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-primary/70 rounded-bl-sm transition-all duration-300 group-hover/qr:border-primary group-hover/qr:scale-110 -translate-x-1 translate-y-1"></div>
                                <div class="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-primary/70 rounded-br-sm transition-all duration-300 group-hover/qr:border-primary group-hover/qr:scale-110 translate-x-1 translate-y-1"></div>
                                
                                <canvas bind:this={localCanvas}></canvas>
                            </div>
                        </div>
                        
                        <!-- Frictionless 1-2-3 Steps -->
                        <div class="flex flex-col gap-5 w-full min-w-0 pt-2">
                            <!-- Step 1 -->
                            <div class="flex items-start gap-4">
                                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-sm font-bold shadow-md shadow-primary/20">1</div>
                                <div>
                                    <p class="text-sm font-semibold text-foreground">Scan with your camera</p>
                                    <p class="text-xs text-muted-foreground mt-0.5">Point your phone's camera at the QR code to connect.</p>
                                </div>
                            </div>
                            
                            <!-- Step 2 -->
                            <div class="flex items-start gap-4">
                                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-sm font-bold shadow-md shadow-primary/20">2</div>
                                <div class="w-full">
                                    <p class="text-sm font-semibold text-foreground">Open the local link</p>
                                    <div class="flex items-center gap-2 mt-2 w-full max-w-full">
                                        <code class="flex-1 overflow-x-auto rounded-lg bg-black/5 dark:bg-black/40 px-3 py-2 text-xs font-semibold whitespace-nowrap border border-border/50 text-primary shadow-inner">
                                            {localUrl}
                                        </code>
                                        <Button size="icon" variant="outline" onclick={() => handleCopy(localUrl, true)} title="Copy URL" class="h-9 w-9 shrink-0 shadow-sm hover:shadow hover:border-primary/50 hover:bg-primary/5 transition-all {copiedLocal ? 'text-green-500 border-green-500/50 bg-green-500/10 hover:text-green-500 hover:bg-green-500/10 hover:border-green-500/50' : ''}">
                                            {#if copiedLocal}
                                                <Check class="h-4 w-4 animate-in zoom-in" />
                                            {:else}
                                                <Copy class="h-4 w-4 animate-in zoom-in" />
                                            {/if}
                                        </Button>
                                        <a href={localUrl} target="_blank" rel="noopener noreferrer" class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/50 bg-background shadow-sm hover:shadow hover:border-primary/50 hover:bg-primary/5 text-foreground transition-all" title="Open Link">
                                            <ExternalLink class="h-4 w-4" />
                                        </a>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Step 3 -->
                            <div class="flex items-start gap-4">
                                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-sm font-bold shadow-md shadow-primary/20">3</div>
                                <div>
                                    <p class="text-sm font-semibold text-foreground">Add to Home Screen</p>
                                    <p class="text-xs text-muted-foreground mt-0.5">Install the app for a native, full-screen experience.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                {:else}
                    <div class="mt-8 flex items-center justify-center p-8 rounded-xl bg-muted/20 border border-border/30 border-dashed">
                        <div class="flex items-center gap-3 text-sm text-muted-foreground animate-pulse">
                            <RefreshCw class="h-4 w-4 animate-spin" /> Discovering local network...
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- CLOUDFLARE TUNNEL SECTION -->
    <div class="group relative rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 to-card/30 backdrop-blur-xl p-6 shadow-xl transition-all hover:shadow-2xl hover:border-primary/20 overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
        <div class="relative flex flex-col md:flex-row items-start gap-6">
            <div class="rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-4 text-primary shrink-0 shadow-inner ring-1 ring-primary/20">
                <Globe class="h-7 w-7" />
            </div>
            <div class="flex-1 min-w-0 w-full space-y-6">
                <div class="flex flex-col gap-1.5">
                    <h3 class="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">Public Internet Access</h3>
                    <p class="text-sm text-muted-foreground leading-relaxed max-w-xl">
                        Expose this application securely to the internet via Cloudflare Tunnels. 
                        Use this conduit when you are away from home and need instant access.
                    </p>
                </div>

                <!-- Sleek Tunnel Toggle -->
                <div class="relative flex items-center justify-between p-5 rounded-xl border border-border/50 shadow-inner overflow-hidden transition-colors duration-500 {isEnabled ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'}">
                    {#if isEnabled}
                        <div class="absolute inset-0 bg-gradient-to-r from-green-500/10 to-transparent opacity-50"></div>
                    {/if}
                    
                    <div class="relative flex items-center gap-4 z-10">
                        <Switch 
                            id="tunnel-switch" 
                            checked={isEnabled} 
                            disabled={isLoading}
                            onCheckedChange={toggleTunnel} 
                            class="data-[state=checked]:bg-green-500 shadow-sm"
                        />
                        <Label for="tunnel-switch" class="text-base cursor-pointer font-semibold flex items-center gap-2">
                            {#if isLoading}
                                <RefreshCw class="h-4 w-4 animate-spin text-muted-foreground" /> 
                                <span class="text-muted-foreground">Negotiating Secure Tunnel...</span>
                            {:else if isEnabled}
                                <span class="text-green-600 dark:text-green-400 flex items-center gap-2">
                                    Tunnel Active
                                </span>
                            {:else}
                                Enable Secure Tunnel
                            {/if}
                        </Label>
                    </div>
                    
                    <div class="relative z-10">
                        {#if isLoading}
                            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                                <Zap class="h-5 w-5 text-muted-foreground animate-pulse" />
                            </div>
                        {:else if isEnabled}
                            <div class="relative flex h-10 w-10 items-center justify-center">
                                <span class="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-20 animate-ping"></span>
                                <div class="relative flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-600 dark:text-green-400 ring-1 ring-green-500/30 shadow-sm">
                                    <ShieldCheck class="h-5 w-5" />
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

                {#if error}
                    <div class="rounded-xl bg-destructive/10 p-4 text-sm font-medium text-destructive border border-destructive/20 flex items-center animate-in fade-in slide-in-from-top-2">
                        {error}
                    </div>
                {/if}

                {#if publicUrl}
                    <div class="mt-8 flex flex-col sm:flex-row items-center sm:items-start gap-8 pt-6 border-t border-border/30 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-500">
                        <!-- QR Code with Scanner Reticle & Glow -->
                        <div class="relative group/qr shrink-0">
                            <!-- Animated Glow (Green tint for secure tunnel) -->
                            <div class="absolute -inset-2 bg-gradient-to-tr from-green-500/40 via-primary/40 to-green-500/40 rounded-3xl blur-xl opacity-60 group-hover/qr:opacity-100 animate-pulse transition-opacity duration-700"></div>
                            
                            <div class="relative flex justify-center items-center rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/10 dark:ring-white/10 z-10 transition-transform duration-300 group-hover/qr:scale-[1.02]">
                                <!-- Scanner Reticles -->
                                <div class="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-green-600/70 rounded-tl-sm transition-all duration-300 group-hover/qr:border-green-500 group-hover/qr:scale-110 -translate-x-1 -translate-y-1"></div>
                                <div class="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-green-600/70 rounded-tr-sm transition-all duration-300 group-hover/qr:border-green-500 group-hover/qr:scale-110 translate-x-1 -translate-y-1"></div>
                                <div class="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-green-600/70 rounded-bl-sm transition-all duration-300 group-hover/qr:border-green-500 group-hover/qr:scale-110 -translate-x-1 translate-y-1"></div>
                                <div class="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-green-600/70 rounded-br-sm transition-all duration-300 group-hover/qr:border-green-500 group-hover/qr:scale-110 translate-x-1 translate-y-1"></div>
                                
                                <canvas bind:this={publicCanvas}></canvas>
                            </div>
                        </div>
                        
                        <!-- Frictionless 1-2-3 Steps -->
                        <div class="flex flex-col gap-5 w-full min-w-0 pt-2">
                            <!-- Step 1 -->
                            <div class="flex items-start gap-4">
                                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-600 text-white text-sm font-bold shadow-md shadow-green-500/30">1</div>
                                <div>
                                    <p class="text-sm font-semibold text-foreground">Scan with your camera</p>
                                    <p class="text-xs text-muted-foreground mt-0.5">Point your phone's camera at the secure QR code.</p>
                                </div>
                            </div>
                            
                            <!-- Step 2 -->
                            <div class="flex items-start gap-4">
                                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-600 text-white text-sm font-bold shadow-md shadow-green-500/30">2</div>
                                <div class="w-full">
                                    <p class="text-sm font-semibold text-foreground">Open the secure link</p>
                                    <div class="flex items-center gap-2 mt-2 w-full max-w-full">
                                        <code class="flex-1 overflow-x-auto rounded-lg bg-green-500/10 dark:bg-green-500/20 px-3 py-2 text-xs font-semibold whitespace-nowrap border border-green-500/30 text-green-700 dark:text-green-400 shadow-inner">
                                            {publicUrl}
                                        </code>
                                        <Button size="icon" variant="outline" onclick={() => handleCopy(publicUrl, false)} title="Copy URL" class="h-9 w-9 shrink-0 shadow-sm hover:shadow hover:border-green-500/50 hover:bg-green-500/10 hover:text-green-600 transition-all {copiedPublic ? 'text-green-700 border-green-500/50 bg-green-500/20 hover:text-green-700 hover:bg-green-500/20 hover:border-green-500/50' : ''}">
                                            {#if copiedPublic}
                                                <Check class="h-4 w-4 animate-in zoom-in" />
                                            {:else}
                                                <Copy class="h-4 w-4 animate-in zoom-in" />
                                            {/if}
                                        </Button>
                                        <a href={publicUrl} target="_blank" rel="noopener noreferrer" class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/50 bg-background shadow-sm hover:shadow hover:border-green-500/50 hover:bg-green-500/10 hover:text-green-600 text-foreground transition-all" title="Open Link">
                                            <ExternalLink class="h-4 w-4" />
                                        </a>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Notice Box -->
                            <div class="ml-11 mt-1 rounded-xl bg-muted/40 p-3.5 border border-border/50 shadow-sm">
                                <p class="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                                    <ShieldCheck class="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                                    <span><strong class="font-semibold text-foreground">Secure & Private:</strong> This URL is temporary and rotates each time you start the tunnel, ensuring your AI remains private.</span>
                                </p>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
