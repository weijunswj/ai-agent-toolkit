Title: controller settings and owner-line lint

### Added

- Controller settings: `toolkit-controller-settings.cjs` keeps the stack profile, the number of live lanes and where gates run (by default, per gate, device and folder) in one file the controller saves to the evidence store at `state/<owner>/<repo>/controller-settings.json`. Only a controller changes it, on the owner's words, which are kept as said with each change and with the setting; a gate session (by its launcher mark or its brief) and a launcher-bound helper are refused, and every write goes through a temporary file over unchanged bytes and is read back.
- The project lines (lanes, stack profile, where gates run) and the `GATE ROUTE:` memory line are rendered from the settings, and the lanes line names the owner and date only where the owner gave the number; `toolkit-projects-instructions.cjs --render --settings <file>` prints the lines after the block.
- Owner-line lint: `toolkit-owner-lines.cjs check` reads the owner's own lines in any controller's instructions or memory and offers one-tap fixes for a whole line that repeats or contradicts the settings, overrides the block's post format, or is a block line or another owner line again. A line it does not understand whole, or that does not stand on its own, gets no fix; a near copy is only a hint; a second line with another value is shown as a conflict. `apply` writes only the fixes the owner tapped, exactly as they were shown, changes no other byte, and refuses when the file, the settings or their repository changed.
- `toolkit-controller-check.cjs --owner-lines <file> [--settings <file>]` runs the lint on any host.

### Changed

- The `GATE ROUTE:` line also names the live lanes: `GATE ROUTE: profile <profile> lanes <n> placement <...> [folder <path>]`.
