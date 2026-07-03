import os
import json
import logging
import asyncio
import time
import requests
from threading import Thread

logger = logging.getLogger(__name__)

CACHE_FILE = os.path.join(os.path.dirname(__file__), "news_cache.json")

class NewsManager:
    def __init__(self):
        self.news_cache = []
        self.last_fetch = 0
        self.fetch_interval = 4 * 3600  # 4 hours
        self.internal_news = [
            {
                "id": "internal-lora",
                "title": "New Feature: Local LoRA Training",
                "summary": "Fine-tune models directly on your consumer hardware without sending data to the cloud.",
                "full_text": "We are excited to announce Local LoRA Training! This feature allows you to fine-tune Large Language Models using Low-Rank Adaptation directly on your own consumer hardware. \n\nNo more expensive cloud instances or privacy concerns. Keep all your proprietary data on your local machine while teaching the model new skills, tones, or specific knowledge domains. The built-in trainer optimizes VRAM usage so you can train even on 8GB and 12GB GPUs.",
                "image_url": "/news/local_lora.png",
                "source": "LLaMA-Pro Official",
                "url": "#/settings",
                "date": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                "is_internal": True
            },
            {
                "id": "internal-compute",
                "title": "Compute Pool Decentralized Networking",
                "summary": "Connect multiple machines together to run models larger than any single GPU could handle.",
                "full_text": "The Compute Pool feature acts as a decentralized peer-to-peer network across your devices. \n\nIf you have an old gaming PC, a MacBook, and a workstation, you can now link them together! The engine will split the model layers across all available machines, allowing you to run massive 70B+ parameters models that would normally require a $20,000 server. The networking is automatically negotiated and highly efficient.",
                "image_url": "/news/compute_pool.png",
                "source": "LLaMA-Pro Official",
                "url": "#/settings",
                "date": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 86400)),
                "is_internal": True
            },
            {
                "id": "internal-agents",
                "title": "Introducing Autonomous Agent Swarms",
                "summary": "Deploy a coordinated assembly of AI agents to solve complex, multi-step workflows automatically.",
                "full_text": "Agent Swarms represent the next generation of autonomous AI workflow. \n\nInstead of prompting a single model back and forth, you can now define a 'Swarm' of specialized agents (e.g., a Coder, a Reviewer, and a Tester). You simply provide the goal, and the swarm will delegate tasks, debate solutions, and iterate on the problem until it's solved. With our integrated MCP tool access, these swarms can read files, search the web, and execute code entirely on their own.",
                "image_url": "/news/agent_swarms.png",
                "source": "LLaMA-Pro Official",
                "url": "#/settings",
                "date": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 172800)),
                "is_internal": True
            }
        ]
        self._load_cache()
        
    def _load_cache(self):
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, 'r') as f:
                    cached_data = json.load(f)
                    # Overwrite internal news to always have the latest internal ones, but keep external
                    external_cached = [item for item in cached_data if not item.get('is_internal')]
                    self.news_cache = self.internal_news + external_cached
                    logger.info("Loaded news from disk cache.")
            except Exception as e:
                logger.error(f"Failed to load news cache: {e}")
                
    def _save_cache(self):
        try:
            with open(CACHE_FILE, 'w') as f:
                json.dump(self.news_cache, f)
        except Exception as e:
            logger.error(f"Failed to save news cache: {e}")

    def start_background_fetch(self):
        def loop():
            while True:
                self.fetch_external_news()
                time.sleep(self.fetch_interval)
                
        t = Thread(target=loop, daemon=True)
        t.start()
        
    def fetch_external_news(self):
        try:
            logger.info("Fetching external news from dev.to API...")
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LLaMA-Pro/1.0"}
            response = requests.get("https://dev.to/api/articles?tag=ai&top=1", headers=headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                external_news = []
                for idx, post in enumerate(data[:15]): # Limit to top 15
                    title = post.get("title", "")
                    description = post.get("description", "")
                    url = post.get("url", "")
                    
                    # Try to get an image, fallback to default patterns
                    image_url = post.get("cover_image") or post.get("social_image")
                    
                    # Some posts might just be links, fallback to external url
                    if not description and not image_url:
                        continue
                        
                    summary = description[:200] + "..." if len(description) > 200 else description
                    if not summary:
                        summary = "Link/Image post."
                        
                    external_news.append({
                        "id": str(post.get("id", idx)),
                        "title": title,
                        "summary": summary,
                        "full_text": f"{title}\n\n{description}\n\nRead more at the original source.",
                        "image_url": image_url,
                        "source": "Dev.to (AI)",
                        "url": url,
                        "date": post.get("published_at", time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
                        "is_internal": False
                    })
                    
                self.news_cache = self.internal_news + external_news
                self.last_fetch = time.time()
                self._save_cache()
                logger.info(f"Successfully fetched {len(external_news)} external news items.")
            else:
                logger.error(f"Failed to fetch news. Status: {response.status_code}")
                if not self.news_cache:
                    self.news_cache = self.internal_news
        except Exception as e:
            logger.error(f"Error fetching news: {e}")
            if not self.news_cache:
                self.news_cache = self.internal_news
                
    def get_news(self):
        if not self.news_cache or len(self.news_cache) == len(self.internal_news):
            self.fetch_external_news()
        return self.news_cache

    def force_refresh(self):
        self.fetch_external_news()
        return self.news_cache

news_manager = NewsManager()
