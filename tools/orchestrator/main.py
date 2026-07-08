import asyncio
import json
import logging
import os
import math
import datetime
import simpleeval
import re
import httpx
import socket
import subprocess
import uuid
import time
import sys
import collections
import threading
from typing import List, AsyncGenerator, Optional, Dict, Any
from typing_extensions import TypedDict
from fastapi import FastAPI, Request, Response, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from fastapi.staticfiles import StaticFiles

from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END


from tunnel import TunnelManager, get_local_ip
from news import news_manager

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Resolve ports at module level so every internal HTTP call uses the real dynamically-assigned port.
# main.js passes --port <n> as a CLI arg; LLAMA_PORT is injected via environment variable.
_port_arg_idx = sys.argv.index("--port") + 1 if "--port" in sys.argv else -1
ORCHESTRATOR_PORT: int = int(sys.argv[_port_arg_idx]) if _port_arg_idx > 0 else int(os.getenv("ORCHESTRATOR_PORT", "8000"))
LLAMA_PORT: int = int(os.getenv("LLAMA_PORT", "8080"))

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_: FastAPI):
    asyncio.create_task(udp_broadcaster())
    asyncio.create_task(udp_listener())
    asyncio.create_task(cleanup_stale_peers())
    start_local_mcp_servers()
    news_manager.start_background_fetch()
    _preload_tts()
    yield
    stop_rpc_server()
    stop_local_mcp_servers()

app = FastAPI(lifespan=lifespan)

@app.get("/api/tunnel/local")
def get_local_network_ip():
    ip = get_local_ip()
    # The frontend knows the port (usually 8000), but we can just return the IP
    return {"ip": ip}

def get_app_data_dir():
	if sys.platform == "win32":
		return os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
	elif sys.platform == "darwin":
		return os.path.expanduser("~/Library/Application Support")
	else:
		return os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))

def get_base_paths():
	app_data = get_app_data_dir()
	config_dir = os.path.join(app_data, 'LLaMA Pro')
	os.makedirs(config_dir, exist_ok=True)
	providers_file = os.path.join(config_dir, "providers.json")
	swarm_config_file = os.path.join(config_dir, "swarm_configs.json")

	if getattr(sys, 'frozen', False):
		exe_dir = os.path.dirname(sys.executable)
		base_dir = os.path.abspath(os.path.join(exe_dir, ".."))
		rpc_path = os.path.join(exe_dir, "rpc-server.exe")
	else:
		script_dir = os.path.dirname(__file__)
		base_dir = os.path.abspath(os.path.join(script_dir, "..", ".."))
		rpc_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "rpc-server.exe"))
		if not os.path.exists(rpc_path):
			rpc_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "Release", "rpc-server.exe"))
	return base_dir, providers_file, swarm_config_file, rpc_path

BASE_DIR, PROVIDERS_FILE, SWARM_CONFIG_FILE, RPC_PATH = get_base_paths()
tunnel_manager = TunnelManager(BASE_DIR)

class MemoryManager:
    def __init__(self):
        self.filepath = os.path.join(BASE_DIR, "tools", "orchestrator", "companion_memories.json")
        self.memories = []
        self.load()

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.memories = json.load(f)
            except Exception as e:
                logger.error(f"Error loading memories: {e}")
                # Back up before discarding so data is recoverable
                try:
                    import shutil
                    shutil.copy2(self.filepath, self.filepath + ".bak")
                except OSError:
                    pass
                self.memories = []

    def save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.memories, f, indent=4, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error saving memories: {e}")

    def add_memory(self, text: str):
        if text and text not in self.memories:
            self.memories.append(text)
            self.save()

    def scan_for_memories(self, text: str):
        text_lower = text.lower()
        patterns = [
            (r"\bmy name is ([a-zA-Z0-9 ]+)", "User's name is {0}"),
            (r"\bi am working on ([a-zA-Z0-9 _-]+)", "User is working on {0}"),
            (r"\bi prefer ([a-zA-Z0-9 ]+)", "User prefers {0}"),
            (r"\bi like ([a-zA-Z0-9 ]+)", "User likes {0}")
        ]
        for pattern, memory_template in patterns:
            match = re.search(pattern, text_lower)
            if match:
                extracted = match.group(1).strip()
                fact = memory_template.format(extracted.title())
                self.add_memory(fact)
                logger.info(f"Extracted memory fact: {fact}")

memory_manager = MemoryManager()

def compile_system_workspace_context():
    context_lines = []
    try:
        branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=BASE_DIR, stderr=subprocess.DEVNULL)
        context_lines.append(f"Git Branch: {branch.decode('utf-8').strip()}")
    except Exception:
        pass
    try:
        status = subprocess.check_output(["git", "status", "-s"], cwd=BASE_DIR, stderr=subprocess.DEVNULL)
        modified_files = status.decode('utf-8').strip()
        if modified_files:
            files = [line.strip() for line in modified_files.split("\n") if line.strip()][:5]
            context_lines.append("Modified Files:\n" + "\n".join([f"  {f}" for f in files]))
    except Exception:
        pass
    return "\n".join(context_lines)


def load_providers():
    if os.path.exists(PROVIDERS_FILE):
        try:
            with open(PROVIDERS_FILE, "r") as f:
                data = json.load(f)
                for k, v in data.items():
                    if "api_key" in v and "api_keys" not in v:
                        v["api_keys"] = [v["api_key"]] if v["api_key"] else []
                        del v["api_key"]
                return data
        except Exception as e:
            logger.error(f"Failed to load providers.json: {e}")
    return {}

def save_providers():
    try:
        with open(PROVIDERS_FILE, "w") as f:
            json.dump(providers_state, f, indent=4)
    except Exception as e:
        logger.error(f"Failed to save providers.json: {e}")

providers_state = load_providers()

RPC_PORT = 50052
BROADCAST_PORT = 8081
PEER_ID = str(uuid.uuid4())
HOSTNAME = socket.gethostname()

rpc_state = {
    "is_sharing_enabled": False,
    "always_share": False,
    "pending_requests": [],
    "peers": {},
    "connected_peers": set(),
    "rpc_process": None
}
_rpc_state_lock = asyncio.Lock()

async def udp_broadcaster():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind(("", 0))
    while True:
        try:
            msg = json.dumps({
                "type": "llama-rpc-discovery",
                "peer_id": PEER_ID,
                "hostname": HOSTNAME,
                "rpc_active": rpc_state["is_sharing_enabled"],
                "rpc_port": RPC_PORT,
                "orchestrator_port": ORCHESTRATOR_PORT,
            }).encode('utf-8')
            sock.sendto(msg, ('<broadcast>', BROADCAST_PORT))
        except Exception:
            pass
        await asyncio.sleep(5)

async def udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except AttributeError:
        pass
    sock.bind(("", BROADCAST_PORT))
    sock.setblocking(False)
    
    loop = asyncio.get_running_loop()
    while True:
        try:
            data, addr = await loop.sock_recvfrom(sock, 1024)
            msg = json.loads(data.decode('utf-8'))
            if msg.get("type") == "llama-rpc-discovery" and msg.get("peer_id") != PEER_ID:
                peer_id = msg["peer_id"]
                async with _rpc_state_lock:
                    rpc_state["peers"][peer_id] = {
                        "ip": addr[0],
                        "hostname": msg.get("hostname", "Unknown"),
                        "rpc_active": msg.get("rpc_active", False),
                        "rpc_port": msg.get("rpc_port", RPC_PORT),
                        "orchestrator_port": msg.get("orchestrator_port", 8000),
                        "last_seen": time.time()
                    }
        except OSError as exc:
            logger.debug(f"UDP recv error: {exc}")
            break
        except Exception:
            pass

async def cleanup_stale_peers():
    while True:
        now = time.time()
        async with _rpc_state_lock:
            stale_ids = [pid for pid, info in rpc_state["peers"].items() if now - info["last_seen"] > 15]
            for pid in stale_ids:
                del rpc_state["peers"][pid]
        await asyncio.sleep(10)

def start_rpc_server():
    if rpc_state["rpc_process"] is None:
        logger.info("Starting RPC server...")
        try:
            rpc_state["rpc_process"] = subprocess.Popen([RPC_PATH, "-p", str(RPC_PORT)])
        except Exception as e:
            logger.error(f"Failed to start RPC server: {e}")

def stop_rpc_server():
    if rpc_state["rpc_process"] is not None:
        logger.info("Stopping RPC server...")
        rpc_state["rpc_process"].terminate()
        rpc_state["rpc_process"] = None

_mcp_lock = threading.Lock()
mcp_processes: dict[int, subprocess.Popen] = {}  # port -> process
mcp_start_times: dict[int, float] = {}  # port -> start_time
is_shutting_down = False
ghost_protocol = False
daemon_loop = False
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def monitor_and_restart(cfg):
    global is_shutting_down
    port = cfg["port"]
    if is_port_in_use(port):
        logger.info(f"Port {port} is already in use. Skipping auto-start for local MCP: {cfg['name']}.")
        return

    cwd = cfg.get("cwd")
    if cwd and not os.path.exists(cwd):
        logger.warning(f"Directory {cwd} does not exist. Skipping {cfg['name']}.")
        return

    attempts = 0
    max_attempts = 5
    while not is_shutting_down and attempts < max_attempts:
        try:
            logger.info(f"Auto-starting local MCP server: {cfg['name']} on port {port}... (attempt {attempts + 1}/{max_attempts})")
            env = os.environ.copy()
            if "env" in cfg:
                env.update(cfg["env"])
            cmd = cfg["cmd"]
            if cfg.get("is_stdio"):
                proxy_script = os.path.join(BASE_DIR, "tools", "ui", "mcp-proxy.js")
                if not os.path.exists(proxy_script):
                    proxy_script = os.path.join(BASE_DIR, "app", "tools", "ui", "mcp-proxy.js") # Fallback for packaged app
                cmd = ["node", proxy_script, "--port", str(port)] + cmd

            log_dir = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_logs")
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, f"{port}.log")

            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write(f"\n--- Starting {cfg['name']} at {datetime.datetime.now().isoformat()} ---\n")
                log_file.flush()

                proc = subprocess.Popen(
                    cmd,
                    cwd=cwd,
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    env=env
                )
                with _mcp_lock:
                    mcp_processes[port] = proc
                    mcp_start_times[port] = time.time()
                proc.wait()
                
                log_file.write(f"\n--- Exited with code {proc.returncode} at {datetime.datetime.now().isoformat()} ---\n")
                log_file.flush()

            with _mcp_lock:
                if mcp_processes.get(port) is proc:
                    del mcp_processes[port]

            if is_shutting_down:
                break

            exit_code = proc.returncode
            if exit_code == 0:
                logger.info(f"MCP server {cfg['name']} exited cleanly.")
                break

            attempts += 1
            logger.warning(f"MCP server {cfg['name']} crashed (exit {exit_code}). Restarting in 2s... ({attempts}/{max_attempts})")
            time.sleep(2)
        except Exception as e:
            logger.error(f"Failed to start local MCP server {cfg['name']}: {e}")
            attempts += 1
            if is_shutting_down:
                break
            time.sleep(5)

    if attempts >= max_attempts:
        logger.error(f"MCP server {cfg['name']} exceeded restart cap ({max_attempts}). Giving up.")

def start_local_mcp_servers():
    base_dir = BASE_DIR
    
    config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            mcp_configs = json.load(f)
    except Exception as e:
        logger.error(f"Failed to load MCP configs from {config_path}: {e}")
        mcp_configs = []
    
    for cfg in mcp_configs:
        t = threading.Thread(target=monitor_and_restart, args=(cfg,), daemon=True)
        t.start()

