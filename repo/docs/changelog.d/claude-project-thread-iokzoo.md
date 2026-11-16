### Changed

- Gate route check: the per-launch `Route override:` brief line is retired, so every gate runs on its stack-registry pin. A gate brief that still carries the line is refused with a plain reason, and an old route stamp carrying ` override=` reads off its pin, so the merge train finder never boards it. The controller roles page, the Projects skill launch rule and the merge train notes drop the override wording.
