Title: the daily check-in offers the saved skill update

### Claude Projects

- **Added:** the daily check-in reads the Version of the owner's saved claude.ai copy of the Projects controller skill and reports `SKILL CARD OUTDATED: saved <old>, main <new>` when it is older than the guidebook. The coordinator offers the update card the same turn with `propose_skills`, once per Version: a Version already offered, dismissed or refused is never offered again, and a refused card is never routed to hand upload. Threads and new chats load the saved copy, so it now stays current in every project, not only when someone remembers to offer a card.
- **Changed:** the check-in's purpose line and the skill's Daily check-in section say that where no agent can make an update (the plugin and the saved skill card), the coordinator guides the owner with the exact step.
