### Added

- `agent-cost-control` has a "Before you start a subagent" section, read once per chat before any subagent, helper agent or spawned thread: start one only for separable work that saves time or context, set the cheapest tier and effort on the launch, brief it with the data it needs, and get approval first for anything not cheaper than yourself (the same route, a higher tier or effort, any maximum effort, or a launch that inherits your route). A subagent that starts another applies the same test against its own route.
