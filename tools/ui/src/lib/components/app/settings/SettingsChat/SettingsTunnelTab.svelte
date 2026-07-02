<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Switch } from '$lib/components/ui/switch';
    import { onMount } from 'svelte';
    import QRCode from 'qrcode';
    import { ExternalLink, Copy } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';

    let isEnabled = $state(false);
    let isLoading = $state(false);
    let publicUrl = $state<string | null>(null);
    let error = $state<string | null>(null);
    let canvas: HTMLCanvasElement;

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
                    // Svelte 5 canvas binding might not be immediately available if it was inside an #if that just rendered, 
                    // but we will use a timeout or render it in an effect.
                    setTimeout(() => {
                        if (canvas) {
                            QRCode.toCanvas(canvas, data.url, { width: 250, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
                        }
                    }, 50);
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

    $effect(() => {
        if (publicUrl && canvas) {
            QRCode.toCanvas(canvas, publicUrl, { width: 250, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
        }
    });
</script>

<div class="space-y-6">
    <div class="flex flex-col gap-1">
        <h3 class="text-lg font-medium">Public Internet Access</h3>
        <p class="text-sm text-muted-foreground">
            Expose this application to the internet securely via Cloudflare Tunnels. 
            This allows you to access your AI from your phone or anywhere outside your local network.
        </p>
    </div>

    <div class="flex items-center space-x-2">
        <Switch 
            id="tunnel-switch" 
            checked={isEnabled} 
            disabled={isLoading}
            onCheckedChange={toggleTunnel} 
        />
        <Label for="tunnel-switch">
            {isLoading ? 'Negotiating Tunnel...' : (isEnabled ? 'Tunnel Active' : 'Enable Cloudflare Tunnel')}
        </Label>
    </div>

    {#if error}
        <div class="rounded bg-destructive/20 p-3 text-sm text-destructive border border-destructive/50">
            {error}
        </div>
    {/if}

    {#if publicUrl}
        <div class="mt-6 rounded-lg border bg-card p-6 shadow-sm">
            <h4 class="mb-4 text-center font-medium">Scan to open on your phone</h4>
            <div class="flex justify-center rounded bg-white p-4 mx-auto w-fit">
                <canvas bind:this={canvas}></canvas>
            </div>
            
            <div class="mt-6 flex flex-col items-center gap-2">
                <div class="flex items-center gap-2">
                    <code class="rounded bg-muted px-2 py-1 text-sm font-semibold">{publicUrl}</code>
                    <Button size="icon" variant="ghost" class="h-8 w-8" onclick={() => navigator.clipboard.writeText(publicUrl || '')} title="Copy URL">
                        <Copy class="h-4 w-4" />
                    </Button>
                </div>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" class="flex items-center text-sm text-primary hover:underline mt-2">
                    Open in new tab <ExternalLink class="ml-1 h-3 w-3" />
                </a>
            </div>
        </div>
        
        <p class="text-xs text-muted-foreground mt-4 italic">
            Note: This URL is temporary and will change next time you restart the tunnel. 
            When opening on your mobile device, you can use your browser's "Add to Home Screen" feature to install it as an app.
        </p>
    {/if}
</div>
