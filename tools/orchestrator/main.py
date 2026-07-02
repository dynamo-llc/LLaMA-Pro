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
import threading
from typing import List, AsyncGenerator, Optional, Dict, Any
from typing_extensions import TypedDict
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI App
app = FastAPI()

def get_base_paths():
	if getattr(sys, 'frozen', False):
		exe_dir = os.path.dirname(sys.executable)
		base_dir = os.path.abspath(os.path.join(exe_dir, ".."))
		providers_file = os.path.join(exe_dir, "providers.json")
		swarm_config_file = os.path.join(exe_dir, "swarm_configs.json")
		rpc_path = os.path.join(exe_dir, "rpc-server.exe")
	else:
		script_dir = os.path.dirname(__file__)
		base_dir = os.path.abspath(os.path.join(script_dir, "..", ".."))
		providers_file = os.path.join(script_dir, "providers.json")
		swarm_config_file = os.path.join(script_dir, "swarm_configs.json")
		rpc_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "rpc-server.exe"))
		if not os.path.exists(rpc_path):
			rpc_path = os.path.abspath(os.path.join(script_dir, "..", "..", "build", "bin", "Release", "rpc-server.exe"))
	return base_dir, providers_file, swarm_config_file, rpc_path

BASE_DIR, PROVIDERS_FILE, SWARM_CONFIG_FILE, RPC_PATH = get_base_paths()

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
                "rpc_port": RPC_PORT
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
                rpc_state["peers"][peer_id] = {
                    "ip": addr[0],
                    "hostname": msg.get("hostname", "Unknown"),
                    "rpc_active": msg.get("rpc_active", False),
                    "rpc_port": msg.get("rpc_port", RPC_PORT),
                    "last_seen": time.time()
                }
        except Exception:
            pass

async def cleanup_stale_peers():
    while True:
        now = time.time()
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

mcp_processes = []
is_shutting_down = False
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def monitor_and_restart(cfg):
    global is_shutting_down, mcp_processes
    port = cfg["port"]
    if is_port_in_use(port):
        logger.info(f"Port {port} is already in use. Skipping auto-start for local MCP: {cfg['name']}.")
        return

    cwd = cfg.get("cwd")
    if cwd and not os.path.exists(cwd):
        logger.warning(f"Directory {cwd} does not exist. Skipping {cfg['name']}.")
        return

    while not is_shutting_down:
        try:
            logger.info(f"Auto-starting local MCP server: {cfg['name']} on port {port}...")
            env = os.environ.copy()
            if "env" in cfg:
                env.update(cfg["env"])
            proc = subprocess.Popen(
                cfg["cmd"],
                cwd=cwd,
                stdout=sys.stdout,
                stderr=sys.stderr,
                env=env
            )
            mcp_processes.append(proc)
            proc.wait()
            
            if proc in mcp_processes:
                mcp_processes.remove(proc)
                
            if is_shutting_down:
                break
                
            logger.warning(f"MCP server {cfg['name']} crashed with exit code {proc.returncode}. Restarting in 2 seconds...")
            time.sleep(2)
        except Exception as e:
            logger.error(f"Failed to start local MCP server {cfg['name']}: {e}")
            if is_shutting_down:
                break
            time.sleep(5)

