### Changed

- Programme catalogue entries can be pinned last with `last: true`. A pinned open task sorts after every other open task in the Programme Graph, the Start next pick and the native sub-issue order, so a final clean-up task stays last however many tasks the sweep adds later. Pinned tasks tie only with each other, and the graph's order line names them while one is open. Set the pin only once every copy that reads the parent runs this release: older copies refuse `last` as an unknown field.
