### Fixed

- **Large state documents, single reads:** a gate, checkpoint or other single read of a state document over 1 MB now reads it whole by its blob id. The Contents API leaves out the text of such a file, so these reads used to stop with "too large to read".
