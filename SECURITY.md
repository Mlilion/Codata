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

- **Acknowledgment target:** within 48 hours
- **Initial assessment target:** within 7 days
- **Fix or mitigation:** depends on severity and maintainer availability

These are best-effort targets, not a support SLA. Repository maintainers must
verify that the reporting mailbox is monitored before publishing a release.

## How Codata Handles Your Data

Codata is designed with local-first privacy:

- **Local storage:** conversations, memories, settings, generated artifacts, and workflow metadata are stored locally by default. Local storage does not mean that their contents can never leave the device.
- **Cloud models:** requests may include system instructions, conversation history, selected file contents, retrieved context, and tool results. These are sent to the provider endpoint you configure, potentially through your configured HTTP proxy. The provider's own privacy and retention policies apply.
- **MCP and messaging channels:** enabled connectors, search tools, remote team services, and messaging platforms exchange requests and data with their configured services. Tool results may subsequently become model context. Review permissions and avoid supplying secrets or private data unnecessarily.
- **Local models:** inference through a local Ollama endpoint can stay on the device. Other enabled features may still access the network, including model catalogs, model/runtime downloads, external tools, and preview assets loaded from public CDNs. Local inference alone does not make the whole application offline.
- **Web sources:** when displaying web search or fetch results, Codata requests favicons directly from each source site (`https://example.com/favicon.ico`). These requests are sent to the original sites, not to third-party services. Sites may log the request in their access logs.
- **Logs and exports:** conversations and tool outputs can contain sensitive information. Review local logs, exported reports, screenshots, and support attachments before sharing them.
- **Telemetry:** Codata does not intentionally send product analytics or tracking events. Requests to configured services and public asset/download hosts are separate network activity; those services may record their own access logs.

Automatic desktop updates are disabled in the default open-source configuration.
Download releases from the official repository. Before enabling updates in a
custom build, configure an update endpoint and a signing key pair you control.

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
