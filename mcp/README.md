# MCP

This folder is the toolkit MCP surface.

Current status: design/spec-only. This repo does not currently ship a runnable MCP server, package, CLI, or installed MCP command set.

Do not treat the specs here as implemented tools until a future change adds runnable code and validation.

## MCP Areas

| MCP area | Status | Provides |
|---|---|---|
| `mcp/registry-mcp/` | Design/spec-only | A proposed read-only MCP surface for querying toolkit registries. |
| `mcp/installer-mcp/` | Design/spec-only | A proposed approval-gated installer surface for skill-local pack plans. |
| `mcp/projects/` | Published project notes | Project-specific MCP notes generated from `_projects/**/toolkit.project.json` routing. |
| `mcp/registry/` | Data only | JSON registries for projects, skills, packs, templates, source repos, tools, and consumers. |
| `mcp/references/` | Reference notes | MCP-related operator notes and design references. |

## Commands And Tools

No runnable MCP commands or tools are implemented in this repo today.

The design specs describe candidate commands/tools only. They are not available until an actual MCP runtime is added.

| Command/tool | What it does | Inputs | Output |
|---|---|---|---|
| None implemented | No MCP runtime is currently shipped. | Not applicable. | Not applicable. |

## How To Use This Folder

Use this folder to inspect MCP designs, registry data, and project MCP notes.

If a future runnable MCP server is added, this README must be updated with the install command, server entrypoint, implemented commands/tools, required inputs, and output schemas.