def start_local_mcp_servers():
    base_dir = BASE_DIR
    
    mcp_configs = [
        {
            "name": "DuckDuckGo News", 
            "port": 8004, 
            "cmd": ["node", "index.js"],
            "cwd": os.path.join(base_dir, "tools", "mcp", "duckduckgo-news")
        },
        {
            "name": "Puppeteer Browser", 
            "port": 8006, 
            "cmd": ["node", "index.js"],
            "cwd": os.path.join(base_dir, "tools", "mcp", "puppeteer-browser")
        },
        {
            "name": "Filesystem", 
            "port": 8003, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8003", "--stdio", "npx -y @modelcontextprotocol/server-filesystem C:\\Users\\MONSTER\\Desktop", "--cors"]
        },
        {
            "name": "Fetch Web Page", 
            "port": 8005, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8005", "--stdio", "npx -y mcp-fetch-server", "--cors"]
        },
        {
            "name": "Playwright", 
            "port": 8015, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8015", "--stdio", "npx -y @playwright/mcp", "--cors"]
        },
        {
            "name": "Memory", 
            "port": 8021, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8021", "--stdio", "npx -y @modelcontextprotocol/server-memory", "--cors"]
        },
        {
            "name": "Ghidra (Headless)", 
            "port": 8081, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8081", "--stdio", "C:\\Users\\MONSTER\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe E:\\GHIDRA\\bridge_mcp_ghidra_headless.py", "--cors"]
        },
        {
            "name": "IDA Pro", 
            "port": 8082, 
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8082", "--stdio", "C:\\Users\\MONSTER\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe E:\\PROJECTS\\EZLLM\\server\\bridges\\bridge_mcp_ida.py --ida-server http://127.0.0.1:8081/", "--cors"]
        },
        {
            "name": "SQLite Database",
            "port": 8030,
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8030", "--stdio", "npx -y mcp-server-sqlite --db C:\\Users\\MONSTER\\Desktop\\llama_mcp.db", "--cors"]
        },
        {
            "name": "Chrome DevTools",
            "port": 8019,
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8019", "--stdio", "npx -y chrome-devtools-mcp --autoConnect", "--cors"]
        },
        {
            "name": "PostgreSQL",
            "port": 8023,
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8023", "--stdio", "npx -y @modelcontextprotocol/server-postgres postgresql://postgres:postgres@localhost:5432/postgres", "--cors"]
        },

        {
            "name": "GitHub",
            "port": 8017,
            "cmd": ["npx.cmd", "-y", "supergateway", "--port", "8017", "--stdio", "npx -y @modelcontextprotocol/server-github", "--cors"]
        }
    ]
    
    for cfg in mcp_configs:
        t = threading.Thread(target=monitor_and_restart, args=(cfg,), daemon=True)
        t.start()

def stop_local_mcp_servers():
    global mcp_processes, is_shutting_down
    is_shutting_down = True
    if mcp_processes:
        logger.info("Stopping local MCP servers...")
        for proc in mcp_processes:
            try:
                proc.terminate()
            except Exception:
                pass
        mcp_processes = []

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
                    headers["HTTP-Referer"] = "http://localhost:8000"
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
    rpc_state["pending_requests"].append({
        "id": req_id,
        "ip": client_ip,
        "hostname": req.requester_hostname,
        "timestamp": time.time()
    })
    
    for _ in range(60):
        if not any(r["id"] == req_id for r in rpc_state["pending_requests"]):
            if client_ip in rpc_state["connected_peers"]:
                return {"status": "accepted"}
            else:
                return {"status": "rejected"}
        await asyncio.sleep(1)
        
    rpc_state["pending_requests"] = [r for r in rpc_state["pending_requests"] if r["id"] != req_id]
    return {"status": "rejected", "reason": "timeout"}

@app.get("/api/rpc/pending-requests")
async def get_pending_requests():
    return {"requests": rpc_state["pending_requests"]}

@app.post("/api/rpc/authorize/{req_id}")
async def authorize_request(req_id: str, accept: bool):
    request_obj = next((r for r in rpc_state["pending_requests"] if r["id"] == req_id), None)
    if not request_obj:
        return {"status": "error", "message": "Request not found"}
        
    rpc_state["pending_requests"] = [r for r in rpc_state["pending_requests"] if r["id"] != req_id]
    
    if accept:
        rpc_state["is_sharing_enabled"] = True
        rpc_state["always_share"] = True # might be wanted? Or just accept this one
        start_rpc_server()
        rpc_state["connected_peers"].add(request_obj["ip"])
        return {"status": "success", "action": "accepted"}
    else:
        return {"status": "success", "action": "rejected"}

