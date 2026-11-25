import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

APP_NAME = "Prepwise"
APP_VERSION = "1.0"

# SQLite file — created automatically; delete it to reset the demo.
DB_PATH = os.getenv("DB_PATH", str(ROOT / "data" / "prepwise.db"))

# Groq exposes an OpenAI-compatible API with a free tier.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Placeholder keys from .env.example should not switch on live mode.
LLM_ENABLED = bool(GROQ_API_KEY) and not GROQ_API_KEY.startswith("gsk_your")

STATIC_DIR = ROOT / "static"
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
