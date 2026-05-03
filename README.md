# AI Skills Templates

A simple home for my reusable AI skills.

Each skill lives in a category folder. The category describes what the skill is mainly for.

## Folder layout

Current example:

```text
ai-skills-templates/
├── README.md
├── portfolio/
│   ├── README.md
│   └── knowledge-index-updater/
│       ├── README.md
│       ├── SKILL.md
│       └── agents/
│           └── openai.yaml
└── development/
    ├── README.md
    └── windows-localhost-workflows/
        ├── README.md
        ├── SKILL.md
        ├── agents/
        │   └── openai.yaml
        └── references/
            └── known-repos.md
```

Example with more categories:

```text
ai-skills-templates/
├── README.md
├── portfolio/
│   ├── README.md
│   └── knowledge-index-updater/
│       ├── README.md
│       ├── SKILL.md
│       └── agents/
│           └── openai.yaml
├── development/
│   ├── README.md
│   └── windows-localhost-workflows/
│       ├── README.md
│       ├── SKILL.md
│       ├── agents/
│       │   └── openai.yaml
│       └── references/
│           └── known-repos.md
├── finance/
│   ├── README.md
│   └── example-finance-skill/
│       ├── README.md
│       ├── SKILL.md
│       └── agents/
│           └── openai.yaml
└── writing/
    ├── README.md
    └── example-writing-skill/
        ├── README.md
        ├── SKILL.md
        └── agents/
            └── openai.yaml
```

The `finance/` and `writing/` folders above are examples only. Add them when there is a real skill for that category.

## What is a skill?

A skill is a small reusable instruction pack for an AI agent.

It tells the agent:

1. When to use the skill.
2. What tools or sources to check.
3. What steps to follow.
4. What output format to return.

Think of it like a tiny SOP for ChatGPT, Codex, Claude, Claude Code, or another agent.

## What are the important files?

| File | Needed? | Purpose |
|---|---:|---|
| `SKILL.md` | Yes | The actual skill entrypoint. This is the main instruction file. |
| `README.md` | Recommended | Explains the skill for humans and agents browsing the repo. |
| `agents/openai.yaml` | Recommended for ChatGPT | ChatGPT/OpenAI metadata such as display name, short description, and UI colour. It is not the skill logic. |
| `references/` | Optional | Supporting notes that the skill can load when relevant. |

Do not add `claude.md` by default. Claude and Claude Code use the same `SKILL.md` folder. Put Claude usage notes in `README.md` only if needed.

## Default platform support

Every skill in this repo should support these platforms by default where possible:

| Platform | Default support |
|---|---|
| ChatGPT | Yes. Use `SKILL.md` plus `agents/openai.yaml`. |
| Codex | Yes. Copy the skill folder into the expected project skills location. |
| Claude | Yes, if Skills are enabled in the Claude account/workspace. Use the same `SKILL.md` folder. |
| Claude Code | Yes. Copy the skill folder into `~/.claude/skills/` or `.claude/skills/`. |

If a platform does not support a specific feature, document the limitation in the skill README and keep the main `SKILL.md` portable.

## Where can I use these skills?

You can use skills where your AI tool supports Agent Skills or ChatGPT Skills.

Common places:

1. ChatGPT Skills page, if your plan/workspace supports Skills.
2. Codex, by installing or copying a skill folder into the expected skills location.
3. Claude, if Skills are enabled and code execution is available.
4. Claude Code, by copying the skill folder into `~/.claude/skills/` or `.claude/skills/`.
5. API / custom agents, if your app supports loading Agent Skills.

Skills may not automatically sync between products, so treat this repo as the source copy.

## How to install a skill in ChatGPT

1. Open ChatGPT.
2. Click your profile icon.
3. Open **Skills**.
4. Choose **New skill**.
5. Upload or create the skill using the folder contents.
6. Test it with a real prompt.

If you do not see **Skills**, your plan or workspace may not support it yet.

## How to install a skill in Codex

Simple version:

1. Open the skill folder in this repo.
2. Copy the whole skill folder.
3. Put it in your project skills folder, such as `.agents/skills/`.
4. Restart Codex or reload the project.
5. Ask Codex to do a task that matches the skill.

Example:

```text
Use the windows localhost workflows skill to start my dev server.
```

## How to install a skill in Claude

Simple version:

1. Open Claude.
2. Go to settings for Skills if available.
3. Add or upload the skill folder.
4. Make sure the skill includes `SKILL.md`.
5. Test it with a matching request.

If Claude Skills are not visible, the account, workspace, or plan may not support custom Skills yet.

## How to install a skill in Claude Code

Personal skill:

```text
~/.claude/skills/<skill-name>/
```

Project skill:

```text
.claude/skills/<skill-name>/
```

Simple version:

1. Copy the whole skill folder.
2. Paste it into `~/.claude/skills/` for personal use, or `.claude/skills/` inside a project.
3. Restart Claude Code.
4. Ask Claude Code to do a task that matches the skill.

Example:

```text
Use the windows localhost workflows skill to troubleshoot localhost on Windows.
```

## How to add a new skill to this repo

1. Pick a category folder.
2. Create the category folder if it does not exist yet.
3. Create a folder for the skill.
4. Add the skill files.
5. Add a `README.md` inside the skill folder.
6. Add `agents/openai.yaml` when the skill should install nicely in ChatGPT/OpenAI.
7. Keep the README simple enough for an AI agent to understand quickly.

Example:

```text
finance/my-new-finance-skill/
├── README.md
├── SKILL.md
└── agents/
    └── openai.yaml
```

## Current categories

| Category | Purpose |
|---|---|
| `portfolio` | Skills for portfolio pages, knowledge indexes, personal docs, and public/project references. |
| `development` | Skills for coding workflows, localhost setup, debugging, and dev environment operations. |

## Example future categories

| Category | Purpose |
|---|---|
| `finance` | Skills for investing notes, trading workflows, portfolio tracking, and financial summaries. |
| `writing` | Skills for reusable writing workflows, editing, style guides, and content drafts. |
| `automation` | Skills for tool workflows, scheduled checks, scripts, and repeatable ops tasks. |
| `research` | Skills for source review, literature notes, competitive research, and structured summaries. |

Only create a category when there is at least one real skill to put inside it.

## Rules for this repo

1. Keep one folder per skill.
2. Keep skill folders small and readable.
3. Put agent-facing instructions in the skill folder README.
4. Keep install steps beginner-friendly.
5. Support ChatGPT, Codex, Claude, and Claude Code by default when possible.
6. Keep `SKILL.md` portable across agents.
7. Do not store secrets, tokens, private credentials, or sensitive exports here.
