import os
import json
import logging
import asyncio
import time
import requests
from threading import Thread

logger = logging.getLogger(__name__)

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
        
    def start_background_fetch(self):
        def loop():
            while True:
                self.fetch_external_news()
                time.sleep(self.fetch_interval)
                
        t = Thread(target=loop, daemon=True)
        t.start()
        
    def fetch_external_news(self):
        try:
            logger.info("Fetching external news from r/LocalLLaMA...")
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LLaMA-Pro/1.0"}
            response = requests.get("https://www.reddit.com/r/LocalLLaMA/top.json?t=day&limit=15", headers=headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                external_news = []
                for post in data.get("data", {}).get("children", []):
                    post_data = post.get("data", {})
                    # We only want posts with text (selftext) or a thumbnail/preview to show as news
                    title = post_data.get("title", "")
                    selftext = post_data.get("selftext", "")
                    url = "https://reddit.com" + post_data.get("permalink", "")
                    
                    # Try to get an image
                    image_url = None
                    if post_data.get("thumbnail") and post_data.get("thumbnail").startswith("http"):
                        image_url = post_data.get("thumbnail")
                    elif post_data.get("preview") and "images" in post_data.get("preview"):
                        try:
                            image_url = post_data["preview"]["images"][0]["source"]["url"].replace("&amp;", "&")
                        except:
                            pass
                            
                    # Some posts might just be links, fallback to external url
                    if not selftext and not image_url:
                        continue # Skip entirely boring posts
                        
                    # Truncate summary
                    summary = selftext[:200] + "..." if len(selftext) > 200 else selftext
                    if not summary:
                        summary = "Link/Image post."
                        
                    external_news.append({
                        "id": post_data.get("id"),
                        "title": title,
                        "summary": summary,
                        "full_text": selftext,
                        "image_url": image_url,
                        "source": "r/LocalLLaMA",
                        "url": url,
                        "date": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(post_data.get("created_utc", time.time()))),
                        "is_internal": False
                    })
                    
                self.news_cache = self.internal_news + external_news
                self.last_fetch = time.time()
                logger.info(f"Successfully fetched {len(external_news)} external news items.")
            else:
                logger.error(f"Failed to fetch news. Status: {response.status_code}")
                # Fallback to internal only if empty
                if not self.news_cache:
                    self.news_cache = self.internal_news
        except Exception as e:
            logger.error(f"Error fetching news: {e}")
            if not self.news_cache:
                self.news_cache = self.internal_news
                
    def get_news(self):
        if not self.news_cache:
            self.fetch_external_news()
        return self.news_cache

news_manager = NewsManager()
