# Agent-Agnostic Principles

This method is for any AI coding agent that edits or maintains repo documentation, templates, skills, MCP notes, or other AI-facing surfaces. It does not assume one agent product, prompt format, or tooling stack.

## Preserve Source Before Packaging

Keep full source material in a stable source layer before publishing short agent-facing surfaces. Source material can be original docs, prompts, policies, templates, specs, examples, or imported upstream files.

Do not replace full source with a summary when future agents need the full working instructions. Summaries are useful for navigation, but they are not a source of truth for operational detail.

## Separate Source From Adapters

Use a reviewed adapter layer for short files whose job is to route, package, or explain source material:

- Skill entrypoints.
- README or index files.
- Manifest files.
- Pack metadata.
- Platform shims.
- Safety wrappers.
- MCP or tool summaries.

Adapters should not silently become lossy rewrites of source docs.

## Keep Navigation Clickable

Human-facing navigational paths and URLs must be clickable Markdown links.

- Important links must not exist only inside code fences or inline code.
- Code blocks are for commands, payloads, literal examples, and copy/paste prompts.
- Inline code is acceptable for commands, filenames being discussed literally, globs, config keys, or short literal examples, but not as the only navigation path to important docs or assets.

## Make Publishing Declarative

Every generated or published AI-facing file should be declared in a manifest or routing contract. The contract should say:

- Which source file or files publish the output.
- Which recipe is used.
- Whether the output is exact, extracted, concatenated, reviewed, generated metadata, or linked.
- Which output paths the publisher is allowed to write.
- Which paths are forbidden.

## Keep Local Law Local

Each repo should own its local law: safety rules, validation commands, deletion policy, CI behavior, naming conventions, and live-system boundaries.

This generic method can help create those docs in bootstrap mode, but it must not overwrite local rules in maintenance mode.

## Prefer Determinism

Publishing should be deterministic. A publishing script may copy, extract, concatenate, format JSON, or generate registries from manifests. It should not ask an AI model to summarise source material during normal sync.

AI can draft source or curated adapter files, but humans or repo maintainers should review those files before they become published surfaces.

## Treat Generated Surfaces As Outputs

Generated AI-facing surfaces are convenient for agents, not independent truth. When a generated output is wrong, update the source or manifest and rerun sync.

Only use directly maintained linked outputs for rare cases that cannot reasonably be generated, and document why they are linked.
