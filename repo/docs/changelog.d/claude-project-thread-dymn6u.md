### Changed

- **Typed governance commands:** `toolkit governance status`, `check`, `discover`, `catalogue` and `security`, typed as a whole message, now tell the agent to run exactly that subcommand of `toolkit-governance.cjs` and nothing in its place. Typing `toolkit governance check` used to run `status` and the programme attention list instead. `toolkit governance migrate` gives you the command to run in your own terminal, because it asks for its own typed yes. `enable` and `disable` stay answers the governance gate reads. The command list and How to use show them all.
