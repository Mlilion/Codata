from __future__ import annotations
from app.knowledge import wiki_store

def test_wiki_dirs_created(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    root = wiki_store.wiki_root()
    assert root == tmp_path / "knowledge-wiki"
    assert wiki_store.raw_dir().is_dir()
    assert wiki_store.wiki_dir().is_dir()
    assert wiki_store.index_path() == wiki_store.wiki_dir() / "index.md"
