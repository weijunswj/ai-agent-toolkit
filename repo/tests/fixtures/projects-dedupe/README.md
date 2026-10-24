# Projects dedupe fixtures

Project-instruction lines from outside the Toolkit markers, shaped like two real projects and rewritten with fake names, paths and numbers. `toolkit-projects-instructions.test.cjs` checks the overlap hint against them: the "before" files carry lines that repeat the block, and the "expected" files are what the dedupe rule in the Projects skill leaves (full repeats removed, partial repeats trimmed and labelled, conflicts and project-only rules kept word for word).
