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

## Security Design Decisions

Codata is an agent framework that gives LLMs access to local tools by design. Some capabilities that would be vulnerabilities in a sandboxed application are intentional here:

- **Code execution (`code_execute` tool):** Executes model-generated Python/JavaScript in the local environment. This is the core feature that enables agents to run scripts, test code, and automate tasks. Protected by session token authentication.
- **Web fetch without SSRF guards (`web_fetch` tool):** Agents can fetch any URL, including internal network addresses like `169.254.169.254`. This enables legitimate use cases like accessing local development servers or internal documentation. Auth-gated like all privileged tools.
- **File system access:** Agents read and write files within the configured project directory. Path-traversal protections enforce workspace boundaries, but authorized agents have full read/write within that scope.

These are not security bugs—they are the intended trust model. **The security boundary is at the session token:** only trusted clients (the Tauri desktop app, authenticated API clients) should have access. Network exposure defaults to `127.0.0.1` (localhost-only) to minimize attack surface.
