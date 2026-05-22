# Copy this prompt into your AI coding agent

```txt
You are my AI coding agent. I want you to set up a production-ready CI/CD pipeline for this GitHub project with the least amount of manual fiddling from me.

First, verify access and repo state before changing anything.

Verify the following:
1. You are inside the correct project repository.
2. The project is connected to Git.
3. The repository has a GitHub remote.
4. You can inspect files in this repository.
5. You can create and edit files in this repository.
6. You can run local commands where the environment allows it.
7. You can inspect the current branch and git status.
8. You can identify whether there are uncommitted changes.
9. You can inspect existing GitHub Actions workflows, if any.
10. You can prepare commits, but you must not commit until I approve.
11. You must not push until I approve.
12. You must not deploy until I approve.
13. You must not delete files, rewrite history, rotate secrets, or perform destructive actions without explicit approval.
14. You must not expose, print, or commit secrets.

If you cannot verify any important access or repo requirement:
- Stop.
- Explain what you could not verify.
- Explain why it matters.
- Give me simple step-by-step instructions to fix it.
- Continue only after I confirm it is fixed.

User skill level:
Assume I am a complete beginner who does not understand CI/CD, GitHub Actions, deployment, secrets, environments, terminals, cloud platforms, runners, branches, tokens, or production approvals.

Your job:
Do as much as safely possible yourself. For anything I must do manually, give me exact step-by-step instructions.

Manual-step policy:
Whenever a manual step is unavoidable, present it in this exact format:

Manual step needed: [Short title]

Why this is needed:
[One simple sentence.]

What you need before starting:
- [Item 1.]
- [Item 2.]

Do this:
1. [Exact step.]
2. [Exact step.]
3. [Exact step.]

Copy this:
[Only include safe text to copy. Never include real secrets.]

Where to paste it:
[Exact screen, field, file, or setting.]

How to check it worked:
[Simple verification step.]

Then tell me:
Reply with "[exact phrase]" when done.

Important manual-step rules:
- Keep manual steps to the absolute minimum.
- Do not give me five options unless necessary.
- Recommend one best option clearly.
- If I need to choose, explain the choices in plain English and tell me which one you recommend.
- Never assume I know where GitHub settings are.
- Never ask me to paste real secret values into this chat.
- If a secret is needed, tell me the secret name only and where to paste the value directly in GitHub or the external platform.

Main goal:
Set up a professional, production-ready GitHub Actions CI/CD system for this project.

Default pipeline standard:
- Security checks must run before test, build, and deploy.
- Secret scanning must run on every pull request and push.
- Deployment must be blocked if secrets are detected.
- Dependency and supply-chain checks should be added where supported.
- Static analysis or code scanning should be added where supported.
- Lint, test, and build should run where available.
- Docker build and image scan should run where Docker is used.
- Deployment must only be enabled after I confirm the deployment target and plan.
- Production deployment should use a protected environment and manual approval where possible.
- Prefer short-lived credentials or OIDC over long-lived cloud secrets when the target supports it.
- Never hardcode credentials.
- Never print secrets.

Phase 1: Inspect the repository.

Do the following:
1. Inspect the file tree.
2. Identify the default branch.
3. Detect package managers, frameworks, languages, Docker files, deployment files, test files, and existing GitHub Actions workflows.
4. Check whether this is an app, library, script, static site, API, containerised app, n8n workflow project, monorepo, or something else.
5. If multiple project types are detected, explain them and ask me which path to use.
6. If I say I do not know, choose the safest likely path and ask me to confirm the plan before implementing deployment.

Project detection rules:
- If package.json exists, inspect scripts and dependencies to identify Node.js, React, Next.js, Vue, Svelte, Express, NestJS, or similar.
- If pnpm-lock.yaml exists, prefer pnpm.
- If yarn.lock exists, prefer yarn.
- If package-lock.json exists, prefer npm.
- If requirements.txt, pyproject.toml, Pipfile, or poetry.lock exists, treat it as Python and detect the package manager.
- If go.mod exists, treat it as Go.
- If Cargo.toml exists, treat it as Rust.
- If pom.xml or build.gradle exists, treat it as Java/JVM.
- If Dockerfile exists, support Docker build checks.
- If docker-compose.yml or compose.yml exists, support Docker Compose validation.
- If workflows/*.json, n8n workflow exports, or n8n-specific structure exists, treat it as a possible n8n workflow project.
- If this is confirmed or strongly likely to be an n8n workflow project, use `n8n-workflows/` as the canonical workflow JSON folder and install only the reusable n8n runtime helper scripts from `templates/n8n/` into the target repository at `scripts/`: `export-n8n-workflows-live.ps1`, `import-n8n-workflows-live.ps1`, `n8n-workflow-sync-menu.ps1`, `validate-n8n-workflows.cjs`, `sync-n8n-live-exports.cjs`, `prepare-n8n-live-import.cjs`, `compare-n8n-workflow-credentials.cjs`, `should-import-n8n-workflow.cjs`, `_export-n8n-workflows-live.cmd`, and `_import-n8n-workflows-live.cmd`. Otherwise copy only those helper scripts from the toolkit n8n workflow helper scripts package at https://github.com/weijunswj/ai-agent-toolkit/tree/main/skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/. Do not copy tests, fixtures, reference examples, or docs-only files. Still generate project-specific CI, .gitignore additions, README usage instructions, and CURRENT_CICD_STATUS.md updates dynamically based on the actual target repository structure. Do not run live n8n import/export inside generic CI by default. Never commit .n8n-local/, .tmp/, *.live-export.json, *.live-import.json, credential binding files, or n8n credential exports.
- If index.html exists without a backend, treat it as a static site.
- If the repo is a monorepo, detect each app/package and propose a matrix or workspace-aware CI plan.

Phase 2: Security preflight scan before setup.

Before creating or committing any CI/CD files, scan the current repo for secrets and unsafe files.

Search for:
- .env files.
- .env.* files that may contain real values.
- Private keys.
- PEM files.
- SSH keys.
- id_rsa.
- id_ed25519.
- .p12, .pfx, .key files.
- API keys.
- Access tokens.
- Refresh tokens.
- Webhook secrets.
- Database URLs.
- Cloud provider credentials.
- Hardcoded passwords.
- Hardcoded production credentials.
- n8n credential exports.
- Firebase service account JSON.
- AWS access keys.
- Google service account keys.
- GitHub tokens.
- Slack/Discord/Telegram bot tokens.
- Stripe keys.
- Vercel/Netlify/Railway/Render/Fly.io tokens.

Also check:
- .gitignore.
- Whether risky files are tracked by git.
- Whether risky files appear in recent commits where possible.
- Existing GitHub Actions workflows for unsafe secret printing or hardcoded secrets.

If secrets or risky credentials are found during preflight:
1. Stop setup immediately.
2. Do not create commits.
3. Do not push.
4. Do not print the secret value.
5. Tell me which files are risky.
6. Tell me whether the risky files are tracked by git.
7. Tell me whether the secret appears to be committed.
8. Tell me whether the secret appears to have been pushed, if you can determine it.
9. Tell me exactly how to clean it up.
10. If a secret was committed, recommend removing/amending the commit.
11. If a secret was pushed, tell me to rotate or revoke the secret before continuing.
12. Ask before rewriting git history.
13. Continue only after I confirm the cleanup plan or ask you to prepare safe cleanup changes.

If no secrets are found:
Continue to CI/CD planning.

Phase 3: Create permanent CI/CD security gates.

The final CI/CD setup must include secret scanning as a required gate on every pull request and push.

Add a security job that runs before build/test/deploy.

Minimum security checks:
- Secret scanning using a suitable scanner, preferably Gitleaks by default.
- Dependency review where supported.
- Static analysis or CodeQL where supported by the project language.
- Docker image scanning if Docker is used.
- Safe failure messages that explain remediation without printing secrets.

If a security check fails in CI:
- Fail the workflow.
- Block merge/deploy.
- Print clear remediation instructions.
- Do not print the secret value.
- Tell the user to rotate any exposed secret if it was committed or pushed.

Phase 4: Propose the CI plan.

After inspection and preflight scan, show me this summary before implementing:

1. Project summary.
2. Detected project type.
3. Evidence for that detection.
4. Existing workflows found.
5. Security preflight result.
6. Recommended CI jobs.
7. Recommended security gates.
8. Files you plan to create or edit.
9. Any risks or assumptions.

Use this confirmation format:

I detected this project as: [TYPE]

Evidence:
- [Evidence 1.]
- [Evidence 2.]
- [Evidence 3.]

Recommended CI plan:
1. [Step 1.]
2. [Step 2.]
3. [Step 3.]

Recommended security plan:
1. [Gate 1.]
2. [Gate 2.]
3. [Gate 3.]

Please choose:
A. Yes, implement this CI/security plan.
B. I do not know, use your recommended safe setup.
C. No, explain other options.

Recommended reply:
"Use your recommended safe setup."

Do not implement deployment yet unless I explicitly approve deployment planning.

Phase 5: Implement CI first.

After I approve the CI/security plan:
1. Create or update GitHub Actions workflows.
2. Preserve existing workflows unless they are clearly obsolete or unsafe.
3. If existing workflows conflict, explain the conflict and ask before replacing them.
4. Add .gitignore entries for unsafe files if needed.
5. Add or update .env.example with placeholder values only if environment variables are used.
6. Create or update CURRENT_CICD_STATUS.md as the live source of truth for the CI/CD setup.
7. Add comments in generated workflow files explaining each job.
8. Make workflows clear, maintainable, and production-ready.
9. Use pinned major versions for common GitHub Actions where suitable.
10. Avoid clever YAML that is hard to maintain.
11. Run local validation where possible.
12. Tell me exactly what changed.

CURRENT_CICD_STATUS.md requirements:
- Explain the current CI/CD setup status.
- List the workflow files that exist.
- List the checks that currently run.
- State whether deployment is enabled or disabled.
- List required secrets by name only. Never include real secret values.
- List manual steps still required.
- List what is safe to do next.
- List what must not be done yet.
- Include the current setup branch and PR status, if applicable.
- Include how to rerun or debug the workflow.
- Keep this file updated whenever CI/CD setup changes.

CI workflow requirements:
- Trigger on pull_request.
- Trigger on push to the default branch.
- Allow manual workflow_dispatch.
- Run security checks first.
- Run lint if available.
- Run tests if available.
- Run build if available.
- Fail safely if important commands fail.
- Skip gracefully only when a command/tool truly does not exist.
- Use caching where appropriate.
- Upload artifacts where useful.
- Avoid storing secrets in generated files.

Phase 6: Deployment planning.

After CI is set up, ask me whether I want deployment.

Do not enable deployment automatically.

Ask this:
Do you want this project to deploy automatically after CI passes?

Recommended answer if you are unsure:
"Not yet. Set up CI only first."

If I want deployment, inspect the project and propose the safest deployment target.

Deployment target examples:
- none.
- GitHub Pages.
- Vercel.
- Netlify.
- Cloudflare Pages.
- Render.
- Railway.
- Fly.io.
- Docker VPS.
- AWS ECS.
- Google Cloud Run.
- Azure Container Apps.
- n8n Cloud.
- Self-hosted n8n.
- Custom deployment.

When proposing deployment, show:
1. Detected app type.
2. Best recommended deployment target.
3. Why that target is recommended.
4. Alternative targets, only if relevant.
5. Required secrets by name only.
6. Required manual steps.
7. Production safety plan.
8. Rollback plan.

Use this format:

I recommend: [DEPLOY TARGET]

Why:
[Simple explanation.]

Required secrets:
- [SECRET_NAME_1]
- [SECRET_NAME_2]

Manual steps needed:
- [Step area 1.]
- [Step area 2.]

Production safety:
- Use staging first where possible.
- Use GitHub Environments.
- Require approval before production deploy.

Please choose:
A. Yes, use this deployment plan.
B. I do not know, choose the safest professional setup.
C. No, show me other deployment options.
D. Do not set up deployment.

Recommended reply:
"Use this deployment plan."

Phase 7: Implement deployment only after approval.

After I approve the deployment plan:
1. Create deployment workflow or extend the existing workflow.
2. Use GitHub Secrets for credentials.
3. Use environment-specific secrets where appropriate.
4. Use protected production environments where possible.
5. Add staging before production where practical.
6. Add smoke tests after deployment where practical.
7. Add rollback instructions or rollback workflow where practical.
8. Update CURRENT_CICD_STATUS.md with deployment status, required secrets, manual steps, and rollback notes.
9. Never hardcode secrets.
10. Never print secrets.
11. Ask before pushing.
12. Ask before triggering production deployment.

Phase 8: GitHub Secrets guidance.

If secrets are needed, guide me step-by-step.

Use this exact style:

Manual step needed: Add GitHub secret

Why this is needed:
GitHub needs this private value during CI/CD, but it must not be saved in your code.

What you need before starting:
- Your GitHub repository open in a browser.
- The secret value from the external platform.

Do this:
1. Open your GitHub repository.
2. Click Settings.
3. In the left sidebar, click Secrets and variables.
4. Click Actions.
5. Click New repository secret.
6. In Name, type: [SECRET_NAME]
7. In Secret, paste the secret value directly into GitHub.
8. Click Add secret.

Copy this:
[SECRET_NAME]

Where to paste it:
Paste the name into the Name field. Paste the real secret value only into GitHub's Secret field.

How to check it worked:
You should see [SECRET_NAME] listed under Repository secrets.

Then tell me:
Reply with "[SECRET_NAME] added" when done.

Important:
Do not paste the secret value into this chat.

Phase 9: Commit, branch, pull request, and push policy.

Default rule:
Do not push directly to the default branch unless I explicitly approve direct push.

Preferred professional flow:
1. Create a new setup branch for the CI/CD changes.
2. Commit the generated CI/CD changes on that setup branch.
3. Push the setup branch.
4. Create or guide me to create a pull request.
5. Let GitHub Actions run on the pull request.
6. Merge only after required checks pass.
7. Deploy only from the approved deployment branch after checks pass.

Why:
This prevents broken or unsafe CI/CD changes from landing directly on the main branch.

Before committing:
1. Show me all files changed.
2. Explain why each file was changed.
3. Confirm no secrets are included.
4. Confirm .env and other unsafe files are ignored.
5. Confirm CURRENT_CICD_STATUS.md is created or updated.
6. Ask me whether to commit.

Before pushing:
1. Tell me which branch you will push to.
2. Tell me whether this is the default branch or a setup branch.
3. If it is the default branch, stop and ask for explicit approval before pushing.
4. Tell me what workflows will run after push.
5. Ask me whether to push.

Pull request policy:
1. Prefer opening a pull request instead of pushing directly to the default branch.
2. If you can create the pull request, ask me before creating it.
3. If you cannot create the pull request, give me click-by-click instructions to create it in GitHub.
4. Tell me that merge should happen only after required checks pass.
5. Do not bypass failing checks.
6. Do not force-merge.

Do not commit, push, create a pull request, merge, or deploy without my approval.

Phase 10: Final output.

After setup is complete, give me:

1. What was installed.
2. Files created or changed.
3. Where CURRENT_CICD_STATUS.md is and what it says is still pending.
4. What CI checks will run.
5. What security checks will run.
6. Whether deployment is enabled.
7. What secrets I still need to add, by name only.
8. What manual steps remain.
9. How to test the workflow.
10. How to read failures in GitHub Actions.
11. Recommended next step.

Keep the explanation simple, but do not hide important technical details.
```
