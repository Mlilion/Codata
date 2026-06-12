# baoyu-codex-imagegen

Generate images via Codex CLI's built-in `image_gen` tool from non-Codex runtimes (e.g., Claude Code). The wrapper spawns `codex exec --json` and lets the user's existing Codex subscription drive image generation — **no `OPENAI_API_KEY` required**.

This package implements the `preferred_image_backend: codex-imagegen` config key referenced across the `baoyu-skills` plugin and is the engine behind `baoyu-image-gen --provider codex-cli`.

## Layout

```
packages/baoyu-codex-imagegen/
├── src/
│   ├── main.ts             # CLI orchestrator (executable via `#!/usr/bin/env bun`)
│   ├── spawn.ts            # codex exec child-process wrapper
│   ├── parser.ts           # JSONL event-stream parser
│   ├── validator.ts        # Output PNG / image_gen-invocation verification
│   ├── cache.ts            # SHA256 idempotency cache + file lock
│   ├── logger.ts           # Structured JSONL logging
│   ├── types.ts            # Shared types and `GenError`
│   └── *.test.ts           # Bun unit tests
└── package.json            # `bin` points to `src/main.ts`
```

## Prerequisites

```bash
npm install -g @openai/codex
codex login            # signs in with your OpenAI account (subscription)
codex --version        # confirm >= 0.130
```

`bun` is required for running the wrapper:

```bash
brew install oven-sh/bun/bun
```

If `bun` is not on `PATH`, `npx -y bun src/main.ts …` works as a fallback.

## Usage

```bash
# Inline prompt (executes via shebang once bun is on PATH)
./src/main.ts \
  --image /tmp/cat.png \
  --prompt "A friendly orange cat, watercolor"

# Or invoke bun explicitly
bun src/main.ts \
  --image cover.png \
  --prompt-file prompts/01-cover.md \
  --aspect 16:9 \
  --cache-dir ~/.cache/baoyu-codex-imagegen

# Without bun installed
npx -y bun src/main.ts --image cover.png --prompt "..."
```

Stdout emits a single JSON line:

```json
{"status":"ok","path":"…","bytes":1234567,"elapsed_seconds":62,"thread_id":"…","attempts":1,"cached":false,"usage":{…}}
```

On failure:

```json
{"status":"error","path":"…","bytes":0,"error":"…","error_kind":"timeout"}
```

`error_kind` values: `codex_not_installed`, `invalid_args`, `prompt_file_missing`, `spawn_failed`, `timeout`, `no_image_gen_tool_use`, `output_missing`, `invalid_png`, `agent_refused`, `lock_busy`.

## Options

| Flag | Description |
|---|---|
| `--image <path>` | Output PNG path (required) |
| `--prompt <text>` | Prompt text |
| `--prompt-file <path>` | Read prompt from file (mutually exclusive with `--prompt`) |
| `--aspect <ratio>` | Aspect ratio (`1:1`, `16:9`, `9:16`, `4:3`, `2.35:1`). Default: `1:1` |
| `--ref <file>` | Reference image (repeatable) |
| `--timeout <ms>` | Codex exec timeout in ms. Default: `300000` |
| `--retries <n>` | Retry attempts on retryable errors. Default: `2` |
| `--retry-delay <ms>` | Base retry delay (exponential). Default: `1500` |
| `--cache-dir <path>` | Enable idempotency cache. Disabled by default. |
| `--log-file <path>` | Append structured JSONL log |
| `-v, --verbose` | Verbose stderr logging |
| `-h, --help` | Show help |

## Test

```bash
cd packages/baoyu-codex-imagegen
bun test
```

## Trade-offs

- 5–10× slower than direct OpenAI API calls (except on cache hits)
- Uses your Codex subscription — programmatic use of `codex exec` falls into the same terms as interactive use
- Requires `codex` CLI and active login session

See [`docs/codex-imagegen-backend.md`](../../docs/codex-imagegen-backend.md) for the full background.
