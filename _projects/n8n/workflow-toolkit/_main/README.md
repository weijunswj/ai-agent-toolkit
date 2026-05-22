# n8n Workflow Templates

Simple repo for turning raw n8n exports into reusable workflow templates.

## How to use

1. Put your raw n8n workflow export here:

   ```txt
   .to-sanitise/
   ```

2. Go into the `scripts` folder.

3. Run:

   ```bat
   _sanitise-n8n-template.cmd
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
templates/<category>/<workflow-name>.template.json
```

Example:

```txt
templates/global-error-handler/global-error-handler.template.json
```

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
