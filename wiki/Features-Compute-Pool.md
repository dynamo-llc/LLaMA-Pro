# Compute Pool

One of the most powerful features of **LLaMA Pro** is its ability to distribute inference workloads across multiple machines using a decentralized peer-to-peer network known as the **Compute Pool**.

## What is the Compute Pool?

When running massive LLMs (like 70B+ parameter models), a single consumer-grade desktop often lacks the VRAM or CPU power to achieve acceptable token generation speeds. The Compute Pool solves this by allowing multiple instances of LLaMA Pro on different machines (e.g., your laptop, your desktop, and a friend's PC) to link together.

When linked, they share the compute burden. The network automatically chunks and distributes matrix multiplications across the available nodes.

## How it Works

1. **Host Node (Orchestrator):** The primary machine running the LLaMA Pro UI. This node holds the model structure and coordinates the network.
2. **Worker Nodes:** Secondary machines running LLaMA Pro (or just the headless `llama-server`) that connect to the Host Node.
3. **RPC (Remote Procedure Call):** Nodes communicate over the network via gRPC, transferring tensor data back and forth securely.

## Setting Up a Compute Pool

### Step 1: Start Worker Nodes
On your secondary machines, launch LLaMA Pro and navigate to the **Compute Pool** settings. Enable **Worker Mode** and ensure your firewall allows inbound connections on the specified port.

### Step 2: Connect the Host Node
On your primary machine, go to the **Compute Pool** tab.
- Click **Add Node**.
- Enter the IP address and port of your Worker Nodes.
- Click **Connect**.

### Step 3: Load the Model
Once the nodes are connected and green (active) in your Telemetry dashboard, load your `.gguf` model. LLaMA Pro will automatically detect the Compute Pool and split the model layers across the available machines based on their reported VRAM capacities.

> [!WARNING]
> The Compute Pool requires high network bandwidth (preferably Gigabit Ethernet or Wi-Fi 6) between nodes. High network latency will severely bottleneck inference speeds, as massive amounts of tensor data are transferred during every token generation step.
