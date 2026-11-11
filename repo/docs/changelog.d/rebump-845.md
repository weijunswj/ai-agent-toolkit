Title: Controller core plus pages

### Changed

- Split `repo/CONTROLLER.md` into a small core that every controller always loads and three pages under `repo/controller/` that are read at the step they cover: roles and routes, gates, and evidence, progress and finish. Every rule moved word for word; only the relative link paths inside the pages changed.
- The core's new Pages section lists each page with a short hash of its content, so a page change also changes the core file and one bound CONTROLLER.md blob still covers every rule. `node repo/scripts/sync-controller-pages.cjs --write` refreshes the hashes, and the check fails on a stale hash, an unlisted or missing page, a rule with two homes or a broken link.
- Lowered the core's size budget from 18,500 to 9,500 bytes and gave each page a 5,000-byte budget.
- The pages are RISKY and always need the owner's merge OK, like the core, and both plugin setups check them in the installed copy.