@app.post("/api/rpc/connect/{peer_id}")
async def connect_to_peer(peer_id: str):
    if peer_id not in rpc_state["peers"]:
        return {"status": "error", "message": "Peer not found"}
        
    peer = rpc_state["peers"][peer_id]
    peer_ip = peer["ip"]
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"http://{peer_ip}:8000/api/rpc/incoming-request", 
                json={"requester_ip": HOSTNAME, "requester_hostname": HOSTNAME},
                timeout=65.0
            )
            if resp.status_code == 200 and resp.json().get("status") == "accepted":
                return {"status": "success", "message": "Connected", "rpc_endpoint": f"{peer_ip}:{peer['rpc_port']}"}
            else:
                return {"status": "rejected", "message": "Peer rejected the request"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(udp_broadcaster())
    asyncio.create_task(udp_listener())
    asyncio.create_task(cleanup_stale_peers())
    # Auto-start local MCP servers
    start_local_mcp_servers()

@app.on_event("shutdown")
async def shutdown_event():
    stop_rpc_server()
    stop_local_mcp_servers()

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
        "url": os.getenv("LITTLE_MODEL_URL", "http://127.0.0.1:8080/v1"),
        "model_name": os.getenv("LITTLE_MODEL_NAME", "little-model"),
        "temperature": 0.8,
        "persona": "You are a creative thinker. Provide an innovative and out-of-the-box perspective.",
        "sourceType": "local"
    },
    {
        "id": "node-2",
        "role": "worker",
        "url": os.getenv("LITTLE_MODEL_URL", "http://127.0.0.1:8080/v1"),
        "model_name": os.getenv("LITTLE_MODEL_NAME", "little-model"),
        "temperature": 0.8,
        "persona": "You are a critical analyst. Focus on facts, logic, and potential pitfalls.",
        "sourceType": "local"
    },
    {
        "id": "node-3",
        "role": "synthesizer",
        "url": os.getenv("BIG_MODEL_URL", "http://192.168.1.100:8080/v1"),
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
                url = "http://127.0.0.1:8000/v1"
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

    url = f"http://127.0.0.1:8080{path}"
    
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
            except:
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
                line = f.readline()
                if line:
                    yield f"data: {line}\n\n"
                else:
                    await asyncio.sleep(0.1)
    
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
            res = await client.get("http://127.0.0.1:8080/metrics")
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
                    headers["HTTP-Referer"] = "http://localhost:8000"
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
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://127.0.0.1:8080/v1/models", timeout=2.0)
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
    url = f"http://127.0.0.1:8080/models/{path}"
    
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
        except:
            pass
            
    if path == "unload" and request.method == "POST":
        try:
            body_json = json.loads(body.decode("utf-8"))
            model_id = body_json.get("model", "")
            if ":" in model_id and model_id in loaded_external_models:
                del loaded_external_models[model_id]
                return JSONResponse({"status": "success", "message": "Model unloaded virtually"})
        except:
            pass

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
            except:
                return Response(content=response.content, status_code=response.status_code)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/v1/swarm/chat/completions")
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "swarm-ensemble")
    is_stream = body.get("stream", False)
    
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
                            headers["HTTP-Referer"] = "http://localhost:8000"
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
                        headers["HTTP-Referer"] = "http://localhost:8000"
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
    
    if model != "swarm-ensemble":
        async def stream_proxy():
            async with httpx.AsyncClient() as client:
                async with client.stream("POST", "http://127.0.0.1:8080/v1/chat/completions", json=body, timeout=60.0) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
                        
        if is_stream:
            return StreamingResponse(stream_proxy(), media_type="text/event-stream")
            
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post("http://127.0.0.1:8080/v1/chat/completions", json=body, timeout=120.0)
                if resp.status_code != 200:
                    return JSONResponse(content={"error": resp.text}, status_code=resp.status_code)
                    
                data = resp.json()
                
                # Intercept and fix markdown json tool blocks
                for choice in data.get("choices", []):
                    msg = choice.get("message", {})
                    content = msg.get("content", "")
                    
                    # Try to parse raw JSON first
                    parsed_tool = None
                    if content.strip().startswith("{") and content.strip().endswith("}"):
                        try:
                            maybe_tool = json.loads(content)
                            if "name" in maybe_tool and "arguments" in maybe_tool:
                                parsed_tool = maybe_tool
                        except json.JSONDecodeError:
                            pass
                            
                    # If not raw JSON, check for ```json block
                    if not parsed_tool and "```json" in content:
                        match = re.search(r"```json\s*(\{.*?\})\s*```", content, re.DOTALL)
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
            except Exception as e:
                logger.error(f"Proxy error: {e}")
                return JSONResponse(content={"error": str(e)}, status_code=500)
    
    # Convert incoming messages to Langchain format
    lc_messages = []
    for msg in body.get("messages", []):
        role = msg.get("role")
        content = msg.get("content")
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
    
    # Run the graph
    result = await orchestrator_app.ainvoke(state)
    final_text = result["final_answer"]
    
    # If not streaming, return the full JSON response
    if not is_stream:
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

if __name__ == "__main__":
    logger.info("Starting Orchestrator on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
