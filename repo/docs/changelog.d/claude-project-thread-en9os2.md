### Added

- Every skill now has one class in `repo/contracts/skill-publication.json`: portable (works anywhere) or Toolkit's own (runs Toolkit itself). The skill portability audit fails when a portable skill picks up a new Toolkit word, or names an agent app without a written reason; mentions already there sit in a baseline that only shrinks.
- The README splits the skill table into portable skills and Toolkit's own skills, and the audit keeps each skill in its class's table.
