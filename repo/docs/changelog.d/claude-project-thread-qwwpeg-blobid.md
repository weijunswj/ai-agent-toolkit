### Fixed

- **State commit read-back:** the check after a state commit now compares every written file with Git's own blob id of the written text, computed locally. It no longer depends on how GitHub shapes its answer for a created tree, which may list only the top-level folder of a nested file. An id GitHub does list must agree, and any mismatch is refused.
