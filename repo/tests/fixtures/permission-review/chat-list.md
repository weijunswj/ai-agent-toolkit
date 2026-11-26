**Toolkit permissions (Claude Code):** Toolkit lines 6 missing · Other lines 23 to review

🔵 **Toolkit: 4 to add (6 lines)**
- programme.cjs gate-session · computer
- auto mode rule for merges Toolkit's merge hold lets through · computer
- gh pr comment, with its ask line · automation
- gh issue comment, with its ask line · automation

🔴 **Risky (4)**
- **R1** Any web address · computer
- **R2** Any GitHub call, merges and deletes included (gh api) · automation
- **R3** Runs any code (python -c) · automation
- **R4** Any web address · automation in Git

🟡 **Dead (8)**
- **D1** python -I scan-old.py · computer
- **D2** bash probe-a.sh · automation
- **D3** bash probe-b.sh · automation
- **D4** cat run-1.log · automation
- **D5** cat run-2.log · automation
- **D6 to D8:** 3 more, all automation. Say show all to list them.

🟢 **Yours (11)**
- **Y1** python -I report.py, any arguments · computer
- **Y2** Web search · computer
- **Y3** scheduled-tasks tool create_scheduled_task · computer
- **Y4** scheduled-tasks tool list_scheduled_tasks · computer
- **Y5** DEPLOY_TOKEN=<hidden> node ping.js · automation
- **Y6 to Y11:** 6 more. Say show all to list them.

Lines marked in Git sit in the repository's shared settings file; they change only through a pull request.

**Reply** keep all, or name what goes, such as remove D1-D8. Nothing changes until you press Enter in your own terminal.

**To bring Toolkit's lines up to date and keep everything else**, run this in your own PowerShell. It shows the changes and waits for your Enter:

```powershell
node "/opt/toolkit/repo/scripts/toolkit-permissions.cjs" --apply --host claude --repo-root "/work/automation"
```
