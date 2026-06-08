---
name: local-ai-stack-safety
description: Use only when reviewing or planning local AI stack setup such as local LLM runners, model servers, Stable Diffusion or ComfyUI-style web UIs, vector databases, model downloads, GPU/runtime changes, or exposing local AI endpoints. Do not use for ordinary AI API coding, model prompting, or general application work.
---

# Local AI Stack Safety

## Overview

Review local AI stack setup plans before running installers, downloading models, changing GPU/runtime dependencies, starting local AI web UIs, or exposing inference endpoints. The skill produces a short safety review and safer first-run plan; it is not an installer.

Keep this skill lightweight. Do not use it as general advice when the task has no setup, exposure, credential, install, or live-system risk.

## Use When

- Local LLM or model-server setup such as Ollama, llama.cpp-style runners, or LM Studio-style tools.
- Stable Diffusion, ComfyUI, or other local AI web UI setup.
- Model downloads, GPU/runtime changes, local vector databases, or local inference endpoint exposure.
- A user asks whether a local AI setup script, README, Docker Compose file, or launch command is safe to run.

## Do Not Use When

- Do not use for normal coding with cloud AI APIs, prompt writing, or model-selection advice when no local runtime/setup risk exists.
- Do not install packages, run downloaded scripts, pull models, start Docker, edit shell profiles, expose ports, or change GPU/system drivers without explicit current-turn approval naming the target operation.
- Do not duplicate n8n setup rules. If the target is n8n, apply n8n-agent-rules and n8n-local-setup first.

## Review Checklist

- Installer and package-manager side effects, including curl-pipe-shell, postinstall hooks, and shell profile edits.
- Network and privacy behavior: cloud callbacks, telemetry, prompt/file upload, public tunnels, 0.0.0.0 binds, and unauthenticated endpoints.
- Storage impact: model/cache locations, large downloads, generated outputs, logs, and cleanup expectations.
- Secrets and data handling: API keys, tokens, .env values, private documents, local datasets, and browser/session files.
- Rollback path: how to stop the service, remove startup hooks, avoid persistence, and verify localhost-only access first.

## Output

Return a compact Local AI Stack Safety Review with risk level, blocked actions, approval-gated actions, safer first-run plan, files/settings to inspect, and validation checks such as localhost-only health checks or port binding review.

## Safety Boundary

Review-only by default. Installation, model pulls, Docker, public tunnels, driver/runtime changes, shell profile edits, credentials, or non-local network exposure require explicit current-turn approval.
