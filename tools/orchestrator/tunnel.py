import os
import subprocess
import threading
import urllib.request
import re
import logging
import time
import platform

logger = logging.getLogger(__name__)

class TunnelManager:
    def __init__(self, base_dir):
        self.base_dir = base_dir
        self.bin_dir = os.path.join(self.base_dir, "bin")
        self.exe_name = "cloudflared.exe" if platform.system() == "Windows" else "cloudflared"
        self.exe_path = os.path.join(self.bin_dir, self.exe_name)
        self.process = None
        self.public_url = None
        self.lock = threading.Lock()
        
    def ensure_binary(self):
        if not os.path.exists(self.bin_dir):
            os.makedirs(self.bin_dir, exist_ok=True)
            
        if not os.path.exists(self.exe_path):
            logger.info(f"Downloading {self.exe_name}...")
            # Detect platform
            if platform.system() == "Windows":
                url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
            elif platform.system() == "Darwin":
                if platform.machine() == "arm64":
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64" # wait, darwin-arm64
                else:
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64"
            else:
                url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
                
            urllib.request.urlretrieve(url, self.exe_path)
            if platform.system() != "Windows":
                os.chmod(self.exe_path, 0o755)
            logger.info("Download complete.")
            
    def start(self, local_port=8000):
        with self.lock:
            if self.process is not None:
                if self.process.poll() is None:
                    return self.public_url # Already running
                else:
                    self.process = None
            
            self.ensure_binary()
            
            # Start cloudflared
            cmd = [self.exe_path, "tunnel", "--url", f"http://localhost:{local_port}"]
            logger.info(f"Starting cloudflared: {' '.join(cmd)}")
            
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
                
            # Cloudflared outputs the URL to stderr
            self.process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs)
            self.public_url = None
            
            # Read stderr in a background thread to find the URL and prevent blocking
            def tail_stderr():
                url_pattern = re.compile(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
                while True:
                    line = self.process.stderr.readline()
                    if not line:
                        break
                    match = url_pattern.search(line)
                    if match and not self.public_url:
                        self.public_url = match.group(0)
                        logger.info(f"Tunnel URL acquired: {self.public_url}")
            
            t = threading.Thread(target=tail_stderr, daemon=True)
            t.start()
            
            # Wait up to 10 seconds for the URL to appear
            for _ in range(100):
                if self.public_url:
                    break
                if self.process.poll() is not None:
                    logger.error(f"Cloudflared exited prematurely with code {self.process.poll()}")
                    err = self.process.stderr.read()
                    logger.error(f"Cloudflared stderr: {err}")
                    break
                time.sleep(0.1)
                
            return self.public_url

    def stop(self):
        with self.lock:
            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                self.process = None
            self.public_url = None
            return True
