# AI Skills Templates

A simple home for my reusable AI skills.

Each skill lives in a category folder. The category describes what the skill is mainly for.

## Folder layout

Current example:

```text
ai-skills-templates/
├── README.md
└── portfolio/
    ├── README.md
    └── knowledge-index-updater/
        ├── README.md
        ├── SKILL.md
        └── agents/
            └── openai.yaml
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

Think of it like a tiny SOP for ChatGPT, Codex, or another agent.

## Where can I use these skills?

You can use skills where your AI tool supports Agent Skills or ChatGPT Skills.

Common places:

1. ChatGPT Skills page, if your plan/workspace supports Skills.
2. Codex, by installing or copying a skill folder into the expected skills location.
3. API / custom agents, if your app supports loading Agent Skills.

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
Use the knowledge index updater skill to update my Notion Knowledge Index.
```

## How to add a new skill to this repo

1. Pick a category folder.
2. Create the category folder if it does not exist yet.
3. Create a folder for the skill.
4. Add the skill files.
5. Add a `README.md` inside the skill folder.
6. Keep the README simple enough for an AI agent to understand quickly.

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
5. Do not store secrets, tokens, private credentials, or sensitive exports here.
