### Fixed

- **Store push refusal wording:** when the default-branch merge hold refuses a raw `git push` that targets an evidence store bound on this computer, it now shows the store-command message (use `toolkit-store.cjs save`) instead of telling the agent to push another branch and open a pull request, which is wrong for a store. The push stays refused. Before this, that advice could make an agent refuse to run the store command too.
