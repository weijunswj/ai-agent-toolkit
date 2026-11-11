Title: Controller enforcement map

### Added

- A map says, for every controller rule, what enforces it: a hook, a script, a CI check or the programme reconciler, each with the test that proves it and one line on which part of the rule they cover. A rule nothing can enforce is marked instruction-only, with one line on why. Of the 40 rules today, 17 are enforced and 23 are instruction-only. The map lives beside the rules, so the rules files gain no bytes.
- A check fails when a controller rule has no row or two, when a row matches no rule or more than one, or when a row names an enforcer or test that does not exist or a test that never mentions its enforcer. It runs with the test suite, so a rule added, moved or reworded without updating the map fails CI.
