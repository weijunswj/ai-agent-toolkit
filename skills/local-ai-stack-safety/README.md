# Local AI Stack Safety

Small safety-review skill for local AI runtimes, model servers, model downloads, GPU/runtime setup, local AI web UIs, and endpoint exposure.

## Use This Skill For

- Local LLM or model-server setup such as Ollama, llama.cpp-style runners, or LM Studio-style tools.
- Stable Diffusion, ComfyUI, or other local AI web UI setup.
- Model downloads, GPU/runtime changes, local vector databases, or local inference endpoint exposure.
- A user asks whether a local AI setup script, README, Docker Compose file, or launch command is safe to run.

## Not For

- Do not use for normal coding with cloud AI APIs, prompt writing, or model-selection advice when no local runtime/setup risk exists.
- Do not install packages, run downloaded scripts, pull models, start Docker, edit shell profiles, expose ports, or change GPU/system drivers without explicit current-turn approval naming the target operation.
- Do not duplicate n8n setup rules. If the target is n8n, apply n8n-agent-rules and n8n-local-setup first.

## Expected Output

Return a compact Local AI Stack Safety Review with risk level, blocked actions, approval-gated actions, safer first-run plan, files/settings to inspect, and validation checks such as localhost-only health checks or port binding review.
