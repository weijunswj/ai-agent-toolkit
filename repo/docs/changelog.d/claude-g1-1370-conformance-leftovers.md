### Fixed

- `toolkit governance check` no longer asks for a governed rules block back. Before governance is decided, a `TOOLKIT-GOVERNED-RULES` block (current, older or edited) or an older `GLOBAL-AGENTS.MD-TEMPLATE` block in `AGENTS.md` is now reported as a leftover copy that is not followed, with the cleanup offered once governance is on, instead of "refresh it to the TOOLKIT-GOVERNED-RULES block through a pull request" or "a refresh asks first". Broken markers are still reported.
- The disabled-governance rules line says any governed block in `AGENTS.md` is an old copy and is not followed.