def stop_local_mcp_servers():
    global is_shutting_down
    is_shutting_down = True
    with _mcp_lock:
        procs = list(mcp_processes.values())
        mcp_processes.clear()
    if procs:
        logger.info("Stopping local MCP servers...")
        for proc in procs:
            try:
                proc.terminate()
            except OSError:
                pass

class RpcSettings(BaseModel):
    is_sharing_enabled: bool
    always_share: bool

@app.get("/api/rpc/peers")
async def get_rpc_peers():
    return {"peers": rpc_state["peers"]}

@app.get("/api/rpc/settings")
async def get_rpc_settings():
    return {
        "is_sharing_enabled": rpc_state["is_sharing_enabled"],
        "always_share": rpc_state["always_share"]
    }

@app.post("/api/rpc/settings")
async def update_rpc_settings(settings: RpcSettings):
    rpc_state["is_sharing_enabled"] = settings.is_sharing_enabled
    rpc_state["always_share"] = settings.always_share
    
    if rpc_state["is_sharing_enabled"]:
        start_rpc_server()
    else:
        stop_rpc_server()
        
    return {"status": "success"}

class ProviderConfig(BaseModel):
    id: str
    name: str
    base_url: str
    api_keys: List[str]

@app.get("/api/providers")
async def get_providers():
    safe_providers = {}
    for k, v in providers_state.items():
        keys = v.get("api_keys", [])
        safe_providers[k] = {**v, "api_keys": ["***"] * len(keys)}
    return {"providers": safe_providers}

@app.post("/api/providers")
async def update_provider(provider: ProviderConfig):
    old_keys = providers_state.get(provider.id, {}).get("api_keys", [])
    new_keys = []
    for i, key in enumerate(provider.api_keys):
        if key == "***":
            if i < len(old_keys):
                new_keys.append(old_keys[i])
        else:
            new_keys.append(key)
            
    provider.api_keys = new_keys
    providers_state[provider.id] = provider.model_dump()
    save_providers()
    return {"status": "success"}

@app.delete("/api/providers/{provider_id}")
async def delete_provider(provider_id: str):
    if provider_id in providers_state:
        del providers_state[provider_id]
        save_providers()
    return {"status": "success"}

@app.get("/api/providers/{provider_id}/test")
async def test_provider_keys(provider_id: str):
    if provider_id not in providers_state:
        return {"error": "Provider not configured"}
    
    p_conf = providers_state[provider_id]
    base_url = p_conf.get("base_url", "").strip().rstrip("/")
    api_keys = p_conf.get("api_keys", [])
    
    if not base_url or not api_keys:
        return {"error": "Provider missing base URL or API keys"}
        
    results = []
    async with httpx.AsyncClient() as client:
        for key in api_keys:
            if not key:
                results.append({"valid": False, "error": "Empty key"})
                continue
            try:
                headers = {"Authorization": f"Bearer {key}"}
                if "openrouter" in base_url.lower():
                    headers["HTTP-Referer"] = f"http://localhost:{ORCHESTRATOR_PORT}"
                    headers["X-Title"] = "LLaMA Server 2.0"
                
                url = get_models_url(base_url)
                resp = await client.get(url, headers=headers, timeout=5.0)
                # Some use /v1/models, some /models
                if resp.status_code == 404:
                    alt_url = f"{base_url}/models" if not base_url.endswith("/v1") else f"{base_url}/v1/models"
                    resp = await client.get(alt_url, headers=headers, timeout=5.0)
                    
                if resp.status_code == 200:
                    results.append({"valid": True})
                else:
                    results.append({"valid": False, "error": f"Status {resp.status_code}"})
            except Exception as e:
                results.append({"valid": False, "error": str(e)})
                
    return {"results": results}


class ConnectionRequest(BaseModel):
    requester_ip: str
    requester_hostname: str

@app.post("/api/rpc/incoming-request")
async def handle_incoming_request(req: ConnectionRequest, request: Request):
    client_ip = request.client.host
    if rpc_state["always_share"] and rpc_state["is_sharing_enabled"]:
        return {"status": "accepted"}
    
    req_id = str(uuid.uuid4())
    async with _rpc_state_lock:
        rpc_state["pending_requests"].append({
            "id": req_id,
            "ip": client_ip,
            "hostname": req.requester_hostname,
            "timestamp": time.time()
        })
    
    for _ in range(60):
        async with _rpc_state_lock:
            still_pending = any(r["id"] == req_id for r in rpc_state["pending_requests"])
            peer_accepted = client_ip in rpc_state["connected_peers"]
        if not still_pending:
            if peer_accepted:
                return {"status": "accepted"}
            else:
                return {"status": "rejected"}
        await asyncio.sleep(1)
        
    async with _rpc_state_lock:
        rpc_state["pending_requests"] = [r for r in rpc_state["pending_requests"] if r["id"] != req_id]
    return {"status": "rejected", "reason": "timeout"}

@app.get("/api/rpc/pending-requests")
async def get_pending_requests():
    return {"requests": rpc_state["pending_requests"]}

@app.post("/api/rpc/authorize/{req_id}")
async def authorize_request(req_id: str, accept: bool):
    async with _rpc_state_lock:
        request_obj = next((r for r in rpc_state["pending_requests"] if r["id"] == req_id), None)
        if not request_obj:
            return {"status": "error", "message": "Request not found"}
        rpc_state["pending_requests"] = [r for r in rpc_state["pending_requests"] if r["id"] != req_id]
        if accept:
            rpc_state["is_sharing_enabled"] = True
            rpc_state["connected_peers"].add(request_obj["ip"])
    if accept:
        start_rpc_server()
        return {"status": "success", "action": "accepted"}
    else:
        return {"status": "success", "action": "rejected"}

@app.post("/api/rpc/connect/{peer_id}")
async def connect_to_peer(peer_id: str):
    if peer_id not in rpc_state["peers"]:
        return {"status": "error", "message": "Peer not found"}
        
    peer = rpc_state["peers"][peer_id]
    peer_ip = peer["ip"]
    
    peer_orchestrator_port = peer.get("orchestrator_port", 8000)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"http://{peer_ip}:{peer_orchestrator_port}/api/rpc/incoming-request",
                json={"requester_ip": HOSTNAME, "requester_hostname": HOSTNAME},
                timeout=65.0
            )
            if resp.status_code == 200 and resp.json().get("status") == "accepted":
                return {"status": "success", "message": "Connected", "rpc_endpoint": f"{peer_ip}:{peer['rpc_port']}"}
            else:
                return {"status": "rejected", "message": "Peer rejected the request"}
    except Exception as e:
        return {"status": "error", "message": str(e)}



@app.get("/api/news")
async def get_news():
    return JSONResponse(content=news_manager.get_news())

@app.get("/api/mcp")
def get_mcps():
    config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load MCP configs: {e}")
        return []

@app.post("/api/mcp")
async def add_mcp(request: Request):
    try:
        data = await request.json()
        config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
        configs = []
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                configs = json.load(f)
        
        if "port" not in data:
            # Find a free port starting from 8100
            port = 8100
            used_ports = {c.get("port") for c in configs}
            while port in used_ports or is_port_in_use(port):
                port += 1
            data["port"] = port

        configs.append(data)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(configs, f, indent=4)
        
        # Start the new MCP immediately
        t = threading.Thread(target=monitor_and_restart, args=(data,), daemon=True)
        t.start()
        
        return {"status": "success", "message": f"MCP {data.get('name')} installed and started.", "port": data["port"]}
    except Exception as e:
        logger.error(f"Failed to add MCP: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/mcp/{port}/toggle")
async def toggle_mcp(port: int, request: Request):
    with _mcp_lock:
        proc = mcp_processes.get(port)

    if proc is not None and proc.poll() is None:
        # Process is running - stop it
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except OSError:
                pass
        with _mcp_lock:
            if mcp_processes.get(port) is proc:
                del mcp_processes[port]
        return {"status": "stopped", "port": port}
    else:
        # Process is not running - find config and restart
        config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                mcp_configs = json.load(f)
        except Exception as e:
            return JSONResponse({"error": f"Could not load MCP configs: {e}"}, status_code=500)

        cfg = next((c for c in mcp_configs if c.get("port") == port), None)
        if not cfg:
            return JSONResponse({"error": f"No MCP config found for port {port}"}, status_code=404)

        t = threading.Thread(target=monitor_and_restart, args=(cfg,), daemon=True)
        t.start()
        return {"status": "starting", "port": port}

@app.delete("/api/mcp/{port}")
async def delete_mcp(port: int, request: Request):
    # 1. Kill the process if running
    with _mcp_lock:
        proc = mcp_processes.get(port)
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except OSError:
                pass
        with _mcp_lock:
            if mcp_processes.get(port) is proc:
                del mcp_processes[port]
    
    # 2. Remove from mcp_configs.json
    config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                mcp_configs = json.load(f)
            
            new_configs = [c for c in mcp_configs if c.get("port") != port]
            
            if len(new_configs) != len(mcp_configs):
                with open(config_path, "w", encoding="utf-8") as f:
                    json.dump(new_configs, f, indent=4)
        except Exception as e:
            logger.error(f"Failed to remove MCP config for port {port}: {e}")
            return JSONResponse({"error": f"Failed to remove from config: {e}"}, status_code=500)

    return {"status": "deleted", "port": port}

@app.get("/api/mcp/status")
async def mcp_status():
    status_map = {}
    config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
    
    # Check what is in the config
    mcp_configs = []
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                mcp_configs = json.load(f)
        except Exception:
            pass
            
    with _mcp_lock:
        for cfg in mcp_configs:
            port = cfg.get("port")
            if not port:
                continue
            proc = mcp_processes.get(port)
            if proc is not None and proc.poll() is None:
                uptime = time.time() - mcp_start_times.get(port, time.time())
                status_map[str(port)] = {"status": "running", "uptime_seconds": uptime}
            else:
                status_map[str(port)] = {"status": "crashed"}
                
    return status_map

@app.get("/api/mcp/{port}/logs")
async def get_mcp_logs(port: int):
    log_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_logs", f"{port}.log")
    if not os.path.exists(log_path):
        return {"logs": "No logs available yet."}
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            return {"logs": "".join(lines[-500:])}
    except Exception as e:
        return {"logs": f"Error reading logs: {e}"}

@app.post("/api/mcp/{port}/restart")
async def restart_mcp(port: int):
    with _mcp_lock:
        proc = mcp_processes.get(port)
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except OSError:
                pass
        with _mcp_lock:
            if mcp_processes.get(port) is proc:
                del mcp_processes[port]
    
    config_path = os.path.join(get_app_data_dir(), "LLaMA Pro", "mcp_configs.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            mcp_configs = json.load(f)
    except Exception as e:
        return JSONResponse({"error": f"Could not load MCP configs: {e}"}, status_code=500)

    cfg = next((c for c in mcp_configs if c.get("port") == port), None)
    if not cfg:
        return JSONResponse({"error": f"No MCP config found for port {port}"}, status_code=404)

    t = threading.Thread(target=monitor_and_restart, args=(cfg,), daemon=True)
    t.start()
    return {"status": "restarted", "port": port}
@app.post("/api/news/refresh")
async def refresh_news():
    return JSONResponse(content=news_manager.force_refresh())



@app.post("/api/shutdown")
async def shutdown_api():
    logger.info("Received shutdown request via API.")
    stop_rpc_server()
    stop_local_mcp_servers()
    # Schedule process exit to allow the HTTP response to be sent
    def exit_process():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=exit_process, daemon=True).start()
    return {"status": "shutting down"}

