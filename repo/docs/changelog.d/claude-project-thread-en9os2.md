### Added

- Every skill now has one class in `repo/contracts/skill-publication.json`: portable (works anywhere) or Toolkit's own (runs Toolkit itself). The skill portability audit fails when a portable skill picks up a new Toolkit word, or names an agent app without a written reason; mentions already there sit in a baseline that only shrinks, checked against the change's base commit.
- The README splits the skill table into portable skills and Toolkit's own skills, and the audit keeps each skill in its class's table.

### Changed

- The contract is the one record of skill classes: the Skill Safety Matrix Packaging table and the Antigravity copier's Toolkit-only list follow it, and validation fails on any mismatch. `repository-agent-rules` and `toolkit-playbooks` are now Toolkit's own, so the Antigravity portable copy leaves them out; setup removes Toolkit's earlier global copies of them.
