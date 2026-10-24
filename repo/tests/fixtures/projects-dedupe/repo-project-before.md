Goal: drive example-owner/example-repo parent programme 12 to completion under Toolkit governance.

Order of precedence: the owner's current request > the web-controller-projects skill > Toolkit CONTROLLER.md (bound from ai-agent-toolkit main, revision checked before each launch) > the repo's AGENTS.md. Written rules beat remembered governance.

Roles: the project-chat Claude (coordinator) is the sole Web Controller and main decision-maker. Every thread is an executor: it follows its role packet (G0/G1/G2, reviewer or helper) and the repo rules, never takes Controller authority, never re-plans the programme, and touches parent records only when the packet says so. G2 reviewers never write fixes.

Where work runs (hybrid):
- local rc on the owner's laptop (C:\Users\example\GitHub\example-repo) only for: G0/G1/G2 executor runs, the owner's UAT, installs and setup checks, and files that exist only on the laptop.
- Cloud (coordinator workers or cloud threads) for everything else: read-only checks, research, issue records and comments, and TRANSPORT-example-repo uploads (manifest + read-back).

Approvals: ask the owner before anything hard to undo or outward-facing: closing issues/PRs, deleting branches, merging, production or VM changes, live mail and shop writes, emails to outside people. Destructive git on the laptop runs only when the owner types it in the local rc thread.

Data: no personal data in the repo or PR text (example.com fakes). Real values only in runtime settings or the transport store.
