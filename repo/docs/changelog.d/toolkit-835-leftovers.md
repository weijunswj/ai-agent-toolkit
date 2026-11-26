Title: remove toolkit and leftover scan fixes

### Fixed

- **Remove toolkit:** the plan now lists the Claude app's Toolkit copy from the claude.ai account as kept, with the steps to remove it on claude.ai, and apply's closing lines say the Claude app keeps running it until then. Toolkit never changes that copy.
- **Remove toolkit:** the line about parts every app shares names only what is on the computer (old scheduled tasks only when there are some), and says nothing when there are none.
- **Remove toolkit:** the "Not touched" line no longer counts the subagent limit among the Claude Code settings left as they are, and the update reports folder is listed only while it holds a Toolkit report.
- **Leftover scan:** an older marked `GEMINI.md` shim is listed where governance is on too, and an older marked `CLAUDE.md` shim is listed in every state; the governance cleanup replaces a marked `CLAUDE.md` shim that loads the repository's own `AGENTS.md` with the line `@AGENTS.md`, as a rules refresh does.
- **Install check:** "Toolkit helpers: not installed" now says none are needed, because each subagent's model and effort are set when it is started.
- **Wording:** the `CLAUDE.md` shim guidance names Claude Code 2.1.277 as the first version that reads `AGENTS.md` by itself, and says the session-start preflight compares `CLAUDE.md` only in a Toolkit source checkout.
