Title: controller settings and owner-line lint

### Added

- Controller settings: `toolkit-controller-settings.cjs` keeps the stack profile, the number of live lanes and where gates run (by default, per gate, device and folder) in one file the controller saves to the evidence store at `state/<owner>/<repo>/controller-settings.json`. Only a controller changes it, on the owner's words, which are kept with each change; a gate session is refused, and every write is read back.
- The project lines (lanes, stack profile, where gates run) and the `GATE ROUTE:` memory line are rendered from the settings; `toolkit-projects-instructions.cjs --render --settings <file>` prints the lines after the block.
- Owner-line lint: `toolkit-owner-lines.cjs check` reads the owner's own lines in any controller's instructions or memory and offers one-tap fixes for a line that repeats or contradicts the settings, overrides the block's post format, repeats a block line or says another owner line again in other words. Every other line is left alone and listed as not read. `apply` changes only the fixes the owner tapped and reads the file back.
- `toolkit-controller-check.cjs --owner-lines <file> [--settings <file>]` runs the lint on any host.

### Changed

- The `GATE ROUTE:` line also names the live lanes: `GATE ROUTE: profile <profile> lanes <n> placement <...> [folder <path>]`.
