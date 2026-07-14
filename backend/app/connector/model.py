"""Connector data model — a single MCP server connection."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ConnectorInfo:
    """Represents a single, deduplicated MCP server connection.

    Unlike the old plugin-namespaced approach (``engineering:slack``),
    each connector is a unique entity identified by its ``id``
    (e.g. ``"slack"``, ``"notion"``).
    """

    id: str  # unique slug: "slack", "notion", "github"
    name: str  # display name: "Slack", "Notion"
    url: str  # MCP server URL (empty for local)
    type: str  # "remote" | "local"
    description: str
    category: str  # "communication", "productivity", etc.
    enabled: bool = False
    source: str = "builtin"  # "builtin" | "custom"
    # How this connector authenticates:
    #   "oauth" — browser OAuth flow (default for remote connectors)
    #   "token" — user pastes a PAT / API key (e.g. datasage MCP Key)
    #   "none"  — no auth needed (local command connectors, open endpoints)
    # Drives status(): a "token" connector whose transport handshake
    # succeeds but has no stored token is reported as needs_auth, not
    # connected — the transport accepting an unauthenticated handshake does
    # not mean tool calls will be authorized.
    auth: str = "oauth"
    local_config: dict[str, Any] = field(default_factory=dict)
    referenced_by: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialise for API responses."""
        return {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "type": self.type,
            "description": self.description,
            "category": self.category,
            "enabled": self.enabled,
            "source": self.source,
            "auth": self.auth,
            "referenced_by": self.referenced_by,
        }
