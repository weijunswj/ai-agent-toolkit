# Invariant Models And Closure Matrices

Use this playbook before building or reviewing any feature that touches authority (who may approve or act), custody (who holds evidence, state or files), a state machine, or a host's configuration (for example Codex `config.toml` or Claude Code `settings.json`).

## Why

Point fixes found one path at a time miss the paths nobody listed. A written model and a matrix that covers every combination make the missing path visible before the code exists, and give review something complete to check against.

## G0 delivers

1. **Invariant and custody model.** In plain words: the roles, the states, and for each state who may do what, what must always be true, and who holds which data or evidence. Name the source of every external limit.
2. **Closure test matrix.** One row per combination that can happen:
   - commands or actions x states x roles, for authority, custody and state machines;
   - config keys x the host's documented or source-backed limits (minimum, maximum, allowed values, defaults), for host configuration. Cite the doc or source line for each limit; a value with no source is an open question, not a valid value.
   Each row states the expected result (allowed, refused, repaired, rolled back) and why.

## G1 builds

- Implement the matrix as table-driven tests: one table, one row per matrix row, the expected result asserted for each. Add a row before fixing any path the matrix did not cover.
- For host configuration, also verify after each write that the host actually loads the file, roll back automatically on failure, and in UAT restart the real host and complete one successful turn for every config-writing path, including "all recommended".

## G2 reviews

- Review against the model and the matrix, not only the diff: is every reachable command, state, role or key covered, and does each row's test prove its expected result?
- A recheck that finds a path missing from the matrix sends the matrix back to G0-level revision (model, matrix and tests together), not a one-line patch.
