Title: gate route check and route stamps

### Gate routes

- **Gate route check:** the governance hook now refuses a G0, G1 or G2 session's state-changing tools while the host's own record (the hook input's effort, `CLAUDE_EFFORT`, and the model the CLI wrote to the session transcript) is off its stack-registry pin. The session can still post why it stopped. A session is a gate when a Toolkit launcher marked it or its brief has a `Gate:` line; a brief-declared gate also carries `Route: <profile> <member> <model>/<effort>`.
- **Owner overrides:** a temporary owner change of a gate's model or effort is one brief line, `Route override: <member> <model>/<effort> owner=<rec N or cmsg id>`, for that launch only. Without the owner citation the registry pin stands.
- **Route stamps:** G0 plans, G1 pull request bodies and G2 verdicts carry one `Route:` stamp line: `host-verified`, `launcher-attested` (the host shows no record, so the launcher's Route line stands in) or `UNVERIFIED`. `node repo/scripts/toolkit-gate-route.cjs stamp` prints a session's own stamp, and the hook refuses a verdict or G1 body whose stamp is not the session's own.
- **Merge train acceptance:** `find` refuses a pull request whose G1 or G2 stamp is off its pin, and a RISKY one whose stamp is missing or `UNVERIFIED`.
- **Rules:** the roles and routes page, the gates page, the gate rules' route proof and the Projects controller skill's gate launch line say so; the Projects line now says to set the model and effort pin explicitly on every gate launch.
