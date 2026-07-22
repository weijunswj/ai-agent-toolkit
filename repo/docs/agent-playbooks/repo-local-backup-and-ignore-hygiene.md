# Repo-Local Backup And Ignore Hygiene

Use this playbook for Toolkit-managed repo-local repairs that need recovery material, or when checking the ignore status of Toolkit backup folders.

## Folder Policy

- New Toolkit-created repo-local backups use `/_agent-toolkit-backups/`.
- `/.agent-toolkit-backups/` is a legacy compatibility location. Detect and report it, but never select it for a new backup.
- Never move, merge, rename, rewrite, or delete either backup folder or any completed backup generation.
- Do not change retention and do not use a generic backup glob.
- Unrelated `.staging-*` directories and user-level operational backup systems are outside this contract.

## Detection And Ignore Choice

Use `repo/scripts/repo-ignore-hygiene.cjs` from the Toolkit source or installed Toolkit bundle. `status` and `preview` are read-only:

```powershell
node repo/scripts/repo-ignore-hygiene.cjs status --repo "C:\path with spaces\repository"
node repo/scripts/repo-ignore-hygiene.cjs preview --repo "C:\path with spaces\repository" --choice gitignore
node repo/scripts/repo-ignore-hygiene.cjs preview --repo "C:\path with spaces\repository" --choice exclude
```

Detection requires the repository root and inspects:

1. Root `.gitignore`.
2. The real Git local exclude path returned by `git rev-parse --git-path info/exclude`.
3. Effective Git matching for `/_agent-toolkit-backups/` and `/.agent-toolkit-backups/`.
4. Narrow anchored or unanchored equivalent rules in either file.
5. Presence of both folders without reading, migrating, or modifying their contents.

The structured result reports `.gitignore`, `.git/info/exclude`, both, or not-covered for each folder. A broader pattern counts only when Git demonstrates that it covers the exact folder probe; the reported evidence identifies it as broader coverage. Toolkit never adds a broader pattern.

Choose one explicit preview outcome:

- `gitignore`: add only missing `/_agent-toolkit-backups/` and `/.agent-toolkit-backups/` rules to the tracked repository file.
- `exclude`: add only the same missing narrow rules to local-only `.git/info/exclude`.
- `decline`: make no change.
- `proceed-warning`: make no change and retain an explicit unresolved-hygiene warning; a parent operation may continue only when it remains safe without ignore coverage.

The preview shows the exact target, coverage, exact lines, tracked versus local-only consequences, dirty-working-tree consequence, folder presence, and the no-move/no-delete guarantee. Mutation requires the current preview's exact `approval_digest`; empty input, EOF, timeout, partial input, an unrelated `--yes`, or an earlier setup answer is not approval.

```powershell
node repo/scripts/repo-ignore-hygiene.cjs apply --repo "C:\path with spaces\repository" --choice gitignore --approval-digest "<digest from this exact preview>"
```

The editor appends only missing rules, preserves existing bytes, comments, ordering, Unicode, LF or CRLF, and the existing final-newline state. A missing ignore file is created only after approval. A missing local exclude parent is created only after Git proves the target is inside a real repository. Paths are passed as arguments and never interpolated into a shell command.

## Passive Boundary

SessionStart, hook inspection, audit, plan, preview, status, and ordinary setup question rendering may report missing rules and folder presence. They must not write ignore files, create a backup, or repair repo content. Only an active setup or repair operation with current exact approval may call the mutation API. The contract never stages or commits changes automatically.

## Backup Creation Contract

Use `createRepoLocalBackup` from `repo/scripts/repo-local-backup.cjs`. A backup is mandatory immediately before a Toolkit-managed operation replaces, removes, or creates a repo-local file when exact rollback is part of the operation contract. Capture all affected paths in one operation generation before the first target mutation.

The API:

- writes only under `/_agent-toolkit-backups/`;
- uses `<operation>-<UTC timestamp>-<nonce>` generation names and deterministic numeric collision suffixes;
- creates a hidden incomplete generation first and publishes a completed generation only after all payloads and `restore.json` are durable;
- accepts `full-file` or `managed-region` scope while retaining full original file bytes for exact recovery;
- records repository-relative affected paths, original existence, mode where portable, byte size, SHA-256, LF/CRLF/mixed state, final-newline state, and the expected post-operation existence/size/checksum;
- records only a SHA-256 repository identity, operation ID, UTC timestamp, schema, and retention flag;
- never stores file contents, absolute repository paths, secrets, credentials, environment values, tokens, or connection strings in metadata;
- rejects affected paths whose first normalized segment is `_agent-toolkit-backups` or `.agent-toolkit-backups`, so the recovery API cannot back up its own canonical or legacy evidence;
- never deletes a completed generation automatically.

