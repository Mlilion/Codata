# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Codata, please report it responsibly.

**Email:** [codata@126.com](mailto:codata@126.com)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Do not** open a public GitHub issue for security vulnerabilities.

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix or mitigation:** depends on severity, typically within 30 days

## How Codata Handles Your Data

Codata is designed with local-first privacy:

- **Files, conversations, and memory** are stored on your device. Nothing is uploaded to any server.
- **Cloud model usage** sends only your prompt text directly to the model provider's API (OpenAI, Anthropic, etc.). Codata does not proxy, log, or store these requests.
- **Local model usage** (via Ollama) keeps everything on your machine. No network requests are made.
- **No telemetry, no analytics, no tracking.** Codata does not collect usage data.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Previous minor | Best effort |
| Older | ❌ |

We recommend always using the latest release.

## Scope

The following are in scope for security reports:

- Local file access vulnerabilities (unauthorized read/write)
- Data leakage to unintended third parties
- Code execution vulnerabilities in tool/bash execution
- MCP connector security issues
- Authentication/authorization bypass in remote access feature

Out of scope:

- Vulnerabilities in third-party model provider APIs
- Social engineering attacks
- Denial of service against local application
