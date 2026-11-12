Title: Projects follows local Toolkit as its base

### Added

- **Projects base rule:** the Projects controller skill now opens with the rule that local Toolkit (global, gate and governed rules and the controller file) is its base. Every place Projects differs is a row in the new overrides list with the owner's decision; any other difference is a clash for the owner.
- **Projects task auto-merge switch:** the gate rules name Claude Projects as a third app. Its switch is the project line `- Task auto-merge: On`, and its one named merge thread stands in for a session the owner started. The skill's Approvals section gives the cloud merge route: eligibility check at the exact head, effects notice, head-pinned merge commit, or the owner's card tap at that head.
- **Cloud hook table:** a new reference table says, for every hook in the plugin manifest, how its rule is covered in cloud sessions. A test fails when a hook has no row.
- **Weekly base clash check:** a new task step compares the base files with the copy the guidebook names, and raises each new clash as an owner question. The daily check-in runs it when a week has passed and no weekly audit covers it.
- **Guidebook BASE file:** the guidebook copy now carries `BASE`, the git blob SHA of each base file, so a coordinator can tell which base its copy follows.

### Fixed

- **Governance status in cloud sessions:** a Claude Code cloud container's own git rewrite (ssh spellings of github.com to canonical https, no credential prompts) no longer holds the binding read, so `toolkit governance status` reads the merged binding there. Any other command-scope config stays held.
- **Hook status lines:** `toolkit governance status` no longer says cloud sessions and Claude Projects have no hooks; account copy hooks run there, with the governance holds advisory.