Schema `ai-agent-toolkit.repo-local-backup.v1` is the only supported schema. Unknown or future schemas fail closed.

The parent operation must perform its mutation transactionally after backup creation. If the parent mutation fails, it must invoke the same exact restore route before returning failure. It must not advance managed state unless target verification succeeds.

## Inspection And Restore

Inspection validates the metadata and backup payload checksums without changing the repository:

```powershell
node repo/scripts/repo-local-backup.cjs inspect --repo "C:\path with spaces\repository" --metadata "_agent-toolkit-backups/<generation>/restore.json"
```

The supported restore route is:

```powershell
node repo/scripts/repo-local-backup.cjs restore --repo "C:\path with spaces\repository" --metadata "_agent-toolkit-backups/<generation>/restore.json"
```

Restore validates the known schema, repository identity, direct completed-generation topology, repository-relative paths, protected backup-root segments case-insensitively on every platform, no traversal or outside-repository resolution, and the exact expected current replacement state before writing. It resolves the completed generation and every payload ancestor, rejects symbolic links and Windows junction/reparse-point traversal where the platform exposes it, requires the payload leaf to be a regular non-link file beneath that exact resolved generation, and performs these checks before reading payload bytes. During preparation it repeats payload topology validation immediately before and after each read, then checksums the exact bytes read against metadata before writing a restore temporary. Payload substitution and checksum drift therefore fail before target mutation. Restore writes exact original bytes, so LF/CRLF and final-newline behavior are preserved. A file that was originally missing returns to missing.

Preparation is part of the protected transaction boundary. Restore never creates target parent directories: every target parent must already exist as a real directory and must not resolve through a symbolic link, junction, or reparse-point alias. Restore builds an incremental prepared list and removes every earlier private restore temporary if a later payload read, parent validation, or temporary write fails. No target is mutated until every payload is prepared. Cleanup failure is fail-closed and routine output does not disclose private absolute temporary paths.

Each target uses same-directory rename transactions. For a multi-file restore, the current replacement is held in a private rollback sibling until all targets succeed. An injected partial failure reverses already-applied targets to their exact pre-restore bytes and fails visibly. Checksum mismatch or uncertain topology fails closed. Restore never touches unrelated files and never removes the completed backup.

Each restore transaction generates one cryptographically random opaque cleanup ID containing exactly 24 lowercase hexadecimal characters. The target path, completed-generation identity, and cleanup ID derive exactly one rollback sibling per affected target. Restore rejects a pre-existing exact rollback destination before mutation. It never scans, enumerates, selects, or removes rollback candidates by filename prefix.

Rollback-temporary cleanup retries the bounded transient Windows conditions `EPERM`, `EBUSY`, and `ENOTEMPTY`. Exhaustion returns `status: cleanup-incomplete`, includes `cleanup_id`, exits the CLI non-zero, and reports that exact target restoration completed while private residue remains; it does not roll back an already verified restore or reveal the residue path. `cleanup_id` is returned only for `cleanup-incomplete`. After the filesystem lock is released, retry only the exact metadata- and cleanup-ID-bound route:

```powershell
node repo/scripts/repo-local-backup.cjs cleanup --repo "C:\path with spaces\repository" --metadata "_agent-toolkit-backups/<generation>/restore.json" --cleanup-id "<ID returned by cleanup-incomplete>"
```

Cleanup first validates the cleanup ID, then revalidates the metadata, payloads, repository identity, and restored target bytes. It addresses only the one exact rollback path derived for each target and never deletes unrelated files. A missing or malformed cleanup ID is rejected before mutation. A wrong but well-formed ID returns `cleanup-not-found` and removes nothing. Both `cleanup-not-found` and `cleanup-incomplete` are non-success CLI results. Completed backups remain intact; no canonical or legacy backup migration, merge, rename, rewrite, or deletion occurs.

## Native UAT And Later Consumers

After merge, #247 Batch D owns native Windows UAT. Use disposable repositories covering absent/present canonical and legacy folders, tracked and local-only choices, approval/decline/warning, LF/CRLF, no-final-newline, paths with spaces and shell metacharacters, exact restore, originally missing files, injected partial failure, idempotency, no migration/deletion, and clean `git status` for local exclude.

Later #243 repo-local refresh and other managed-block repairs must import these shared modules rather than create another folder name, ignore parser, backup schema, or restore format. They must retain their own exact active-operation approval and rollback boundaries. Do not begin #243 or native UAT merely by updating this playbook.
