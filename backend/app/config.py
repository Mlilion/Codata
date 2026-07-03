"""Application configuration via Pydantic Settings."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CODATA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Provider ---
    openrouter_api_key: str = ""

    # --- Direct Provider API Keys (BYOK) ---
    openai_api_key: str = ""        # CODATA_OPENAI_API_KEY
    openai_base_url: str = "https://aihub2.top/v1"  # CODATA_OPENAI_BASE_URL
    anthropic_api_key: str = ""     # CODATA_ANTHROPIC_API_KEY
    google_api_key: str = ""        # CODATA_GOOGLE_API_KEY
    groq_api_key: str = ""          # CODATA_GROQ_API_KEY
    deepseek_api_key: str = ""      # CODATA_DEEPSEEK_API_KEY
    mistral_api_key: str = ""       # CODATA_MISTRAL_API_KEY
    xai_api_key: str = ""           # CODATA_XAI_API_KEY
    together_api_key: str = ""      # CODATA_TOGETHER_API_KEY
    deepinfra_api_key: str = ""     # CODATA_DEEPINFRA_API_KEY
    cerebras_api_key: str = ""      # CODATA_CEREBRAS_API_KEY
    cohere_api_key: str = ""        # CODATA_COHERE_API_KEY
    perplexity_api_key: str = ""    # CODATA_PERPLEXITY_API_KEY
    fireworks_api_key: str = ""     # CODATA_FIREWORKS_API_KEY
    azure_openai_api_key: str = ""  # CODATA_AZURE_OPENAI_API_KEY
    azure_openai_base_url: str = "" # CODATA_AZURE_OPENAI_BASE_URL
    qwen_api_key: str = ""          # CODATA_QWEN_API_KEY (Alibaba DashScope)
    kimi_api_key: str = ""          # CODATA_KIMI_API_KEY (Moonshot)
    minimax_api_key: str = ""       # CODATA_MINIMAX_API_KEY
    zhipu_api_key: str = ""         # CODATA_ZHIPU_API_KEY (智谱 GLM)
    siliconflow_api_key: str = ""   # CODATA_SILICONFLOW_API_KEY (硅基流动)
    xiaomi_api_key: str = ""        # CODATA_XIAOMI_API_KEY (MiMo)
    custom_endpoints: str = "[]"    # CODATA_CUSTOM_ENDPOINTS

    # Comma-separated list of provider IDs to disable (e.g. "groq,deepseek")
    # Disabled providers are not registered even if their API key is set.
    disabled_providers: str = ""  # CODATA_DISABLED_PROVIDERS

    # --- Database ---
    database_url: str = "sqlite+aiosqlite:///./data/codata.db"

    # --- Server ---
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    # Dev-only fixed session token. Used by npm run dev:all so the Next.js
    # dev server can authenticate browser-originated /api requests without
    # weakening backend auth. Ignored unless allow_dev_session_token=True.
    allow_dev_session_token: bool = False
    dev_session_token: str = ""

    # --- Project ---
    project_dir: str = "."

    # --- Web Search ---
    daily_search_limit: int = 20  # Max free web_search calls per day (Free/BYOK)
    web_search_context_size: str = "low"  # "low" | "medium" | "high"
    max_native_searches_per_step: int = 5  # cap on native web searches per agent step

    # --- Compaction ---
    compaction_auto: bool = True
    compaction_reserved: int = 20_000

    # --- Agents (loaded from YAML) ---
    agents: dict[str, Any] | None = None

    # --- MCP (loaded from YAML) ---
    mcp: dict[str, Any] | None = None

    # --- Google Workspace MCP Proxy ---
    google_client_id: str = ""
    google_client_secret: str = ""

    # --- Ollama (Local LLM) ---
    ollama_base_url: str = ""  # e.g. "http://localhost:11434" — empty = not configured
    ollama_auto_start: bool = True  # Auto-start managed Ollama binary on app launch
    ollama_last_model: str = ""  # Last-used model name for startup pre-warming

    # --- Local OpenAI-compatible endpoint ---
    local_base_url: str = ""  # CODATA_LOCAL_BASE_URL

    # --- Brave Search ---
    brave_search_api_key: str = ""

    # --- Full-Text Search ---
    fts_enabled: bool = True  # built-in FTS5, enabled by default (zero external deps)
    fts_auto_index: bool = True  # auto-index workspace on first access
    fts_poll_interval: float = 30.0  # seconds between re-index polls
    fts_max_file_size: int = 500_000  # bytes — skip files larger than this

    # --- Agent Limits ---
    max_steps: int = 50  # hard cap on agent loop iterations
    max_continuation_attempts: int = 10  # max nudges for incomplete todos
    max_tool_output_chars: int = 20_000  # truncate individual tool results beyond this
    max_assistant_content_chars: int = 40_000  # truncate accumulated assistant text
    max_request_context_chars: int = 160_000  # hard cap on total prompt size
    hard_max_output_tokens: int = 8192  # max tokens the model can generate per step
    min_output_tokens: int = 256  # minimum output tokens floor
    tool_timeout: int = 300  # seconds — per-tool execution timeout
    max_concurrent_generations: int = 20  # max parallel generation jobs

    # --- Tool Limits ---
    bash_timeout: int = 120  # default bash command timeout (seconds)
    bash_max_timeout: int = 600  # maximum bash timeout (seconds)
    subtask_max_depth: int = 3  # max nesting for sub-agent tasks
    subtask_timeout: int = 600  # seconds — sub-agent task timeout

    # --- Loop Detection ---
    loop_warn_threshold: int = 3  # warn after N repeated identical tool calls
    loop_hard_limit: int = 5  # hard-block after N repeated identical tool calls

    # --- Scheduler ---
    scheduler_poll_interval: int = 30  # seconds between task schedule checks
    scheduler_max_concurrent: int = 3  # max concurrent scheduled tasks

    # --- Shutdown ---
    shutdown_timeout: float = 8.0  # seconds to wait for active jobs on shutdown

    # --- Rate Limiting ---
    rate_limit_max_requests: int = 120  # max requests per minute
    rate_limit_max_failed_auth: int = 5  # max failed auth attempts per minute

    # --- CSRF / Origin protection ---
    # Comma-separated list of additional allowed origins (exact match) for
    # cross-site state-changing requests. The defaults already cover the
    # Tauri desktop shell, loopback, and the Next.js dev server — only set
    # this to extend for unusual deployments (e.g. a custom web wrapper).
    extra_allowed_origins: str = ""  # CODATA_EXTRA_ALLOWED_ORIGINS

    # --- Messaging Channels (nanobot-based, in-process) ---
    channels_enabled: bool = True  # CODATA_CHANNELS_ENABLED
    channels_config_path: str = ""  # CODATA_CHANNELS_CONFIG_PATH (default: data/channels.json)

    # --- Remote Expert Teams (manifest adapter, disabled by default) ---
    remote_expert_teams_enabled: bool = False  # CODATA_REMOTE_EXPERT_TEAMS_ENABLED
    remote_expert_teams_manifest_path: str = ""  # local manifest path fallback
    remote_expert_teams_manifest_url: str = ""  # HTTP manifest URL, e.g. /custom/api/expert-teams/manifest
    remote_expert_teams_auth_token: str = ""  # Bearer token for remote manifest URL
    remote_expert_teams_cache_path: str = ""  # default: ~/.codata/remote-expert-teams/cache/manifest.json
    remote_expert_teams_fetch_interval_seconds: int = 60

    # --- ViMax local video runtime ---
    vimax_runtime_url: str = ""  # e.g. http://127.0.0.1:8765
    vimax_config_path: str = ""  # default config path used by vimax_generate_video
    vimax_google_api_key: str = ""  # optional override for image/video generation
    vimax_yunwu_api_key: str = ""  # optional override for Yunwu-backed generators
    vimax_media_api_key: str = ""  # optional generic media generator key override
    vimax_media_base_url: str = ""  # optional generic media generator base URL override
    vimax_media_preset: str = ""  # default ViMax media preset: gemini, doubao, dataeyes, or config
    vimax_image_model: str = ""  # default image model for ViMax media presets
    vimax_video_model: str = ""  # default video model when one value can drive all video modes
    vimax_video_t2v_model: str = ""  # optional text-to-video model override
    vimax_video_ff2v_model: str = ""  # optional first-frame-to-video model override
    vimax_video_flf2v_model: str = ""  # optional first/last-frame-to-video model override
    vimax_media_api_version: str = ""  # optional generic media generator API version override
    vimax_image_api_version: str = ""  # optional image generator API version override
    vimax_video_api_version: str = ""  # optional video generator API version override

    # --- Local session auth ---
    # Rotated every backend start, written 0600 so another local user on a
    # shared host cannot read it. The desktop shell (Tauri) reads this file
    # after spawning the backend and injects the token on every request —
    # it never leaves the filesystem through the network layer.
    #
    # Path may be relative (resolved against cwd) or absolute. The
    # production launcher (``run.py``) chdirs into ``--data-dir`` and then
    # the Tauri shell polls ``<data_dir>/session_token.json``, so the
    # default below assumes that working-directory contract. Override via
    # the ``CODATA_SESSION_TOKEN_PATH`` env var when the contract differs
    # (the dev launcher does this — see ``scripts/dev-desktop.mjs`` —
    # because it runs uvicorn without invoking ``run.py``, so cwd stays
    # at ``backend/`` and the file needs to land under ``backend/data/``
    # to match what Tauri dev mode reads).
    session_token_path: str = "session_token.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()

def get_custom_endpoints(settings: Settings) -> list[dict[str, Any]]:
    try:
        data = json.loads(settings.custom_endpoints)
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []
