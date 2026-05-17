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