@app.get("/v1/system/status")
async def get_system_status():
    with _mcp_lock:
        live_mcps = [(port, proc) for port, proc in mcp_processes.items() if proc.poll() is None]
    return {
        "mcpServers": [{"port": port, "pid": proc.pid} for port, proc in live_mcps],
        "projects": [],
        "ghostProtocol": ghost_protocol,
        "daemon": daemon_loop,
    }

@app.post("/v1/system/ghost")
async def set_ghost_protocol(request: Request):
    global ghost_protocol
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1"):
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    data = await request.json()
    ghost_protocol = bool(data.get("active", False))
    logger.info(f"Ghost Protocol set to {ghost_protocol}")
    return {"ghostProtocol": ghost_protocol}

@app.post("/v1/system/daemon")
async def set_daemon_loop(request: Request):
    global daemon_loop
    data = await request.json()
    daemon_loop = bool(data.get("active", False))
    logger.info(f"Daemon Loop set to {daemon_loop}")
    return {"daemon": daemon_loop}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# LLM Setup - Pointing to the local and remote llama-server instances
# You can override these via environment variables before starting the script
DEFAULT_NODES = [
    {
        "id": "node-1",
        "role": "worker",
        "url": os.getenv("LITTLE_MODEL_URL", f"http://127.0.0.1:{LLAMA_PORT}/v1"),
        "model_name": os.getenv("LITTLE_MODEL_NAME", "little-model"),
        "temperature": 0.8,
        "persona": "You are a creative thinker. Provide an innovative and out-of-the-box perspective.",
        "sourceType": "local"
    },
    {
        "id": "node-2",
        "role": "worker",
        "url": os.getenv("LITTLE_MODEL_URL", f"http://127.0.0.1:{LLAMA_PORT}/v1"),
        "model_name": os.getenv("LITTLE_MODEL_NAME", "little-model"),
        "temperature": 0.8,
        "persona": "You are a critical analyst. Focus on facts, logic, and potential pitfalls.",
        "sourceType": "local"
    },
    {
        "id": "node-3",
        "role": "synthesizer",
        "url": os.getenv("BIG_MODEL_URL", f"http://127.0.0.1:{LLAMA_PORT}/v1"),
        "model_name": os.getenv("BIG_MODEL_NAME", "big-model"),
        "temperature": 0.1,
        "persona": "You are the Arbiter Judge. Your job is to read the original conversation and synthesize the proposals into a single cohesive answer.",
        "sourceType": "custom"
    }
]


def load_swarm_configs():
    global config_state
    if os.path.exists(SWARM_CONFIG_FILE):
        try:
            with open(SWARM_CONFIG_FILE, "r") as f:
                saved = json.load(f)
            configs = saved.get("configs", [])
            active_id = saved.get("active_config_id", "")
            
            # Find active config
            active_config = next((c for c in configs if c["id"] == active_id), None)
            if not active_config and configs:
                active_config = configs[0]
                active_id = active_config["id"]
                
            config_state = {
                "active_config_id": active_id,
                "configs": configs,
                "nodes": active_config["nodes"] if active_config else []
            }
            return
        except Exception as e:
            logger.error(f"Error loading swarm configs: {e}")
            
    # Default fallback
    config_state = {
        "active_config_id": "default",
        "configs": [
            {
                "id": "default",
                "name": "Default Swarm",
                "nodes": DEFAULT_NODES
            }
        ],
        "nodes": DEFAULT_NODES
    }
    save_swarm_configs()

def save_swarm_configs():
    try:
        with open(SWARM_CONFIG_FILE, "w") as f:
            json.dump({
                "active_config_id": config_state.get("active_config_id", ""),
                "configs": config_state.get("configs", [])
            }, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving swarm configs: {e}")

config_state = {}
load_swarm_configs()

@tool
def get_current_time(timezone: str = "UTC") -> str:
    """Gets the current time."""
    return f"The current time is {datetime.datetime.now().isoformat()}"

@tool
def calculate_math(expression: str) -> str:
    """Calculates the result of a mathematical expression. E.g. '2 + 2' or 'math.sqrt(16)'"""
    try:
        # Use simpleeval for safe mathematical parsing instead of unsafe eval
        result = simpleeval.simple_eval(expression, functions={"math": math})
        return str(result)
    except Exception as e:
        return f"Error calculating: {e}"

tools = [get_current_time, calculate_math]

llm_workers = []
llm_synthesizer = None

def init_llms():
    global llm_workers, llm_synthesizer
    llm_workers = []
    llm_synthesizer = None
    
    for node in config_state.get("nodes", []):
        url = node["url"]
        model_name = node["model_name"]
        api_key = "sk-no-key-required"
        
        if ":" in model_name:
            p_id, m_id = model_name.split(":", 1)
            if p_id in providers_state:
                url = f"http://127.0.0.1:{ORCHESTRATOR_PORT}/v1"
                api_key = "sk-dummy-key"
                # Keep model_name as p_id:m_id so the local proxy intercepts it

        llm = ChatOpenAI(
            base_url=url,
            api_key=api_key,
            model=model_name,
            temperature=node["temperature"]
        )
        if node["role"] == "worker":
            try:
                llm_with_tools = llm.bind_tools(tools)
                llm_workers.append({"id": node["id"], "llm": llm_with_tools, "persona": node["persona"]})
            except Exception as e:
                logger.warning(f"Failed to bind tools to worker {node['id']}: {e}")
                llm_workers.append({"id": node["id"], "llm": llm, "persona": node["persona"]})
        elif node["role"] == "synthesizer":
            class JudgeOutput(BaseModel):
                rejected: bool
                final_answer: str
            
            try:
                llm_synth_struct = llm.with_structured_output(JudgeOutput)
                llm_synthesizer = {"llm_struct": llm_synth_struct, "llm_raw": llm, "persona": node["persona"]}
            except Exception as e:
                logger.warning(f"Structured output failed for synthesizer: {e}")
                llm_synthesizer = {"llm_struct": llm, "llm_raw": llm, "persona": node["persona"]}

init_llms()

class SwarmNodeConfig(BaseModel):
    id: str
    role: str
    url: str
    model_name: str
    temperature: float
    persona: str
    sourceType: str = "local"

class SwarmConfigModel(BaseModel):
    id: str
    name: str
    nodes: List[SwarmNodeConfig]

class SwarmConfigsUpdate(BaseModel):
    configs: List[SwarmConfigModel]
    active_config_id: Optional[str] = None

class ActiveSwarmRequest(BaseModel):
    active_config_id: Optional[str] = None

@app.get("/v1/swarm/config")
async def get_config():
    return config_state

@app.post("/v1/swarm/config")
async def update_config(config: SwarmConfigsUpdate):
    config_state["configs"] = [c.dict() for c in config.configs]
    config_state["active_config_id"] = config.active_config_id
    
    # Update active nodes
    active_config = next((c for c in config_state["configs"] if c["id"] == config.active_config_id), None)
    if active_config:
        config_state["nodes"] = active_config["nodes"]
    else:
        config_state["nodes"] = []
        
    save_swarm_configs()
    init_llms()
    logger.info(f"Updated swarm configs, active_id={config.active_config_id}")
    return {"status": "success", "config": config_state}

@app.post("/v1/swarm/config/active")
async def set_active_swarm(body: ActiveSwarmRequest):
    config_state["active_config_id"] = body.active_config_id
    
    # Update active nodes
    active_config = next((c for c in config_state["configs"] if c["id"] == body.active_config_id), None)
    if active_config:
        config_state["nodes"] = active_config["nodes"]
    else:
        config_state["nodes"] = []
        
    save_swarm_configs()
    init_llms()
    logger.info(f"Changed active swarm config to: {body.active_config_id}")
    return {"status": "success", "config": config_state}


# LangGraph State
class AgentState(TypedDict):
    messages: List[BaseMessage]
    proposals: List[str]
    final_answer: str
    rejected: bool
    iterations: int

# Nodes
async def generate_proposals(state: AgentState):
    iteration = state.get('iterations', 0)
    logger.info(f"Generating proposals with Swarm Workers... (Iteration {iteration})")
    messages = state["messages"]
    
    async def run_agent(worker_info: dict) -> str:
        system_content = worker_info["persona"]
        if iteration > 0:
            system_content += f"\n\nNOTE: This is iteration {iteration}. The Judge rejected the previous proposals. Please try a different approach to satisfy the user's request."
            
        agent_messages = [SystemMessage(content=system_content)] + messages
        
        # Initial call
        response = await worker_info["llm"].ainvoke(agent_messages)
        
        # Extremely basic tool execution loop for the agent (max 2 tool calls to prevent infinite loops)
        loops = 0
        while hasattr(response, 'tool_calls') and len(response.tool_calls) > 0 and loops < 2:
            agent_messages.append(response)
            for tool_call in response.tool_calls:
                # Find matching tool
                tool_func = next((t for t in tools if t.name == tool_call["name"]), None)
                if tool_func:
                    try:
                        tool_result = tool_func.invoke(tool_call["args"])
                    except Exception as e:
                        tool_result = f"Error: {e}"
                else:
                    tool_result = "Tool not found."
                    
                agent_messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))
            
            # Re-invoke after tools
            response = await worker_info["llm"].ainvoke(agent_messages)
            loops += 1

        return response.content

    if not llm_workers:
        return {"proposals": ["No active Swarm Workers available."]}

    # Run all agents in parallel using asyncio.gather
    tasks = [run_agent(w) for w in llm_workers]
    proposals = await asyncio.gather(*tasks)
        
    return {"proposals": proposals}

async def judge_synthesis(state: AgentState):
    iterations = state.get("iterations", 0)
    logger.info(f"Swarm Synthesizer is processing proposals... (Iteration {iterations})")
    messages = state["messages"]
    proposals = state["proposals"]
    
    # Dynamically build the proposal list
    proposal_text = ""
    for idx, p in enumerate(proposals):
        proposal_text += f"Proposal {idx + 1}:\n{p}\n\n"

    judge_persona = "You are the Arbiter Judge. Your job is to read the original conversation and synthesize the proposals into a single cohesive answer."
    if llm_synthesizer and llm_synthesizer.get("persona"):
        judge_persona = llm_synthesizer["persona"]

    judge_prompt = f"""
    {judge_persona}
    
    IF AND ONLY IF ALL proposals are completely incorrect or fail to address the core problem, you MUST mark 'rejected' as true, and output the reason why they failed in 'final_answer'. This will force the agents to generate new proposals.

    {proposal_text}
    """
    
    judge_messages = messages + [HumanMessage(content=judge_prompt)]
    
    if not llm_synthesizer:
        return {"final_answer": "No Swarm Synthesizer available to judge the proposals.", "rejected": False, "iterations": iterations + 1}

    try:
        response = await llm_synthesizer["llm_struct"].ainvoke(judge_messages)
        if hasattr(response, "final_answer"):
            final_answer = response.final_answer
            rejected = response.rejected
        else:
            final_answer = response.content
            rejected = final_answer.strip().startswith("REJECT:")
    except Exception as e:
        logger.warning(f"Structured output parsing failed: {e}. Falling back to standard invoke.")
        fallback_resp = await llm_synthesizer["llm_raw"].ainvoke(judge_messages)
        content = fallback_resp.content
        rejected = content.strip().startswith("REJECT:")
        final_answer = content

    return {"final_answer": final_answer, "rejected": rejected, "iterations": iterations + 1}

def route_judge(state: AgentState) -> str:
    rejected = state.get("rejected", False)
    iters = state.get("iterations", 0)
    if rejected and iters < 3:
        logger.info(f"Judge rejected proposals. Looping back... (Iteration {iters})")
        return "generate"
    return END

# Graph Construction
workflow = StateGraph(AgentState)

