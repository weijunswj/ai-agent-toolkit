### Fixed

- **No rule files under `.agents/rules/` in Toolkit:** the instruction sync check now refuses any file or link under Antigravity's `.agents/rules/` folder in this repository, matched in any letter case, not only the retired bootstrap file. A linked rule folder or file is named by its own path and never followed. `--write` never adds, rewrites or removes one; remove it by hand.
