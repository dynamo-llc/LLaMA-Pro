<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Switch } from '$lib/components/ui/switch';
    import { onMount } from 'svelte';
    import QRCode from 'qrcode';
    import { ExternalLink, Copy, Wifi } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button';

    let isEnabled = $state(false);
    let isLoading = $state(false);
    let publicUrl = $state<string | null>(null);
    let localUrl = $state<string | null>(null);
    let error = $state<string | null>(null);
    
    let publicCanvas = $state<HTMLCanvasElement>();
    let localCanvas = $state<HTMLCanvasElement>();

    // Helper to get a nice color from CSS variables (e.g. primary color) or fallback
    function getThemeColors() {
        if (typeof document === 'undefined') return { dark: '#000000', light: '#ffffff' };
        
        // We can check if it's dark mode
        const isDark = document.documentElement.classList.contains('dark');
        
        // Neon City theme adds bright colors, let's use a nice vibrant blue for the QR code to make it look "polished"
        // Actually, let's just make it a clean dark gray on light, and white on transparent for dark
        if (isDark) {
            return { dark: '#ffffff', light: '#00000000' };
        } else {
            return { dark: '#0f172a', light: '#ffffff' };
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
                width: 200, 
                margin: 2, 
                color: colors 
            });
        }
        
        if (localUrl && localCanvas) {
            QRCode.toCanvas(localCanvas, localUrl, { 
                width: 200, 
                margin: 2, 
                color: colors 
            });
        }
    });
</script>

<div class="space-y-10">
    <!-- LOCAL NETWORK SECTION -->
    <div class="space-y-6 relative overflow-hidden rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md">
        <div class="flex flex-col md:flex-row items-start gap-4">
            <div class="rounded-full bg-primary/10 p-3 text-primary shrink-0">
                <Wifi class="h-6 w-6" />
            </div>
            <div class="flex-1 min-w-0">
                <h3 class="text-lg font-medium">Local Network Access</h3>
                <p class="text-sm text-muted-foreground mt-1">
                    Access your AI instantly from any device on your local Wi-Fi. 
                    This connection is direct, incredibly fast, and doesn't route through the internet.
                </p>
                
                {#if localUrl}
                    <div class="mt-6 flex flex-col md:flex-row items-center md:items-start gap-6">
                        <div class="flex justify-center rounded-xl bg-white/5 p-2 ring-1 ring-inset ring-white/10 dark:ring-white/20 shrink-0">
                            <canvas bind:this={localCanvas}></canvas>
                        </div>
                        
                        <div class="flex flex-col items-center md:items-start gap-3 w-full min-w-0">
                            <h4 class="font-medium">Scan with your phone camera</h4>
                            <div class="flex items-center gap-2 w-full max-w-full">
                                <code class="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm font-semibold whitespace-nowrap">
                                    {localUrl}
                                </code>
                                <Button size="icon" variant="outline" onclick={() => navigator.clipboard.writeText(localUrl || '')} title="Copy URL" class="shrink-0">
                                    <Copy class="h-4 w-4" />
                                </Button>
                            </div>
                            <a href={localUrl} target="_blank" rel="noopener noreferrer" class="flex items-center text-sm text-primary hover:underline mt-2">
                                Open link <ExternalLink class="ml-1 h-3 w-3" />
                            </a>
                        </div>
                    </div>
                {:else}
                    <div class="mt-4 text-sm text-muted-foreground animate-pulse">
                        Discovering local network...
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- CLOUDFLARE TUNNEL SECTION -->
    <div class="space-y-6 rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md">
        <div class="flex flex-col gap-1">
            <h3 class="text-lg font-medium">Public Internet Access</h3>
            <p class="text-sm text-muted-foreground">
                Expose this application to the internet securely via Cloudflare Tunnels. 
                Use this when you are away from home and not on the same Wi-Fi.
            </p>
        </div>

        <div class="flex items-center space-x-3 p-4 rounded-lg bg-muted/50 border border-muted">
            <Switch 
                id="tunnel-switch" 
                checked={isEnabled} 
                disabled={isLoading}
                onCheckedChange={toggleTunnel} 
            />
            <Label for="tunnel-switch" class="text-base cursor-pointer">
                {isLoading ? 'Negotiating Secure Tunnel...' : (isEnabled ? 'Tunnel Active' : 'Enable Cloudflare Tunnel')}
            </Label>
        </div>

        {#if error}
            <div class="rounded-md bg-destructive/15 p-4 text-sm text-destructive border border-destructive/30 flex items-center">
                {error}
            </div>
        {/if}

        {#if publicUrl}
            <div class="mt-6 flex flex-col md:flex-row items-center md:items-start gap-6 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div class="flex justify-center rounded-xl bg-white/5 p-2 ring-1 ring-inset ring-white/10 dark:ring-white/20 shrink-0">
                    <canvas bind:this={publicCanvas}></canvas>
                </div>
                
                <div class="flex flex-col items-center md:items-start gap-3 w-full min-w-0">
                    <h4 class="font-medium text-primary">Temporary Public URL Ready</h4>
                    <div class="flex items-center gap-2 w-full max-w-full">
                        <code class="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm font-semibold whitespace-nowrap">
                            {publicUrl}
                        </code>
                        <Button size="icon" variant="outline" onclick={() => navigator.clipboard.writeText(publicUrl || '')} title="Copy URL" class="shrink-0">
                            <Copy class="h-4 w-4" />
                        </Button>
                    </div>
                    <a href={publicUrl} target="_blank" rel="noopener noreferrer" class="flex items-center text-sm text-primary hover:underline mt-2">
                        Open link <ExternalLink class="ml-1 h-3 w-3" />
                    </a>
                    <p class="text-xs text-muted-foreground mt-2 max-w-sm">
                        Note: This URL is temporary and changes each time you start the tunnel.
                    </p>
                </div>
            </div>
        {/if}
    </div>
</div>