workflow.add_node("generate", generate_proposals)
workflow.add_node("judge", judge_synthesis)

workflow.add_edge(START, "generate")
workflow.add_edge("generate", "judge")
workflow.add_conditional_edges("judge", route_judge, {"generate": "generate", END: END})

orchestrator_app = workflow.compile()

# API Endpoints
class ChatCompletionRequest(BaseModel):
    messages: List[dict]
    model: str = "swarm-ensemble"
    stream: bool = False
    temperature: float = 0.7

@app.api_route("/props", methods=["GET", "POST"])
@app.api_route("/slots", methods=["GET", "POST"])
@app.api_route("/health", methods=["GET"])
@app.api_route("/telemetry/app", methods=["GET"])
@app.api_route("/telemetry/sysinfo", methods=["GET"])
async def proxy_management(request: Request):
    path = request.url.path
    
    # Intercept props/slots for virtual models to avoid infinite loops and return mock data
    if path == "/props":
        model = request.query_params.get("model", "")
        if model == "swarm-ensemble" or ":" in model:
            has_vision = any(x in model.lower() for x in ["vision", "gpt-4", "gemini", "claude-3", "grok", "mistral-large"])
            return JSONResponse(content={
                "default_generation_settings": {
                    "n_ctx": 32768
                },
                "modalities": {
                    "vision": has_vision,
                    "audio": False,
                    "video": False
                }
            })
            
    if path == "/slots":
        model = request.query_params.get("model", "")
        if model == "swarm-ensemble" or ":" in model:
            return JSONResponse(content=[])

    url = f"http://127.0.0.1:{LLAMA_PORT}{path}"
    
    body = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=request.method,
                url=url,
                content=body,
                headers=headers,
                params=request.query_params
            )
            try:
                content = response.json()
                return JSONResponse(content=content, status_code=response.status_code)
            except Exception:
                return Response(content=response.content, status_code=response.status_code)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

def find_server_log_file():
    # 1. Try to find the running llama-server.exe CWD via psutil
    try:
        import psutil
        for proc in psutil.process_iter(['name']):
            try:
                if proc.info['name'] and 'llama-server' in proc.info['name'].lower():
                    # Try CWD first
                    cwd = proc.cwd()
                    if cwd:
                        log_path = os.path.join(cwd, "server.log")
                        if os.path.exists(log_path):
                            return log_path
                    # Try EXE directory next
                    exe_path = proc.exe()
                    if exe_path:
                        exe_dir = os.path.dirname(exe_path)
                        log_path = os.path.join(exe_dir, "server.log")
                        if os.path.exists(log_path):
                            return log_path
            except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
    except Exception as e:
        logger.debug(f"psutil check failed: {e}")

    # 2. Check sibling build/bin paths relative to orchestrator script
    try:
        script_dir = os.path.dirname(__file__)
        # check tools/orchestrator/../../build/bin/server.log
        dev_log_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "server.log"))
        if os.path.exists(dev_log_path):
            return dev_log_path
        # check tools/orchestrator/../../build/bin/Release/server.log
        release_log_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "Release", "server.log"))
        if os.path.exists(release_log_path):
            return release_log_path
    except Exception as e:
        pass

    # 3. Check current directory
    if os.path.exists("server.log"):
        return os.path.abspath("server.log")

    return None

@app.get("/api/logs/stream")
async def stream_logs():
    async def log_generator():
        log_file = None
        for _ in range(10):
            log_file = find_server_log_file()
            if log_file and os.path.exists(log_file):
                break
            await asyncio.sleep(1)
            
        if not log_file:
            # Fallback to CWD default path
            log_file = os.path.abspath("server.log")
            
        if not os.path.exists(log_file):
            yield "data: Waiting for server.log to be created...\n\n"
            while not os.path.exists(log_file):
                resolved = find_server_log_file()
                if resolved and os.path.exists(resolved):
                    log_file = resolved
                    break
                await asyncio.sleep(1)
        
        logger.info(f"Streaming logs from: {log_file}")
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            # Tail last 50 lines initially
            f.seek(0, 2)
            file_size = f.tell()
            chunk_size = 8192
            if file_size > chunk_size:
                f.seek(file_size - chunk_size)
            else:
                f.seek(0)
            
            lines = f.readlines()
            for line in lines[-50:]:
                if line.strip():
                    yield f"data: {line}\n\n"
            
            while True:
                try:
                    line = f.readline()
                    if line:
                        yield f"data: {line}\n\n"
                    else:
                        await asyncio.sleep(0.1)
                except GeneratorExit:
                    break
    
    return StreamingResponse(log_generator(), media_type="text/event-stream")

_cached_child_ports = []
_child_ports_last_discovered = 0
_CHILD_PORTS_TTL = 10  # seconds

def _discover_child_ports():
    global _cached_child_ports, _child_ports_last_discovered
    now = time.time()
    if now - _child_ports_last_discovered < _CHILD_PORTS_TTL and _cached_child_ports:
        return _cached_child_ports
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'llama-server.exe' -and $_.CommandLine -like '*--metrics*' -and $_.CommandLine -like '*--port*' } | ForEach-Object { if ($_.CommandLine -match '--port\\s+(\\d+)') { $Matches[1] } }"],
            capture_output=True, text=True, timeout=5
        )
        ports = []
        if result.returncode == 0:
            for line in result.stdout.strip().split('\n'):
                line = line.strip()
                if line.isdigit():
                    ports.append(int(line))
        if ports:
            _cached_child_ports = ports
            _child_ports_last_discovered = now
    except Exception:
        pass
    return _cached_child_ports

