Title: pull request body pre-flight

### Pull request bodies

- **Pre-flight before every write:** `node repo/scripts/toolkit-pr-body.cjs --body-file <draft> --title "<title>" --out <clean file>` removes every line holding an AI footer, a claude.ai session or project-thread link or the Projects attribution marker, then checks the cleaned body with the same personal-data guard CI runs, the UAT line rule and, in the Toolkit repository, the one `Bump:` line rule. In a repository with no guard config it uses a default with pull request text and AI attribution on and says so; a guard block whose report it cannot read counts as not ready. Builders run it before opening a pull request and before every body edit, so a body they write already passes the body checks instead of failing and costing a full run and a review round (a cloud create still gets the route's footer, which the update right after it removes).
- **Footer-free writes from the cloud:** the PR review and git completion playbooks now say to write pull request bodies with the GitHub connector, never cloud `gh`, and to read them back; the footer a cloud create still gets is cleaned once with the connector's update call.
- **Projects briefs:** every G1 brief asks for a body that passed the pre-flight; the merge card steps and the cloud hook parity table point at it.
