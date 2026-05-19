<!--
Curated AI-facing source.
Project: n8n.workflow-templates
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Credential Migration Map Example

Use this only as a reference. If a consumer repo needs an actual migration map, keep it local in ignored `.n8n-local/`.

```json
{
  "nodeNameMap": {
    "Old Node Name": "New Node Name"
  },
  "blockedCredentialTypes": [
    "exampleCredentialType"
  ],
  "credentialTypeCompatibility": {
    "old.node.type": {
      "new.node.type": [
        "exampleCredentialType"
      ]
    }
  }
}
```