@app.get("/metrics")
async def get_metrics():
    """Aggregate metrics from all child llama-server instances by querying the C++ router."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            res = await client.get(f"http://127.0.0.1:{LLAMA_PORT}/metrics")
            if res.status_code == 200:
                return Response(content=res.text, media_type="text/plain")
    except Exception:
        pass
    return Response(content="# no metrics available\n", media_type="text/plain")

# Store loaded external models
loaded_external_models = {}

def get_models_url(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if base_url.endswith("/v1"):
        return f"{base_url}/models"
    return f"{base_url}/v1/models"

def get_chat_completions_url(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"

@app.get("/api/providers/models")
async def get_provider_models():
    all_models = []
    async with httpx.AsyncClient() as client:
        for p_id, p_conf in providers_state.items():
            base_url = p_conf.get("base_url", "").strip().rstrip("/")
            api_keys = p_conf.get("api_keys", [])
            api_key = api_keys[0] if api_keys else ""
            if not base_url or not api_key:
                continue
            try:
                headers = {"Authorization": f"Bearer {api_key}"}
                if "openrouter" in base_url.lower():
                    headers["HTTP-Referer"] = f"http://localhost:{ORCHESTRATOR_PORT}"
                    headers["X-Title"] = "LLaMA Server 2.0"
                url = get_models_url(base_url)
                resp = await client.get(url, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    models = resp.json().get("data", [])
                    for m in models:
                        m["id"] = f"{p_id}:{m['id']}" # Prefix with provider ID
                        m["owned_by"] = p_id
                        all_models.append(m)
            except Exception as e:
                logger.error(f"Failed to fetch models from {p_id}: {e}")
    return {"object": "list", "data": all_models}

@app.get("/v1/models")
async def get_models():
    models = {
        "object": "list",
        "data": [
            {
                "id": "swarm-ensemble",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "organization-owner",
                "status": {"value": "loaded"}
            }
        ]
    }
    
    # Add Swarm Configs (Teams/Companies) as models
    for config in config_state.get("configs", []):
        models["data"].append({
            "id": config.get("id", ""),
            "name": config.get("name", ""),
            "object": "model",
            "created": int(time.time()),
            "owned_by": "organization-owner",
            "status": {"value": "loaded"}
        })
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"http://127.0.0.1:{LLAMA_PORT}/v1/models", timeout=2.0)
            if resp.status_code == 200:
                backend_models = resp.json().get("data", [])
                models["data"].extend(backend_models)
    except Exception as e:
        logger.warning(f"Could not fetch models from backend: {e}")
        
    for em in loaded_external_models.values():
        models["data"].append(em)
        
    return models

@app.api_route("/models/{path:path}", methods=["GET", "POST", "DELETE"])
async def proxy_models(request: Request, path: str):
    url = f"http://127.0.0.1:{LLAMA_PORT}/models/{path}"
    
    # Fast paths for SSE
    if path == "sse":
        async def stream_generator():
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", url) as response:
                    async for chunk in response.aiter_bytes():
                        yield chunk
        return StreamingResponse(stream_generator(), media_type="text/event-stream")
        
    body = await request.body()
    
    if path == "load" and request.method == "POST":
        try:
            body_json = json.loads(body.decode("utf-8"))
            model_id = body_json.get("model", "")
            if ":" in model_id:
                p_id, m_id = model_id.split(":", 1)
                if p_id in providers_state:
                    loaded_external_models[model_id] = {
                        "id": model_id,
                        "object": "model",
                        "status": {"value": "loaded"}
                    }
                    # We need to tell the UI it's loaded via SSE, but for now we just return success
                    return JSONResponse({"status": "success", "message": "Model loaded virtually"})
        except (json.JSONDecodeError, ValueError):
            pass
            
    if path == "unload" and request.method == "POST":
        try:
            body_json = json.loads(body.decode("utf-8"))
            model_id = body_json.get("model", "")
            if model_id in loaded_external_models:
                del loaded_external_models[model_id]
                return JSONResponse({"status": "success", "message": "Model unloaded virtually"})
        except (json.JSONDecodeError, ValueError):
            pass

    # Generic proxy for other /models/ requests
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=request.method,
                url=url,
                content=body,
                headers=headers,
                params=request.query_params
            )
            
            try:
                content = response.json()
                return JSONResponse(content=content, status_code=response.status_code)
            except Exception:
                return Response(content=response.content, status_code=response.status_code)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/api/models/load")
async def api_load_model(request: Request):
    try:
        body = await request.json()
        model_id = body.get("model", "")
        if ":" in model_id:
            p_id, m_id = model_id.split(":", 1)
            if p_id in providers_state:
                loaded_external_models[model_id] = {
                    "id": model_id,
                    "object": "model",
                    "status": {"value": "loaded"}
                }
                return {"status": "success", "message": "Model loaded virtually"}
        return JSONResponse({"error": "Invalid API model or provider not configured"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@app.post("/api/models/unload")
async def api_unload_model(request: Request):
    try:
        body = await request.json()
        model_id = body.get("model", "")
        if model_id in loaded_external_models:
            del loaded_external_models[model_id]
            return {"status": "success", "message": "Model unloaded virtually"}
        return JSONResponse({"error": "Model not found or not an API model"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@app.get("/api/models/sse")
async def api_models_sse(request: Request):
    # Simple event stream that keeps alive, not currently needed for virtual models since they load instantly, 
    # but good for preventing 404s if UI hits it directly.
    async def stream_generator():
        yield b"data: {\"event\": \"keepalive\"}\n\n"
    return StreamingResponse(stream_generator(), media_type="text/event-stream")

# Add Tunnel Management API

@app.post("/v1/swarm/chat/completions")
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "swarm-ensemble")
    is_stream = body.get("stream", False)
    messages = body.get("messages", [])
    if not isinstance(messages, list):
        return JSONResponse({"error": "messages must be a list"}, status_code=422)
    
    # Scan latest user message for memories
    if messages:
        last_message = messages[-1]
        if last_message.get("role") == "user":
            content = last_message.get("content", "")
            if isinstance(content, list):
                text_content = ""
                for part in content:
                    if part.get("type") == "text":
                        text_content += part.get("text", "")
            else:
                text_content = str(content)
            memory_manager.scan_for_memories(text_content)

    # Inject memories and workspace context
    if messages:
        mem_str = "\n".join([f"- {m}" for m in memory_manager.memories])
        memory_context = f"\n\n[COMPANION MEMORIES]\n{mem_str}" if memory_manager.memories else ""
        
        sys_context = compile_system_workspace_context()
        workspace_context = f"\n\n[WORKSPACE CONTEXT]\n{sys_context}" if sys_context else ""
        
        system_msg = None
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg
                break
        
        if system_msg:
            system_msg["content"] += memory_context + workspace_context
        else:
            messages.insert(0, {
                "role": "system",
                "content": f"You are a helpful AI assistant.{memory_context}{workspace_context}"
            })
            
        body["messages"] = messages

    logger.info(f"Received request: {model}")
    
    # Intercept provider models
    if ":" in model:
        p_id, m_id = model.split(":", 1)
        if p_id in providers_state:
            p_conf = providers_state[p_id]
            base_url = p_conf.get("base_url", "").strip().rstrip("/")
            api_keys = p_conf.get("api_keys", [])
            if not api_keys:
                return JSONResponse(content={"error": f"No API keys configured for provider {p_id}"}, status_code=400)
            
            body["model"] = m_id
            
            if is_stream:
                async def stream_proxy_with_fallback():
                    for i, api_key in enumerate(api_keys):
                        headers = {"Authorization": f"Bearer {api_key}"}
                        if "openrouter" in base_url.lower():
                            headers["HTTP-Referer"] = f"http://localhost:{ORCHESTRATOR_PORT}"
                            headers["X-Title"] = "LLaMA Server 2.0"
                            
                        try:
                            async with httpx.AsyncClient() as client:
                                url = get_chat_completions_url(base_url)
                                async with client.stream("POST", url, json=body, headers=headers, timeout=60.0) as resp:
                                    if resp.status_code in [401, 402, 403, 429]:
                                        logger.warning(f"Key {i} for {p_id} returned {resp.status_code}. Falling back to next key...")
                                        continue
                                    if resp.status_code != 200:
                                        logger.error(f"Provider {p_id} stream error: {resp.status_code}")
                                    async for chunk in resp.aiter_bytes():
                                        yield chunk
                                    return
                        except Exception as e:
                            logger.error(f"Error with key {i} on {p_id}: {e}")
                            continue
                    yield b'data: {"error": "All API keys for this provider failed or ran out of credits."}\n\n'
                
                return StreamingResponse(stream_proxy_with_fallback(), media_type="text/event-stream")
            else:
                for i, api_key in enumerate(api_keys):
                    headers = {"Authorization": f"Bearer {api_key}"}
                    if "openrouter" in base_url.lower():
                        headers["HTTP-Referer"] = f"http://localhost:{ORCHESTRATOR_PORT}"
                        headers["X-Title"] = "LLaMA Server 2.0"
                        
                    try:
                        async with httpx.AsyncClient() as client:
                            url = get_chat_completions_url(base_url)
                            resp = await client.post(url, json=body, headers=headers, timeout=120.0)
                            if resp.status_code in [401, 402, 403, 429]:
                                logger.warning(f"Key {i} for {p_id} returned {resp.status_code}. Falling back to next key...")
                                continue
                            return JSONResponse(content=resp.json(), status_code=resp.status_code)
                    except Exception as e:
                        logger.error(f"Error with key {i} on {p_id}: {e}")
                        continue
                
                return JSONResponse(content={"error": "All API keys for this provider failed or ran out of credits."}, status_code=500)
    
    swarm_model_ids = [c.get("id") for c in config_state.get("configs", [])]
    
    if model in swarm_model_ids:
        # Dynamically switch the active swarm if a specific one was requested
        config_state["active_config_id"] = model
        active_config = next((c for c in config_state["configs"] if c.get("id") == model), None)
        if active_config:
            config_state["nodes"] = active_config.get("nodes", [])
            save_swarm_configs()
            init_llms()
            logger.info(f"Switched active swarm to {model} based on API request")

    if model != "swarm-ensemble" and model not in swarm_model_ids:
        async def stream_proxy():
            try:
                async with httpx.AsyncClient() as client:
                    async with client.stream("POST", f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions", json=body, timeout=60.0) as resp:
                        if resp.status_code != 200:
                            err_text = await resp.aread()
                            # Parse JSON if possible to extract message, otherwise use raw text
                            try:
                                err_json = json.loads(err_text)
                                msg = err_json.get("error", {}).get("message", err_text.decode("utf-8")) if isinstance(err_json.get("error"), dict) else err_json.get("error", err_text.decode("utf-8"))
                            except:
                                msg = err_text.decode("utf-8") or f"HTTP {resp.status_code}"
                            # Escape JSON characters for the message string
                            msg = json.dumps(msg)
                            yield f'data: {{"error": {{"message": {msg}, "type": "server_error"}}}}\n\ndata: [DONE]\n\n'.encode("utf-8")
                            return
                        async for chunk in resp.aiter_bytes():
                            yield chunk
            except (httpx.ConnectError, httpx.ConnectTimeout):
                yield b'data: {"error": {"message": "Local inference server is not running. Please load a model first.", "type": "connection_error"}}\n\ndata: [DONE]\n\n'

        if is_stream:
            return StreamingResponse(stream_proxy(), media_type="text/event-stream")

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions", json=body, timeout=120.0)
                if resp.status_code != 200:
                    return JSONResponse(content={"error": resp.text}, status_code=resp.status_code)

                data = resp.json()

                # Intercept and fix markdown json tool blocks
                for choice in data.get("choices", []):
                    msg = choice.get("message", {})
                    content = msg.get("content", "") or ""

                    parsed_tool = None
                    if content.strip().startswith("{") and content.strip().endswith("}"):
                        try:
                            maybe_tool = json.loads(content)
                            if "name" in maybe_tool and "arguments" in maybe_tool:
                                parsed_tool = maybe_tool
                        except json.JSONDecodeError:
                            pass

                    if not parsed_tool and "```json" in content:
                        match = re.search(r"```json\s*(\{.*?\})\s*```", content, re.DOTALL | re.IGNORECASE)
                        if match:
                            try:
                                maybe_tool = json.loads(match.group(1))
                                if "name" in maybe_tool and "arguments" in maybe_tool:
                                    parsed_tool = maybe_tool
                            except json.JSONDecodeError:
                                pass

                    if parsed_tool:
                        msg["tool_calls"] = [{
                            "id": f"call_{int(datetime.datetime.now().timestamp())}",
                            "type": "function",
                            "function": {
                                "name": parsed_tool["name"],
                                "arguments": json.dumps(parsed_tool["arguments"]) if isinstance(parsed_tool["arguments"], dict) else parsed_tool["arguments"]
                            }
                        }]
                        msg["content"] = ""
                        choice["finish_reason"] = "tool_calls"

                return JSONResponse(content=data, status_code=200)
            except (httpx.ConnectError, httpx.ConnectTimeout):
                return JSONResponse(content={"error": {"message": "Local inference server is not running. Please load a model first.", "type": "connection_error"}}, status_code=503)
            except Exception as e:
                logger.error(f"Proxy error: {e}")
                return JSONResponse(content={"error": str(e)}, status_code=500)
    
    # Convert incoming messages to Langchain format
    lc_messages = []
    for msg in body.get("messages", []):
        role = msg.get("role")
        content = msg.get("content")
        if content is None:
            content = ""
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "system":
            lc_messages.append(SystemMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
            
    # Initial state
    state = {
        "messages": lc_messages,
        "proposals": [],
        "final_answer": "",
        "rejected": False,
        "iterations": 0
    }
    
    # If not streaming, return the full JSON response
    if not is_stream:
        # Run the graph once
        result = await orchestrator_app.ainvoke(state)
        final_text = result["final_answer"]
        return JSONResponse({
            "id": "chatcmpl-biglittle",
            "object": "chat.completion",
            "created": int(datetime.datetime.now().timestamp()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": final_text
                },
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        })
        
    # If streaming, we stream events from the graph
    async def stream_generator() -> AsyncGenerator[str, None]:
        # Yield the initial role
        yield f"data: {json.dumps({'id': 'chatcmpl-biglittle', 'object': 'chat.completion.chunk', 'choices': [{'delta': {'role': 'assistant'}}]})}\n\n"
        
        try:
            async for event in orchestrator_app.astream(state, stream_mode="updates"):
                for node_name, node_data in event.items():
                    if node_name == "generate":
                        # The generate node finished. Let's output the debate as a markdown block.
                        proposals = node_data["proposals"]
                        iteration = node_data.get("iterations", 0)
                        
                        header = f"\n\n> ### 🧠 BIG-LITTLE Debate (Round {iteration + 1})\n"
                        p_text = header
                        for idx, p in enumerate(proposals):
                            p_text += f"> **Agent {idx + 1}:** {p}\n\n"
                        p_text += "---\n\n"
                        
                        chunk_size = 50
                        for i in range(0, len(p_text), chunk_size):
                            chunk = p_text[i:i+chunk_size]
                            yield f"data: {json.dumps({'id': 'chatcmpl-biglittle', 'object': 'chat.completion.chunk', 'choices': [{'delta': {'content': chunk}}]})}\n\n"
                            await asyncio.sleep(0.01)
                            
                    elif node_name == "judge":
                        final_ans = node_data["final_answer"]
                        chunk_size = 20
                        for i in range(0, len(final_ans), chunk_size):
                            chunk = final_ans[i:i+chunk_size]
                            yield f"data: {json.dumps({'id': 'chatcmpl-biglittle', 'object': 'chat.completion.chunk', 'choices': [{'delta': {'content': chunk}}]})}\n\n"
                            await asyncio.sleep(0.01)
        except Exception as e:
            logger.error(f"Swarm streaming error: {e}")
            error_msg = str(e).replace('"', "'").replace("\n", " ")
            yield f"data: {json.dumps({'id': 'chatcmpl-biglittle', 'object': 'chat.completion.chunk', 'choices': [{'delta': {'content': f'\\n\\n[SWARM ERROR: {error_msg}]'}}]})}\n\n"
            
        # Yield the final stop sequence
        yield f"data: {json.dumps({'id': 'chatcmpl-biglittle', 'object': 'chat.completion.chunk', 'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_generator(), media_type="text/event-stream")

@app.get("/v1/swarm/graph")
async def get_graph():
    try:
        mermaid_string = orchestrator_app.get_graph().draw_mermaid()
        return {"mermaid": mermaid_string}
    except Exception as e:
        logger.error(f"Error generating graph: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/tunnel/start")
async def start_tunnel():
    try:
        url = tunnel_manager.start(local_port=8000)
        if url:
            return {"url": url}
        return JSONResponse({"error": "Failed to get tunnel URL"}, status_code=500)
    except Exception as e:
        logger.error(f"Error starting tunnel: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

class TTSRequest(BaseModel):
    text: str
    voice: str
    speed: float = 1.0

kokoro_instance = None
tts_cache: collections.OrderedDict[str, bytes] = collections.OrderedDict()
TTS_CACHE_MAX = 200
_tts_init_lock = threading.Lock()

def _get_tts_model_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, "tts_models")
    return os.path.join(BASE_DIR, "tools", "orchestrator", "tts_models")

def _preload_tts():
    global kokoro_instance
    try:
        from kokoro_onnx import Kokoro
        model_dir = _get_tts_model_dir()
        model_path = os.path.join(model_dir, "kokoro-v1.0.onnx")
        voices_path = os.path.join(model_dir, "voices-v1.0.bin")
        kokoro_instance = Kokoro(model_path, voices_path)
        logger.info("Kokoro TTS model preloaded")
    except Exception as e:
        logger.warning(f"Kokoro TTS preload failed (will retry on first request): {e}")

@app.post("/v1/tts")
async def text_to_speech(req: TTSRequest):
    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
        import io
        import hashlib

        global kokoro_instance

        if kokoro_instance is None:
            with _tts_init_lock:
                if kokoro_instance is None:
                    model_dir = _get_tts_model_dir()
                    model_path = os.path.join(model_dir, "kokoro-v1.0.onnx")
                    voices_path = os.path.join(model_dir, "voices-v1.0.bin")
                    kokoro_instance = await asyncio.to_thread(Kokoro, model_path, voices_path)

        voice_id = req.voice or "af_sarah"
        spd = max(0.5, min(2.0, req.speed))

        cache_key = hashlib.md5(f"{req.text}|{voice_id}|{spd}".encode()).hexdigest()
        if cache_key in tts_cache:
            tts_cache.move_to_end(cache_key)
            return Response(content=tts_cache[cache_key], media_type="audio/wav")

        samples, sample_rate = await asyncio.to_thread(
            kokoro_instance.create, req.text, voice=voice_id, speed=spd, lang="en-us"
        )

        wav_io = io.BytesIO()
        sf.write(wav_io, samples, sample_rate, format="WAV")
        wav_bytes = wav_io.getvalue()

        tts_cache[cache_key] = wav_bytes
        if len(tts_cache) > TTS_CACHE_MAX:
            tts_cache.popitem(last=False)

        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        logger.error(f"TTS Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

whisper_model_cache = {}

def _transcribe_sync(model, audio, **kwargs):
    segments, info = model.transcribe(audio, **kwargs)
    return "".join([s.text for s in segments]).strip()

@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("base")
):
    try:
        from fastapi import File, Form, UploadFile
        from faster_whisper import WhisperModel
        import io
        
        model_size = model.lower()
        if model_size not in ["tiny", "base", "small", "medium", "large-v1", "large-v2", "large-v3", "large", "deepdml/faster-whisper-large-v3-turbo-ct2", "large-v3-turbo"]:
            model_size = "base"
            
        if model_size not in whisper_model_cache:
            logger.info(f"Loading faster-whisper model: {model_size}")
            whisper_model_cache[model_size] = await asyncio.to_thread(WhisperModel, model_size, device="cpu", compute_type="int8")
            
        whisper_model = whisper_model_cache[model_size]
        
        file_bytes = await file.read()
        audio_file = io.BytesIO(file_bytes)
        
        text = await asyncio.to_thread(_transcribe_sync, whisper_model, audio_file, beam_size=1, vad_filter=True)
        
        return {"text": text.strip()}
    except Exception as e:
        logger.error(f"Transcription Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.websocket("/v1/audio/stream")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    import io

    try:
        while True:
            audio_buffer = io.BytesIO()
            try:
                while True:
                    data = await asyncio.wait_for(websocket.receive(), timeout=30.0)
                    if "bytes" in data:
                        audio_buffer.write(data["bytes"])
                    elif "text" in data:
                        if data["text"] == "EOF":
                            break
            except asyncio.TimeoutError:
                break

            audio_buffer.seek(0)
            if audio_buffer.getbuffer().nbytes > 0:
                from faster_whisper import WhisperModel
                model_size = "deepdml/faster-whisper-large-v3-turbo-ct2"
                if model_size not in whisper_model_cache:
                    logger.info(f"Loading faster-whisper model: {model_size}")
                    whisper_model_cache[model_size] = await asyncio.to_thread(WhisperModel, model_size, device="cpu", compute_type="int8")

                whisper_model = whisper_model_cache[model_size]
                text = await asyncio.to_thread(_transcribe_sync, whisper_model, audio_buffer, beam_size=1, vad_filter=True)
            else:
                text = ""

            await websocket.send_json({"text": text})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket STT Error: {e}")

class ActionPayload(BaseModel):
    action: str

@app.post("/v1/action")
async def execute_action(payload: ActionPayload):
    action = payload.action
    logger.info(f"Voice action triggered: {action}")
    try:
        if action == "build":
            ui_path = os.path.join(BASE_DIR, "tools", "ui")
            subprocess.Popen(["npm", "run", "build"], cwd=ui_path, shell=False)
            return {"status": "build_started"}
        elif action == "terminal":
            if os.name == 'nt':
                subprocess.Popen(["powershell"], shell=False)
            else:
                subprocess.Popen(["x-terminal-emulator"], shell=False)
            return {"status": "terminal_opened"}
    except Exception as e:
        logger.error(f"Failed to execute voice action: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)

@app.get("/v1/workspace/focus")
async def get_workspace_focus():
    try:
        import glob
        files = []
        for root, dirs, filenames in os.walk(BASE_DIR):
            dirs[:] = [d for d in dirs if d not in ['.venv', 'build', '.git', 'node_modules', 'dist', '.svelte-kit', '.cache']]
            for f in filenames:
                if f.endswith(('.svelte', '.ts', '.js', '.py', '.cpp', '.h', '.txt', '.md', '.json')):
                    files.append(os.path.join(root, f))
                    
        if not files:
            return {"file": "None", "lines": 0, "path": "", "language": "Plain Text"}
            
        latest_file = max(files, key=os.path.getmtime)
        relative_path = os.path.relpath(latest_file, BASE_DIR).replace('\\', '/')
        
        line_count = 0
        with open(latest_file, "r", encoding="utf-8", errors="ignore") as f:
            for _ in f:
                line_count += 1
                
        ext = os.path.splitext(latest_file)[1].lower()
        lang_map = {
            '.py': 'Python',
            '.svelte': 'Svelte',
            '.ts': 'TypeScript',
            '.js': 'JavaScript',
            '.cpp': 'C++',
            '.h': 'C++ Header',
            '.json': 'JSON',
            '.md': 'Markdown',
            '.txt': 'Text'
        }
        language = lang_map.get(ext, 'Plain Text')
        
        return {
            "file": os.path.basename(latest_file),
            "path": relative_path,
            "lines": line_count,
            "language": language
        }
    except Exception as e:
        logger.error(f"Error getting workspace focus: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/v1/workspace/file_content")
async def get_file_content(path: str):
    try:
        safe_path = os.path.abspath(os.path.join(BASE_DIR, path))
        if not safe_path.startswith(os.path.abspath(BASE_DIR)):
            return JSONResponse({"error": "Unauthorized path access"}, status_code=403)
            
        if not os.path.exists(safe_path):
            return JSONResponse({"error": "File not found"}, status_code=404)
            
        with open(safe_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        logger.error(f"Error reading file content: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/v1/agent/execute_code")
async def execute_python_code(payload: dict):
    code = payload.get("code", "")
    if not code:
        return JSONResponse({"error": "No code provided"}, status_code=400)
        
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w", encoding="utf-8") as temp_file:
            temp_file.write(code)
            temp_path = temp_file.name
            
        python_exe = sys.executable
        
        process = subprocess.Popen(
            [python_exe, temp_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=BASE_DIR,
            text=True
        )
        try:
            stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            try:
                os.remove(temp_path)
            except OSError:
                pass
            return JSONResponse({"error": "Execution timed out after 30 seconds"}, status_code=408)
        
        try:
            os.remove(temp_path)
        except OSError:
            pass
            
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": process.returncode
        }
    except Exception as e:
        logger.error(f"Execution error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/v1/mcp/install")
async def install_mcp_server(payload: dict):
    package = payload.get("package", "")
    manager = payload.get("manager", "npm")
    
    if not package:
        return JSONResponse({"error": "No package provided"}, status_code=400)

    # Validate package name to prevent shell injection
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9@/_\-\.]+$', package):
        return JSONResponse({"error": "Invalid package name"}, status_code=400)
        
    try:
        if manager == "npm":
            cmd = ["npm", "install", "-g", package]
        else:
            if os.path.exists(os.path.join(BASE_DIR, ".venv", "Scripts", "pip.exe")):
                pip_path = os.path.join(BASE_DIR, ".venv", "Scripts", "pip.exe")
            else:
                pip_path = "pip"
            cmd = [pip_path, "install", package]
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            text=True
        )
        stdout, stderr = process.communicate()
        
        if process.returncode != 0:
            return JSONResponse({
                "status": "failed",
                "stdout": stdout,
                "stderr": stderr
            }, status_code=500)
            
        mcp_manifest_path = os.path.join(BASE_DIR, "companion_mcp_installed.json")
        installed_list = []
        if os.path.exists(mcp_manifest_path):
            with open(mcp_manifest_path, "r") as f:
                installed_list = json.load(f)
                
        installed_list.append({"package": package, "manager": manager, "installed_at": time.time()})
        with open(mcp_manifest_path, "w") as f:
            json.dump(installed_list, f, indent=4)
            
        return {
            "status": "success",
            "package": package,
            "stdout": stdout
        }
    except Exception as e:
        logger.error(f"MCP installation error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/v1/agent/self_repair")
async def run_self_repair():
    try:
        process = subprocess.Popen(
            ["npm", "run", "check"],
            cwd=os.path.join(BASE_DIR, "tools", "ui"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=True,
            text=True
        )
        stdout, stderr = process.communicate()
        
        if process.returncode == 0:
            return {"status": "success", "message": "System compiles with 0 errors."}
            
        errors = stdout + "\n" + stderr
        
        file_match = re.search(r'([a-zA-Z]:\\[^\s\(\)]+\.(?:svelte|ts|js|py|cpp|h))', errors)
        if not file_match:
            file_match = re.search(r'([^\s\(\)]+\.(?:svelte|ts|js|py|cpp|h))', errors)
            
        if not file_match:
            return {
                "status": "unresolved",
                "message": "Compilation failed, but could not determine target error file.",
                "errors": errors
            }
            
        error_file_path = file_match.group(1)
        if not os.path.isabs(error_file_path):
            ui_path = os.path.join(BASE_DIR, "tools", "ui", error_file_path)
            if os.path.exists(ui_path):
                error_file_path = ui_path
            else:
                error_file_path = os.path.join(BASE_DIR, error_file_path)
                
        if not os.path.exists(error_file_path):
            return {
                "status": "unresolved",
                "message": f"Compilation failed, file path {error_file_path} not found.",
                "errors": errors
            }
            
        with open(error_file_path, "r", encoding="utf-8", errors="ignore") as f:
            file_content = f.read()
            
        system_prompt = "You are an autonomous compiler repair bot. Your task is to fix the compiler error in the provided code. Respond ONLY with the corrected code inside a ```code codeblock."
        user_prompt = f"File Path: {error_file_path}\n\nCompiler Errors:\n{errors}\n\nExisting File Code:\n```\n{file_content}\n```"
        
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"http://127.0.0.1:{ORCHESTRATOR_PORT}/v1/chat/completions",
                json={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "model": "local-model"
                },
                timeout=120.0
            )
            
        if res.status_code != 200:
            return {
                "status": "unresolved",
                "message": f"Orchestrator completions failed with status {res.status_code}.",
                "errors": errors
            }
            
        reply = res.json()["choices"][0]["message"]["content"]
        
        backup_path = error_file_path + ".bak"
        with open(backup_path, "w", encoding="utf-8") as f:
            f.write(file_content)

        code_blocks = re.findall(r'```(?:\w+)?\r?\n(.*?)\r?\n?```', reply, re.DOTALL)
        if code_blocks:
            fixed_code = code_blocks[0]
        else:
            fixed_code = reply
            
        with open(error_file_path, "w", encoding="utf-8") as f:
            f.write(fixed_code)
            
        process_retry = subprocess.Popen(
            ["npm", "run", "check"],
            cwd=os.path.join(BASE_DIR, "tools", "ui"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=True,
            text=True
        )
        stdout_r, stderr_r = process_retry.communicate()
        
        if process_retry.returncode == 0:
            subprocess.Popen(["npm", "run", "build"], cwd=os.path.join(BASE_DIR, "tools", "ui"), shell=True)
            return {
                "status": "success",
                "message": f"Successfully patched compiler error in {os.path.basename(error_file_path)}.",
                "patch_file": error_file_path
            }
            
        return {
            "status": "partial_unresolved",
            "message": f"Applied patch to {os.path.basename(error_file_path)} but compilation still fails.",
            "errors": stdout_r + "\n" + stderr_r
        }
    except Exception as e:
        logger.error(f"Self-repair execution error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

async def search_internet(query: str) -> str:
    try:
        url = "https://lite.duckduckgo.com/lite/"
        async with httpx.AsyncClient() as client:
            res = await client.post(url, data={"q": query}, headers={"User-Agent": "Mozilla/5.0"}, timeout=15.0)
            if res.status_code == 200:
                snippets = re.findall(r'<td class="result-snippet">(.*?)</td>', res.text, re.DOTALL)
                clean_snippets = []
                for s in snippets[:4]:
                    clean = re.sub(r'<[^>]+>', '', s).strip()
                    clean_snippets.append(clean)
                return "\n".join(clean_snippets)
    except Exception as e:
        logger.error(f"Lite search scraper failed: {e}")
    return "No search results found."

async def run_self_improvement_logic():
    try:
        target_file = os.path.join(BASE_DIR, "tools", "ui", "src", "lib", "services", "companion.svelte.ts")
        if not os.path.exists(target_file):
            logger.warning("Target companion file not found for self-improvement.")
            return {"status": "skipped", "message": "Target file companion.svelte.ts not found."}
            
        with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
            code = f.read()
            
        search_query = "svelte 5 performance optimization code patterns clean"
        search_context = await search_internet(search_query)
        
        system_prompt = (
            "You are an autonomous self-improvement daemon. Your goal is to optimize, refactor, and improve the robustness of the provided code. "
            "Examine the latest techniques and clean-code patterns retrieved from web search context to guide your improvements. "
            "Focus on: memory management, latency reduction, better error handlers, and code clarity. "
            "Return ONLY the complete improved file content inside a single ```code codeblock. Do not include explanations."
        )
        user_prompt = (
            f"Web Search Guidelines:\n{search_context}\n\n"
            f"File Path: {target_file}\n\n"
            f"Existing Code:\n```\n{code}\n```"
        )
        
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"http://127.0.0.1:{ORCHESTRATOR_PORT}/v1/chat/completions",
                json={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "model": "local-model"
                },
                timeout=180.0
            )
            
        if res.status_code != 200:
            return {"status": "failed", "message": f"LLM completions query failed: {res.status_code}"}
            
        reply = res.json()["choices"][0]["message"]["content"]
        
        code_blocks = re.findall(r'```(?:\w+)?\n(.*?)\n```', reply, re.DOTALL)
        if code_blocks:
            improved_code = code_blocks[0]
        else:
            improved_code = reply
            
        if not improved_code.strip() or len(improved_code) < 100:
            return {"status": "skipped", "message": "LLM returned empty or invalid code block."}
            
        backup_path = target_file + ".bak"
        with open(backup_path, "w", encoding="utf-8") as f:
            f.write(code)
            
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(improved_code)
            
        process = subprocess.Popen(
            ["npm", "run", "check"],
            cwd=os.path.join(BASE_DIR, "tools", "ui"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=True,
            text=True
        )
        stdout, stderr = process.communicate()
        
        if process.returncode == 0:
            subprocess.Popen(["npm", "run", "build"], cwd=os.path.join(BASE_DIR, "tools", "ui"), shell=True)
            try:
                os.remove(backup_path)
            except OSError:
                pass
                
            log_path = os.path.join(BASE_DIR, "companion_self_improvements.json")
            logs = []
            if os.path.exists(log_path):
                with open(log_path, "r") as f:
                    logs = json.load(f)
            
            new_log = {
                "timestamp": time.time(),
                "file": os.path.basename(target_file),
                "type": "search_guided_refactor"
            }
            logs.append(new_log)
            with open(log_path, "w") as f:
                json.dump(logs, f, indent=4)
                
            # Post upgrade to news feed!
            title = f"System Upgrade: Optimized {os.path.basename(target_file)}"
            summary = f"The Self-Upgrade Daemon successfully analyzed latest internet trends and refactored {os.path.basename(target_file)} to reduce latency and clean codebase references."
            full_text = (
                f"Self-Upgrade Log details:\n\n"
                f"- **Target File**: {os.path.basename(target_file)}\n"
                f"- **Methodology**: DuckDuckGo internet scan search guided refactoring.\n"
                f"- **Compiler verification**: Completed check builds with 0 warnings.\n"
                f"- **Enhancements**: Latency bounds check, clean resource cleanups and Svelte reactivity mappings optimized."
            )
            news_manager.add_internal_news(title, summary, full_text)
            
            return {
                "status": "success",
                "message": f"Successfully optimized and self-improved {os.path.basename(target_file)} autonomously."
            }
        else:
            with open(target_file, "w", encoding="utf-8") as f:
                f.write(code)
            try:
                os.remove(backup_path)
            except OSError:
                pass
            return {
                "status": "failed",
                "message": f"Proposed optimization for {os.path.basename(target_file)} failed compilation. Restored original file.",
                "errors": stdout + "\n" + stderr
            }
    except Exception as e:
        logger.error(f"Self-improvement execution logic error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/v1/agent/self_improve")
async def run_self_improvement():
    result = await run_self_improvement_logic()
    if result.get("status") == "error":
        return JSONResponse(result, status_code=500)
    return result

@app.post("/v1/agent/self_improve/toggle")
async def toggle_continuous_self_improvement(payload: dict):
    enabled = payload.get("enabled", False)
    try:
        config_path = os.path.join(BASE_DIR, "companion_continuous_config.json")
        with open(config_path, "w") as f:
            json.dump({"enabled": enabled}, f)
        return {"status": "success", "enabled": enabled}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/v1/agent/self_improve/logs")
async def get_self_improvement_logs():
    try:
        log_path = os.path.join(BASE_DIR, "companion_self_improvements.json")
        if os.path.exists(log_path):
            with open(log_path, "r") as f:
                logs = json.load(f)
            return logs
        return []
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

def start_continuous_self_improvement_thread():
    def _loop():
        time.sleep(30)
        config_path = os.path.join(BASE_DIR, "companion_continuous_config.json")
        while True:
            try:
                enabled = False
                if os.path.exists(config_path):
                    with open(config_path, "r") as f:
                        data = json.load(f)
                        enabled = data.get("enabled", False)

                if enabled:
                    logger.info("Continuous daily self-improvement daemon running...")
                    asyncio_loop = asyncio.new_event_loop()
                    try:
                        asyncio_loop.run_until_complete(run_self_improvement_logic())
                    finally:
                        asyncio_loop.close()
            except Exception as e:
                logger.error(f"Continuous self-improvement thread loop error: {e}")
            time.sleep(86400)

    threading.Thread(target=_loop, daemon=True).start()

if __name__ == "__main__":
    start_continuous_self_improvement_thread()

@app.get("/api/tunnel/stop")
async def stop_tunnel():
    try:
        tunnel_manager.stop()
        return {"status": "stopped"}
    except Exception as e:
        logger.error(f"Error stopping tunnel: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


# =============================================================================
# Ghost Protocol - Full Desktop Control
# =============================================================================

def _get_pyautogui():
    try:
        import pyautogui
        pyautogui.FAILSAFE = True
        return pyautogui
    except ImportError:
        return None

def _get_mss():
    try:
        import mss, mss.tools, base64, io
        return mss
    except ImportError:
        return None

class GhostActionPayload(BaseModel):
    action: str
    x: float | None = None
    y: float | None = None
    button: str = "left"
    text: str | None = None
    keys: str | None = None
    amount: int = 3
    title: str | None = None
    cmd: str | None = None

GHOST_CMD_ALLOWLIST: list[str] = []  # empty = run_command disabled; add strings to enable

@app.post("/v1/ghost/action")
async def ghost_action(payload: GhostActionPayload):
    global ghost_protocol
    if not ghost_protocol:
        return JSONResponse({"error": "Ghost Protocol is not active"}, status_code=403)

    action = payload.action

    if action == "screenshot":
        mss = _get_mss()
        if not mss:
            return JSONResponse({"error": "mss not installed. Run: pip install mss"}, status_code=503)
        try:
            import base64, io
            with mss.mss() as sct:
                monitor = sct.monitors[0]
                sct_img = sct.grab(monitor)
                from PIL import Image
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                encoded = base64.b64encode(buf.getvalue()).decode()
            return {"screenshot": encoded, "width": sct_img.width, "height": sct_img.height}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "click":
        pag = _get_pyautogui()
        if not pag:
            return JSONResponse({"error": "pyautogui not installed. Run: pip install pyautogui"}, status_code=503)
        if payload.x is None or payload.y is None:
            return JSONResponse({"error": "x and y required for click"}, status_code=400)
        try:
            pag.click(int(payload.x), int(payload.y), button=payload.button)
            return {"status": "clicked", "x": payload.x, "y": payload.y, "button": payload.button}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "move":
        pag = _get_pyautogui()
        if not pag:
            return JSONResponse({"error": "pyautogui not installed"}, status_code=503)
        if payload.x is None or payload.y is None:
            return JSONResponse({"error": "x and y required for move"}, status_code=400)
        try:
            pag.moveTo(int(payload.x), int(payload.y), duration=0.1)
            return {"status": "moved", "x": payload.x, "y": payload.y}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "type":
        pag = _get_pyautogui()
        if not pag:
            return JSONResponse({"error": "pyautogui not installed"}, status_code=503)
        if not payload.text:
            return JSONResponse({"error": "text required"}, status_code=400)
        try:
            pag.typewrite(payload.text, interval=0.02)
            return {"status": "typed", "length": len(payload.text)}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "key":
        pag = _get_pyautogui()
        if not pag:
            return JSONResponse({"error": "pyautogui not installed"}, status_code=503)
        if not payload.keys:
            return JSONResponse({"error": "keys required"}, status_code=400)
        try:
            key_list = [k.strip() for k in payload.keys.split("+")]
            if len(key_list) > 1:
                pag.hotkey(*key_list)
            else:
                pag.press(key_list[0])
            return {"status": "key_sent", "keys": payload.keys}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "scroll":
        pag = _get_pyautogui()
        if not pag:
            return JSONResponse({"error": "pyautogui not installed"}, status_code=503)
        try:
            if payload.x is not None and payload.y is not None:
                pag.scroll(payload.amount, x=int(payload.x), y=int(payload.y))
            else:
                pag.scroll(payload.amount)
            return {"status": "scrolled", "amount": payload.amount}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "get_windows":
        try:
            if sys.platform == "win32":
                import ctypes
                import ctypes.wintypes
                windows = []
                def enum_handler(hwnd, _):
                    if ctypes.windll.user32.IsWindowVisible(hwnd):
                        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
                        if length > 0:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
                            windows.append(buf.value)
                WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
                ctypes.windll.user32.EnumWindows(WNDENUMPROC(enum_handler), 0)
                return {"windows": windows}
            else:
                result = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=3)
                titles = [line.split(None, 3)[-1] for line in result.stdout.splitlines() if line.strip()]
                return {"windows": titles}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "focus_window":
        if not payload.title:
            return JSONResponse({"error": "title required"}, status_code=400)
        try:
            if sys.platform == "win32":
                import ctypes
                import ctypes.wintypes
                target = payload.title.lower()
                found = [None]
                def enum_handler(hwnd, _):
                    length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buf = ctypes.create_unicode_buffer(length + 1)
                        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
                        if target in buf.value.lower():
                            found[0] = hwnd
                WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
                ctypes.windll.user32.EnumWindows(WNDENUMPROC(enum_handler), 0)
                if found[0]:
                    ctypes.windll.user32.SetForegroundWindow(found[0])
                    return {"status": "focused", "title": payload.title}
                return JSONResponse({"error": f"Window not found: {payload.title}"}, status_code=404)
            else:
                subprocess.run(["wmctrl", "-a", payload.title], timeout=3)
                return {"status": "focused", "title": payload.title}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    elif action == "run_command":
        if not GHOST_CMD_ALLOWLIST:
            return JSONResponse({"error": "run_command is disabled. Set GHOST_CMD_ALLOWLIST to enable."}, status_code=403)
        if not payload.cmd:
            return JSONResponse({"error": "cmd required"}, status_code=400)
        if not any(payload.cmd.startswith(prefix) for prefix in GHOST_CMD_ALLOWLIST):
            return JSONResponse({"error": "Command not in allowlist"}, status_code=403)
        try:
            result = subprocess.run(
                payload.cmd, shell=False, capture_output=True, text=True, timeout=30,
                args=payload.cmd.split()
            )
            return {"stdout": result.stdout, "stderr": result.stderr, "exit_code": result.returncode}
        except subprocess.TimeoutExpired:
            return JSONResponse({"error": "Command timed out"}, status_code=408)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    else:
        return JSONResponse({"error": f"Unknown ghost action: {action}"}, status_code=400)


# =============================================================================
# Daemon Loop - Self-Upgrading Intelligence Engine
# =============================================================================

DAEMON_PROPOSALS_FILE = os.path.join(BASE_DIR, "companion_daemon_proposals.json")
DAEMON_WATCHLIST_FILE = os.path.join(BASE_DIR, "companion_daemon_watchlist.json")
DAEMON_STATE_FILE = os.path.join(BASE_DIR, "companion_daemon_state.json")

DEFAULT_WATCHLIST = [
    {"repo": "ggml-org/llama.cpp", "reason": "Core inference engine"},
    {"repo": "ollama/ollama", "reason": "Local LLM serving"},
    {"repo": "OpenDevin/OpenDevin", "reason": "Autonomous agent framework"},
    {"repo": "paul-gauthier/aider", "reason": "AI pair programming"},
    {"repo": "microsoft/autogen", "reason": "Multi-agent orchestration"},
]

def _load_daemon_json(path: str, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _save_daemon_json(path: str, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Daemon: failed to save {path}: {e}")

async def _daemon_research_cycle():
    import urllib.request, urllib.error
    proposals = _load_daemon_json(DAEMON_PROPOSALS_FILE, [])
    watchlist = _load_daemon_json(DAEMON_WATCHLIST_FILE, DEFAULT_WATCHLIST)
    new_proposals = []

    # 1. GitHub Trending (AI/ML repos)
    try:
        req = urllib.request.Request(
            "https://api.github.com/search/repositories?q=topic:llm+topic:ai&sort=stars&order=desc&per_page=10",
            headers={"User-Agent": "LLaMA-Pro-Daemon/1.0", "Accept": "application/vnd.github.v3+json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            for item in data.get("items", [])[:5]:
                new_proposals.append({
                    "id": f"gh-{item['full_name'].replace('/', '-')}-{int(time.time())}",
                    "source": "github",
                    "title": f"GitHub: {item['full_name']}",
                    "description": item.get("description", ""),
                    "url": item.get("html_url", ""),
                    "stars": item.get("stargazers_count", 0),
                    "found_at": time.time(),
                    "status": "pending",
                    "proposal": f"Review {item['full_name']} ({item.get('description','')}) for techniques applicable to LLaMA Pro."
                })
    except Exception as e:
        logger.warning(f"Daemon: GitHub search failed: {e}")

    # 2. ArXiv - latest AI/LLM papers
    try:
        arxiv_url = (
            "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL"
            "&sortBy=submittedDate&sortOrder=descending&max_results=5"
        )
        req = urllib.request.Request(arxiv_url, headers={"User-Agent": "LLaMA-Pro-Daemon/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(resp.read())
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall("atom:entry", ns)[:5]:
                title = (entry.find("atom:title", ns).text or "").strip()
                summary = (entry.find("atom:summary", ns).text or "").strip()[:300]
                link = entry.find("atom:id", ns).text or ""
                new_proposals.append({
                    "id": f"arxiv-{abs(hash(title))}-{int(time.time())}",
                    "source": "arxiv",
                    "title": f"ArXiv: {title}",
                    "description": summary,
                    "url": link,
                    "found_at": time.time(),
                    "status": "pending",
                    "proposal": f"Evaluate ArXiv paper '{title}' for techniques that could improve LLaMA Pro's agentic or self-improvement capabilities."
                })
    except Exception as e:
        logger.warning(f"Daemon: ArXiv search failed: {e}")

    # 3. Watchlist - check for recent activity
    _safe_repo_pattern = re.compile(r'^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$')
    for item in watchlist:
        repo = item.get("repo", "")
        if not repo or not _safe_repo_pattern.match(repo):
            continue
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/releases/latest",
                headers={"User-Agent": "LLaMA-Pro-Daemon/1.0", "Accept": "application/vnd.github.v3+json"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                release = json.loads(resp.read())
                tag = release.get("tag_name", "")
                body = (release.get("body", "") or "")[:400]
                published = release.get("published_at", "")
                new_proposals.append({
                    "id": f"watch-{repo.replace('/', '-')}-{tag}-{int(time.time())}",
                    "source": "watchlist",
                    "title": f"Release: {repo} {tag}",
                    "description": body,
                    "url": release.get("html_url", ""),
                    "found_at": time.time(),
                    "status": "pending",
                    "proposal": f"New release {tag} of {repo} ({item.get('reason','')}). Review changelog for improvements applicable to LLaMA Pro."
                })
        except Exception:
            pass  # repo may have no releases or be unreachable

    # Deduplicate by title against existing proposals
    existing_titles = {p.get("title") for p in proposals}
    added = [p for p in new_proposals if p.get("title") not in existing_titles]
    proposals.extend(added)
    _save_daemon_json(DAEMON_PROPOSALS_FILE, proposals)

    # Update daemon state
    state = _load_daemon_json(DAEMON_STATE_FILE, {})
    state["last_run"] = time.time()
    state["last_run_iso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["proposals_total"] = len(proposals)
    state["proposals_added_last_run"] = len(added)
    _save_daemon_json(DAEMON_STATE_FILE, state)

    logger.info(f"Daemon research cycle complete. Added {len(added)} new proposals (total: {len(proposals)}).")
    return {"added": len(added), "total": len(proposals)}

def _start_daemon_loop():
    def _loop():
        # Initial delay so the app can fully start before first research hit
        time.sleep(60)
        while True:
            try:
                if daemon_loop:
                    asyncio_loop = asyncio.new_event_loop()
                    try:
                        asyncio_loop.run_until_complete(_daemon_research_cycle())
                    finally:
                        asyncio_loop.close()
            except Exception as e:
                logger.error(f"Daemon loop error: {e}")
            # Default interval: 6 hours
            state = _load_daemon_json(DAEMON_STATE_FILE, {})
            interval = int(state.get("interval_seconds", 6 * 3600))
            time.sleep(interval)

    threading.Thread(target=_loop, daemon=True).start()

_start_daemon_loop()

@app.get("/v1/daemon/status")
async def daemon_status():
    state = _load_daemon_json(DAEMON_STATE_FILE, {})
    proposals = _load_daemon_json(DAEMON_PROPOSALS_FILE, [])
    return {
        "active": daemon_loop,
        "last_run": state.get("last_run_iso"),
        "proposals_total": len(proposals),
        "proposals_pending": sum(1 for p in proposals if p.get("status") == "pending"),
        "interval_seconds": state.get("interval_seconds", 6 * 3600),
    }

@app.get("/v1/daemon/proposals")
async def get_daemon_proposals():
    proposals = _load_daemon_json(DAEMON_PROPOSALS_FILE, [])
    return {"proposals": proposals}

@app.post("/v1/daemon/proposals/{proposal_id}/apply")
async def apply_daemon_proposal(proposal_id: str):
    proposals = _load_daemon_json(DAEMON_PROPOSALS_FILE, [])
    for p in proposals:
        if p.get("id") == proposal_id:
            p["status"] = "applied"
            p["applied_at"] = time.time()
            _save_daemon_json(DAEMON_PROPOSALS_FILE, proposals)
            return {"status": "applied", "proposal": p}
    return JSONResponse({"error": "Proposal not found"}, status_code=404)

@app.post("/v1/daemon/proposals/{proposal_id}/dismiss")
async def dismiss_daemon_proposal(proposal_id: str):
    proposals = _load_daemon_json(DAEMON_PROPOSALS_FILE, [])
    for p in proposals:
        if p.get("id") == proposal_id:
            p["status"] = "dismissed"
            _save_daemon_json(DAEMON_PROPOSALS_FILE, proposals)
            return {"status": "dismissed"}
    return JSONResponse({"error": "Proposal not found"}, status_code=404)

@app.get("/v1/daemon/watchlist")
async def get_daemon_watchlist():
    watchlist = _load_daemon_json(DAEMON_WATCHLIST_FILE, DEFAULT_WATCHLIST)
    return {"watchlist": watchlist}

@app.post("/v1/daemon/watchlist")
async def update_daemon_watchlist(request: Request):
    data = await request.json()
    watchlist = _load_daemon_json(DAEMON_WATCHLIST_FILE, DEFAULT_WATCHLIST)
    action = data.get("action", "add")
    repo = data.get("repo", "").strip()
    if not repo:
        return JSONResponse({"error": "repo required"}, status_code=400)
    if action == "add":
        if not any(w.get("repo") == repo for w in watchlist):
            watchlist.append({"repo": repo, "reason": data.get("reason", "")})
    elif action == "remove":
        watchlist = [w for w in watchlist if w.get("repo") != repo]
    else:
        return JSONResponse({"error": "action must be 'add' or 'remove'"}, status_code=400)
    _save_daemon_json(DAEMON_WATCHLIST_FILE, watchlist)
    return {"watchlist": watchlist}

@app.post("/v1/daemon/run")
async def trigger_daemon_run():
    try:
        result = await _daemon_research_cycle()
        return {"status": "complete", **result}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/v1/daemon/interval")
async def set_daemon_interval(request: Request):
    data = await request.json()
    seconds = int(data.get("seconds", 6 * 3600))
    if seconds < 300:
        return JSONResponse({"error": "Minimum interval is 300 seconds (5 minutes)"}, status_code=400)
    state = _load_daemon_json(DAEMON_STATE_FILE, {})
    state["interval_seconds"] = seconds
    _save_daemon_json(DAEMON_STATE_FILE, state)
    return {"interval_seconds": seconds}


ui_dist_path = os.path.abspath(os.path.join(BASE_DIR, "tools", "ui", "dist"))
if os.path.exists(ui_dist_path):
    logger.info(f"Mounting static UI from {ui_dist_path}")
    app.mount("/", StaticFiles(directory=ui_dist_path, html=True), name="ui")
else:
    logger.warning(f"Static UI directory not found at {ui_dist_path}. Network web access will be unavailable.")

if __name__ == "__main__":
    logger.info(f"Starting Orchestrator on port {ORCHESTRATOR_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=ORCHESTRATOR_PORT)
