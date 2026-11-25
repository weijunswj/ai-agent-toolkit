Title: questions asked the app's own way

### Changed

- **The merge card says what it does:** its Merge option now reads "Merges pull request N of owner/name into its base branch, at commit <full SHA>. Nothing else is approved." Toolkit builds the line from the merge it refused and reads no pull request title for it, so no one else's text reaches the card. Any other wording, pull request or repository records nothing.
- **Merge train `land`, route owner:** the agent gives the effects and runs the merge, and the merge guard's card is the one ask. The agent asks first only where no guard is known to run, or where task auto-merge is on and the guard may let the merge through unasked.
- **Task auto-merge needs no card:** with the switch On, a pull request the auto-merge check accepts, with its other gate conditions met, lands with no card or question at any tier, scripted carries included; the controller posts one short notice after (what landed, its effect, how to undo it) and runs the check before telling the owner a card will open. A refused one keeps the card, and a merge train with a RISKY member keeps it too. The shard refresh body and the train's `land` say the same. What the merge guard allows or refuses is unchanged.

### Removed

- **The question-card check in Claude Code:** a question card after text in the same turn, or with a question over 120 characters, is no longer refused. Agents ask with the app's own question method. The merge card, the governance question and the redirect of an agent's own merge question are unchanged.
- **How-to-ask rules:** the controller principles, the takeover and the standing permission asks no longer say where the context or the card goes; the global rules' one line stays (the harness's own question method, clear on its own).
- **The typed-command note:** the Claude Code and Codex prompt hooks no longer add a line for a typed Toolkit command. Every command still works: the Toolkit setup skill, whose description now also names `refresh governance`, reads the message and runs `toolkit-commands.cjs`.
