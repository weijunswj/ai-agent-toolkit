# Agent-Agnostic Principles

This method is for any AI coding agent that edits or maintains repo documentation, templates, skills, MCP notes, or other AI-facing surfaces. It does not assume one agent product, prompt format, or tooling stack.

## Preserve Complete Canonical Material

Keep full working material in its direct canonical location. Material can include docs, prompts, policies, templates, specs, examples, or approved imported files.

Do not replace full source with a summary when future agents need the full working instructions. Summaries are useful for navigation, but they are not a source of truth for operational detail.

## Keep Support Files Honest

Use concise local support files when they help route to or explain canonical material:

- Skill entrypoints.
- README or index files.
- Routing and provenance records.
- Product metadata.
- Platform shims.
- Safety wrappers.
- MCP or tool summaries.

Support files must not become a second owner or a lossy replacement for canonical instructions.

## Keep Navigation Clickable

Human-facing navigational paths and URLs must be clickable Markdown links.

- Important links must not exist only inside code fences or inline code.
- Code blocks are for commands, payloads, literal examples, and copy/paste prompts.
- Inline code is acceptable for commands, filenames being discussed literally, globs, config keys, or short literal examples, but not as the only navigation path to important docs or assets.

## Make Ownership Explicit

Every AI-facing file should have a clear canonical owner. Routing and provenance records should identify the product, source identity, copied or adapted material, attribution duties, and validation that protects the file.

## Keep Local Law Local

Each repo should own its local law: safety rules, validation commands, deletion policy, CI behavior, naming conventions, and live-system boundaries.

This generic method can help review those docs, but it must not overwrite local rules.

## Prefer Deterministic Verification

Use deterministic parsers, validators, link checks, routing tests, and source-lock audits. Do not ask an AI model to decide whether its own output is fresh or correctly attributed.

AI can draft canonical files, but humans or authorized maintainers should review third-party adaptations and provenance decisions before publication.

## Keep Derived Sections Bounded

When the target repository already declares a generated section, edit its named source and run its documented generator. Do not introduce a second ownership tree or generic cross-tree synchronization framework.
