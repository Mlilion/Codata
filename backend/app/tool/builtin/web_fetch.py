"""Web fetch tool — fetch URL content and convert to readable markdown."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)


class WebFetchTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "web_fetch"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Fetch content from a URL and return it as readable markdown. "
            "Useful for reading documentation, API responses, and web pages."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch",
                },
                "max_length": {
                    "type": "integer",
                    "description": "Maximum content length to return (default: 50000)",
                    "default": 50000,
                },
            },
            "required": ["url"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        url = args["url"]
        max_length = args.get("max_length", 50000)

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=30.0,
            ) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Codata/0.1 (tool; web_fetch)",
                })
                resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            text = resp.text

            if "html" in content_type:
                text = extract_readable_content(text, url)

            if len(text) > max_length:
                text = text[:max_length] + f"\n\n... [truncated at {max_length} chars]"

            return ToolResult(
                output=text,
                title=f"Fetched {url[:60]}",
                metadata={"url": url, "status_code": resp.status_code, "length": len(text)},
            )

        except httpx.HTTPStatusError as e:
            return ToolResult(error=f"HTTP {e.response.status_code}: {url}")
        except httpx.RequestError as e:
            return ToolResult(error=f"Request failed: {e}")


# ---------------------------------------------------------------------------
# HTML → readable markdown extraction
# ---------------------------------------------------------------------------

def extract_readable_content(html: str, url: str = "") -> str:
    """Extract main article content from HTML and convert to markdown.

    Uses readabilipy (Readability algorithm) + markdownify for high-quality
    extraction.  Falls back to regex stripping if the libraries fail.
    """
    try:
        return _readability_extract(html, url)
    except Exception as e:
        logger.debug("Readability extraction failed (%s), falling back to regex", e)
        return _strip_html(html)


def _readability_extract(html: str, url: str = "") -> str:
    """Readability-based extraction → markdown."""
    from readabilipy import simple_json_from_html_string
    from markdownify import markdownify as md

    try:
        article = simple_json_from_html_string(html, use_readability=True)
    except Exception:
        # Readability.js unavailable — fall back to pure-Python extraction
        article = simple_json_from_html_string(html, use_readability=False)

    title = (article.get("title") or "").strip() or None
    html_content = article.get("content") or ""

    if not html_content.strip():
        # Readability couldn't find an article body — fall back
        raise ValueError("Readability extracted empty content")

    # Convert HTML fragment → markdown
    markdown = md(html_content, strip=["img"]).strip()

    # Collapse excessive blank lines (3+ → 2)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)

    if title:
        markdown = f"# {title}\n\n{markdown}"

    return markdown


def _strip_html(html: str) -> str:
    """Regex fallback — basic HTML tag removal."""
    # Remove script and style blocks
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text
