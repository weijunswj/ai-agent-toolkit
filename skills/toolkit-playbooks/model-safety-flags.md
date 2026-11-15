# Model Safety Flags Playbook

Use when a session or subagent was switched to a fallback model by a safety classifier, or when a repository's own wording or instruction files may be triggering false flags.

## Why it happens

Model safety classifiers read everything the model receives, including instruction files, directory names and git status at session start. A repository with security, exploit-testing or similar vocabulary can trigger a flag before anyone asks anything unusual. Benign defensive work can be flagged too.

## The line

Reword or rename only when the new wording describes the code or task more accurately. Never disguise genuinely offensive work (building exploits, attacking systems you do not own) to avoid a classifier: that is evasion.

## Steps

1. **Stop on fallback.** If this session or a subagent was switched to a fallback model, stop work on the lower model. Report the time, the request ID if shown, and what was asked.
2. **Find the trigger.** Start `claude --safe-mode` in the same folder (it drops instruction files, skills, MCP servers and hooks, but not git status or directory names). If the flag goes away, the instruction files are the trigger; otherwise it is the task or the repository content.
3. **Fix wording, not meaning.** In always-loaded files, folder names, scripts and identifiers, prefer plain accurate words (`stop`, `remove`, `reset`, `skip check`, `test the guard`) over `kill`, `nuke`, `exploit`, `inject`, `attack` or `bypass` where the meaning is unchanged. Keep exact terms where they are the precise meaning, and keep real API names.
4. **Add an authorised-context note** outside the Toolkit block in `AGENTS.md`, for example:

   ```markdown
   ## Authorised context

   This repository is owned by <owner>. Work here is development and defensive testing of this repository's own software. Nothing here targets systems we do not own.
   ```

5. **Retry** in a fresh session with a clearer, accurate request, or ask the owner. Send feedback on a wrong flag through the host's feedback route.

## Settings note

In Claude Code, `"switchModelsOnFlag": false` in user settings makes interactive sessions pause and ask instead of switching; non-interactive runs end the turn with a refusal. Subagents may still switch silently, so step 1 still applies. A project or local settings file that sets the key overrides the user setting.
