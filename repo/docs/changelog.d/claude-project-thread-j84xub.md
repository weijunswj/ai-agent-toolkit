### Fixed

- **Principles page checked like its sibling pages:** setup verify for Claude Code and Codex now checks that an installed plugin carries an unchanged copy of the controller principles page, the Projects guidebook `BASE` lists it, so the weekly base clash check compares principle changes with the Projects skill, and the lane map gives it an owner. Tests now take the page set from the controller file's Pages section, so a page added later cannot be left out of these lists.
- **Base clash check reads new base files in full:** a file newly added to `BASE` has no saved blob to diff against, so the weekly check now reads its whole text.
