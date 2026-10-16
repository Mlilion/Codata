"""Filesystem layout for the local knowledge wiki (llm-wiki style)."""
from __future__ import annotations

from pathlib import Path


def _resolve_data_dir() -> Path:
    # Desktop/prod: run.py chdirs into --data-dir; dev runs from backend/.
    # Matches app.main's `data_dir = Path.cwd()` convention.
    return Path.cwd()


def wiki_root() -> Path:
    root = _resolve_data_dir() / "knowledge-wiki"
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "wiki").mkdir(parents=True, exist_ok=True)
    return root


def raw_dir() -> Path:
    return wiki_root() / "raw"


def wiki_dir() -> Path:
    return wiki_root() / "wiki"


def index_path() -> Path:
    return wiki_dir() / "index.md"
