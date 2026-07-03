"""Session token generation, storage, and validation for Codata's local API.

The session token is generated on every backend startup, written to
``<data_dir>/session_token.json`` with mode 0600, and handed to the
desktop shell via the Tauri IPC bridge. It keeps the local HTTP API
unreachable from processes that do not share the filesystem identity of
the user who launched Codata.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger(__name__)

_SESSION_PREFIX = "codata_st_"


def _generate(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def generate_session_token() -> str:
    """Generate a per-run session token distinguished by its prefix."""
    return _generate(_SESSION_PREFIX)


def _write_token_file(path: Path, token: str) -> None:
    """Atomically write the token file with user-only permissions.

    We create the file via ``os.open`` with mode 0600 (read/write for the
    owner, nothing for group/other). On POSIX this enforces same-user
    isolation on shared hosts — another local user cannot read the token
    and therefore cannot forge requests to our backend. On Windows the
    mode argument is ignored, but desktop users there are single-user in
    practice and NTFS ACLs inherit from the parent directory which Tauri
    places under ``%APPDATA%`` (per-user anyway).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a sibling temp file then rename — avoids the window where
    # the real file exists but is empty.
    tmp = path.with_suffix(path.suffix + ".tmp")
    payload = json.dumps({"token": token}).encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(str(tmp), flags, 0o600)
    try:
        os.write(fd, payload)
    finally:
        os.close(fd)
    # Belt-and-braces: set mode again in case umask interfered.
    try:
        os.chmod(str(tmp), 0o600)
    except OSError:
        pass
    os.replace(str(tmp), str(path))


def ensure_session_token(path: Path, token: str | None = None) -> str:
    """Generate + persist a fresh session token on every call.

    Called from the app lifespan at startup. Each run gets a new token so
    a stale token cached somewhere (e.g. a terminated Tauri instance) is
    implicitly invalidated.
    """
    if token is None:
        token = generate_session_token()
    elif not token.startswith(_SESSION_PREFIX):
        raise ValueError("Session token override must use codata_st_ prefix")
    _write_token_file(path, token)
    logger.info("Session token generated (0600): %s", path)
    return token


def validate_token(provided: str, expected: str) -> bool:
    """Constant-time token comparison to prevent timing attacks."""
    if not provided or not expected:
        return False
    return secrets.compare_digest(provided, expected)
