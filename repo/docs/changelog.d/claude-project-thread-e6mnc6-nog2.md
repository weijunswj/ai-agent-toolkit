Title: scripted review carry

### Merge trains

- **Scripted review carry:** three kinds of pull request now board a merge train with no fresh G2, each only inside an exact check (`repo/scripts/toolkit-review-carry.cjs`), with green required checks, one `Bump:` line, an accepted `UAT:` line and no footer or other personal data in the title or body. Anything else, or any doubt, still needs the normal G2.
  - **Body-only FAIL:** a G2 that failed a pull request only for its description adds `Carry: body-only uat=<state>` under its verdict's route stamp. Once the body is fixed, the same head boards on that verdict, as long as the body keeps that UAT state or makes it `OWNER_TEST_NEEDED`. A weaker UAT line needs a fresh G2.
  - **Shard-timing refresh:** the bot's `toolkit/shard-timings-*` pull request that changes only the shard manifest, and only its measured times and which shard runs which file. Budgets, every other key and each system's set of files must stay as they were. Its body now carries `UAT:` and `Bump: none` lines and names this route.
  - **Generated sync:** a pull request that changes only files the two instruction syncs write (each sync now lists them as `PROJECTED_OUTPUTS`): whole projected files, or managed blocks with the hand-written rest unchanged. CI's sync checks prove the generated text matches its sources.
- **RISKY keeps the owner's card:** the shard manifest and instruction files are RISKY, so a carried pull request of those still waits for the owner's merge card.
- **Wording-only docs:** a G2 brief with `Review class: wording-only` may run at high on the reviewer's pinned model, and the gate route check accepts it. `find` accepts that high stamp only when every changed file is a LIGHT `.md` file.
- **Rules:** the gate rules name the carry and the wording-only route.
