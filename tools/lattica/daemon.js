import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import express from 'express';
import cors from 'cors';
// Keep track of discovered peers and their active IPs
const discoveredPeers = new Map();
async function startLatticaNode() {
    const node = await createLibp2p({
        addresses: {
            listen: ['/ip4/0.0.0.0/tcp/0']
        },
        transports: [
            tcp()
        ],
        connectionEncryption: [
            noise()
        ],
        streamMuxers: [
            yamux()
        ],
        peerDiscovery: [
            mdns({
                interval: 5000 // discover peers every 5 seconds
            })
        ]
    });
    node.addEventListener('peer:discovery', (evt) => {
        const peer = evt.detail;
        const peerId = peer.id.toString();
        console.log(`Discovered peer: ${peerId}`);
        // Extract IPv4 addresses
        const ips = peer.multiaddrs
            .map(ma => ma.toString())
            .filter(addr => addr.includes('/ip4/') && !addr.includes('127.0.0.1'))
            .map(addr => addr.split('/')[2]);
        if (ips.length > 0) {
            discoveredPeers.set(peerId, ips);
        }
    });
    await node.start();
    console.log(`Lattica P2P Daemon started with peer id: ${node.peerId.toString()}`);
    return node;
}
// Start Express Server
const app = express();
app.use(cors());
const PORT = 50053;
const RPC_PORT = 50052; // Default llama.cpp rpc-server port
// Generate deterministic mock geo coordinates and latency based on peerId
function generateMockTelemetry(peerId) {
    // Simple hash function for string
    let hash = 0;
    for (let i = 0; i < peerId.length; i++) {
        hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Distribute lat between -60 and 70 (populated areas)
    const lat = -60 + (Math.abs(hash) % 130);
    // Distribute lng between -120 and 140
    const lng = -120 + ((Math.abs(hash) >> 2) % 260);
    // Latency between 10ms and 150ms
    const latency = 10 + (Math.abs(hash) % 140);
    return { lat, lng, latency };
}
app.get('/peers', (req, res) => {
    const activePeers = [];
    for (const [peerId, ips] of discoveredPeers.entries()) {
        if (ips.length > 0) {
            const { lat, lng, latency } = generateMockTelemetry(peerId);
            activePeers.push({
                id: peerId,
                ip: ips[0],
                endpoint: `${ips[0]}:${RPC_PORT}`,
                latency,
                geo: { lat, lng },
                status: 'Active'
            });
        }
    }
    res.json({
        status: 'success',
        peers: activePeers,
        count: activePeers.length
    });
});
app.listen(PORT, () => {
    console.log(`Lattica REST API listening on http://localhost:${PORT}`);
});
startLatticaNode().catch(console.error);
//# sourceMappingURL=daemon.js.map