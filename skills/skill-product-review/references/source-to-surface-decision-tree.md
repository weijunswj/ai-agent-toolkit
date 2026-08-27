# Source-To-Surface Decision Tree

Use this decision tree before placing reviewed material in a target repository.

## 1. Is The Material Runtime-Critical?

Runtime-critical material includes full setup steps, prompts, templates, policy text, troubleshooting notes, examples, command sequences, schemas, and anything a future agent needs to execute the work.

- Yes: preserve the full approved material in its direct canonical path.
- No: it may be a concise index, routing record, provenance record, or metadata file.

## 2. Is It A Short Router Or Support File?

Short support files can live beside the canonical product when they do not replace full working detail.

Good examples:

- `SKILL.md` entrypoint.
- Skill README.
- Reference index.
- Template index.
- Provenance record.
- MCP overview.
- Safety wrapper.

## 3. Does It Publish A Skill?

When creating or materially changing a skill, decide:

- Does this publish an agent-usable skill folder with `SKILL.md`?
- Should the skill be listed in the repo's skill-routing guidance for supported agents?
- Does the `SKILL.md` description clearly support implicit invocation where supported?
- Does the skill need local examples, references, templates, tools, or assets inside the skill folder?
- Do README skill tables, registry metadata, or routing docs need updates?
- What validation proves the canonical files, routing, and provenance stay aligned?

If a skill is intentionally omitted from auto-routing, document the reason in the routing source.

## 4. How Is The Material Classified?

- `exact`: copied without semantic changes and pinned by blob hash.
- `adapted`: changed with attribution and adaptation notes.
- `excluded`: reviewed but intentionally not retained.
- `inspiration-only`: independently re-authored without copied text.

Record the classification in the target repository's provenance format.

## 5. Are Links Valid In The Canonical Location?

Human-facing navigational paths and URLs must be clickable Markdown links. Important links must not exist only inside code fences or inline code.

- Use code blocks for commands, payloads, literal examples, and copy/paste prompts.
- Use inline code for commands, filenames being discussed literally, globs, config keys, or short literal examples.
- Do not use inline code as the only navigation path to important docs or assets.

When adapted third-party docs contain broken source-relative links, update the canonical adaptation, document the change, and validate the final links. Do not introduce a mirrored folder solely to preserve an obsolete layout.

## 6. Is Ownership And Provenance Complete?

Before publication, verify:

- Canonical path and product owner.
- Upstream repository, ref, commit, and source path.
- Exact or adapted classification.
- License and attribution duties.
- Source-lock blob pins where required.
- Separate mutation authority.

## 7. What Must Be Audited?

At minimum, audit for:

- New ownerless or duplicate files.
- New cross-owned canonical paths.
- New suspicious lossy surfaces.
- New boundary violations between review verdict and implementation authority.
- New baseline movement.
- Broken links.
- Unsafe executable or live-system behavior.
