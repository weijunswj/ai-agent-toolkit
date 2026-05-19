# n8n Workflow Toolkit

Reusable source material for safe n8n workflow helper scripts and public workflow templates.

This source tree is split so helper scripts and actual workflow JSON templates have separate ownership and published skill boundaries.

## Source layout

```txt
helper-scripts/
  sanitizer/
  import-export-sync/
workflow-templates/
  error-handling/
```

## Sanitizer helper scripts

Use `helper-scripts/sanitizer/` to turn raw n8n exports into reusable workflow template candidates.

1. Put your raw n8n workflow export here:

   ```txt
   .to-sanitise/
   ```

2. Copy or run the sanitizer helper from a reviewed consumer repo.

3. Run:

   ```bat
sanitise-n8n-template.cmd
```

4. Your cleaned template will appear here:

   ```txt
   .sanitised/
   ```

If a file with the same output name already exists in `.sanitised/`, it will be overwritten.

## After sanitising

Review and import-test the file from `.sanitised/`.

When it looks good, manually move it into whatever final folder makes sense.

Preferred style:

```txt
workflow-templates/<category>/<workflow-name>.template.json
```

Example:

```txt
workflow-templates/error-handling/global-error-handler.template.json
```

## Import/export sync helper scripts

Use `helper-scripts/import-export-sync/` as review-required helper templates for consumer repos that intentionally own n8n workflow JSON.

These helpers may write only scoped local consumer-repo paths after review:

- `n8n-workflows/*.json`
- ignored `.tmp/**`
- ignored `.n8n-local/**`

Do not run live import/export helpers from this toolkit repo or in CI.

## Workflow templates

Use `workflow-templates/` only for reviewed public workflow JSON templates.

Templates must stay generic, inactive, credential-free, and free of live workflow IDs, live webhook IDs, customer data, private URLs, `.env` values, and credential bindings.

## What gets sanitised

The stripper sanitises the whole workflow, across every node.

It removes or replaces:

- Live workflow fields like `id`, `versionId`, `meta`, `tags`, `createdAt`, and `updatedAt`.
- Node credential bindings.
- Node webhook IDs.
- n8n cached resource-locator names and URLs.
- Live resource IDs and config-looking values.
- Real emails.
- Real URLs.
- Common broken UTF-8 text.

Empty workflows are rejected by default.

## Folder rules

These folders are staging only:

```txt
.to-sanitise/
.sanitised/
```

Their contents are ignored by Git.

Only commit final reviewed templates after you manually move them out of `.sanitised/`.
