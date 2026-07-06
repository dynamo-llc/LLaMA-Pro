/**
 * Returns the base HTTP URL for a local backend service.
 * Handles Electron (app:// protocol), web dev server, and LAN hosting.
 *
 * @param port - 'orchestrator' (default, port 8000) or 'llama' (port 8080)
 */
export function getBaseUrl(port: 'orchestrator' | 'llama' = 'orchestrator'): string {
    if (typeof window === 'undefined') {
        const portNum = port === 'llama' ? '8080' : '8000';
        return `http://127.0.0.1:${portNum}`;
    }
    const isDesktop =
        window.location.protocol === 'app:' ||
        !window.location.hostname ||
        window.location.hostname === '';
    const host = isDesktop ? '127.0.0.1' : window.location.hostname;
    const portNum =
        port === 'llama'
            ? ((window as any).llamaPort ?? '8080')
            : ((window as any).orchestratorPort ?? '8000');
    return `http://${host}:${portNum}`;
}

/**
 * Returns the base HTTP URL for a sidecar daemon service.
 * Ports are allocated at startup and injected as window.latticaPort / window.echoPort.
 *
 * @param daemon - 'lattica' (default port 50053) or 'echo' (default port 50054)
 */
export function getDaemonUrl(daemon: 'lattica' | 'echo'): string {
    if (typeof window === 'undefined') {
        const portNum = daemon === 'lattica' ? '50053' : '50054';
        return `http://127.0.0.1:${portNum}`;
    }
    const isDesktop =
        window.location.protocol === 'app:' ||
        !window.location.hostname ||
        window.location.hostname === '';
    const host = isDesktop ? '127.0.0.1' : window.location.hostname;
    const portNum =
        daemon === 'lattica'
            ? ((window as any).latticaPort ?? '50053')
            : ((window as any).echoPort ?? '50054');
    return `http://${host}:${portNum}`;
}
