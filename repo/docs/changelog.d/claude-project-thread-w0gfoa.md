Title: auto-merge without a label

### Changed

- Task auto-merge no longer uses a label. With the owner's yes merged in the programme binding, the controller merges any pull request once the gate conditions hold on one head. Only pull requests that change the merge rules themselves (the programme binding, its schema and reader, the merge hold and its helpers, the scope check, the controller, global and gate rules, the Approvals section of the Projects controller skill, CI workflows) or make a major version bump wait for the owner's typed `merge N`. Hooks, setup and agent instruction files leave that list: their risk tier already holds them for full review and owner testing.
- The merge hold runs the merge-scope check on this computer, on the head a no-typed-approval merge names, before letting it through. A head it has not fetched, or a scope it cannot read, needs a typed merge.
- The task auto-merge answer no longer needs a required `auto-merge-eligible` check, so `toolkit governance check` no longer reports a yes as not enforceable.

### Removed

- The `auto-merge-eligible` workflow, its `toolkit-owner-merge` label, the commit status that tied the label to a head, and the merge hold's refusal of commands that name the label.
