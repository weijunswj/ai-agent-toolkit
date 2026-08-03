<!-- evaluation-candidate:v1 -->
{
  "schema_version": 1,
  "run_id": "{{run_id}}",
  "provider": "{{provider}}",
  "canonical_base_model": "{{canonical_base_model}}",
  "reasoning_assignment": "{{reasoning_assignment}}",
  "sol_equivalent_reasoning": "{{sol_equivalent_reasoning}}",
  "role": "{{role}}",
  "source_revision": "{{source_revision}}",
  "technical_result": "IMPLEMENTED | AMENDED | BLOCKED",
  "evidence": [
    {
      "kind": "commit | local_validation | hosted_ci",
      "label": "{{public_safe_label}}",
      "result": "PASS | FAIL | BLOCKED",
      "public_reference": null
    }
  ]
}

Invariant evidence mapping: `base_model` maps to `canonical_base_model`, `revision` maps to `source_revision`, and `result` maps to `technical_result` in this canonical candidate schema.

The candidate is public-safe evidence for web publication. Do not include scores, evaluation verdicts, hidden reasoning, secrets, environment values, private task or session identifiers, managed-session identifiers, adapter-internal identifiers, or Ledger receipt claims. The worker does not publish it directly.
