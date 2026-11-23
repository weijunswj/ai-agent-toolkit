### Fixed

- Commands typed through the Claude desktop app's Terminal panel now get the same checks as the Bash tool: a merge without the owner's approval, a chat launched to merge, a push to the default branch and a write to Toolkit's user-state folder are refused there too. Terminal panel and Monitor commands also get the AI attribution, force-push and credential checks. A test fails CI when a tool that runs a command line misses any of these checks.
