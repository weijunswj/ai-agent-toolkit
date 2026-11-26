**Toolkit permissions (Claude Code): your picks**

- **Remove:** 9 lines: R2 and D1 to D8
- **From:** computer (1), automation (8), 3 worktree copies (8 each)
- **Keep:** 14 other lines, and every other setting
- **Add:** 6 Toolkit lines
- **Backup:** one folder, made before anything changes

Run this in your own PowerShell. It shows the same changes and waits for your Enter:

```powershell
node "/opt/toolkit/repo/scripts/toolkit-permissions.cjs" --apply --host claude --repo-root "/work/automation" --drop R2,D1-D8 --preview 7897d53f
```
