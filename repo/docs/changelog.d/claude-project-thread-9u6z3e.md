### Fixed

- **Going back a folder:** the merge hold now reads `cd -` and `Set-Location -` as a step back to the folder before (bash's previous folder, or any folder in PowerShell's location history) instead of a folder named `-`, so `cd <store>; cd -; git push origin main` is judged in the folder the push really runs in. A push after a step back to a folder the same command never showed, or after `pushd +N`/`-N`, is refused with advice to name the folder.
- **Switches are not folders:** `Push-Location <folder> -PassThru`, `-StackName <name>`, `-Path`/`-LiteralPath`, `cd -L`/`-P`, `pushd -n` and cmd's `cd /d` now give the merge hold the real folder.
- **Timing test:** the closure scanner timing test may now grow its baseline to 2 MiB, so a fast Windows runner no longer compares a sample of under 5 ms.
- **Re-runs clear CI:** each run attempt of a test shard uploads its own summary artifact, and the `validate` check keeps the newest attempt of each shard, so re-running a failed shard can turn `validate` green.
