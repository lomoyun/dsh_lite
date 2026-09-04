# dsh_lite

`dsh_lite` is a downstream DeepSeek Harness project. It consumes published DSH packages and keeps local behavior in a profile patch, so upstream updates are dependency upgrades rather than source merges.

## What this baseline keeps

- DSH agent loop and model routing
- durable sessions and projections
- tool registry and tool-call lifecycle
- compaction, settings, credentials, and telemetry
- the SDK stdio application and TypeScript client
- general-purpose web, goal, skill, subagent, and workflow capabilities supplied by `dsh-base`

The local patch replaces the coding persona and disables repository instructions, shell tools, filesystem tools, background command jobs, Ralph, and the string-replace editor. Domain-specific tools can be added later as separate plugins without changing DSH internals.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- a DeepSeek API key for real model calls

## Setup

```powershell
Copy-Item .env.example .env
pnpm install
```

Put the real key in `.env`; the file is ignored by Git.

## Verify the composed runtime

This prints the final Cordis tree without making a model request:

```powershell
pnpm run config:dump
```

Confirm that the coding-tool rows are disabled and the `system-prompt` row contains the neutral persona.

## Run

```powershell
pnpm start -- "请总结这段业务需求"
```

The SDK starts the same-version `dsh` dependency with the shipped `sdk` profile, applies `config/dsh-lite.cordis.yml`, waits for the agent to return to `idle`, prints the final response, and then closes the child process.

## Upgrade DSH

Keep the CLI and SDK client on the same exact release:

```powershell
pnpm update @deepseek-ai/dsh@0.1.2-rc.1 @deepseek-ai/dsh-sdk-client@0.1.2-rc.1 --save-exact
pnpm run typecheck
pnpm run config:dump
```

For a future release, replace both version arguments together and review the resulting `pnpm-lock.yaml` change before running domain-agent regression tests.
