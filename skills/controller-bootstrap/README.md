# Controller Bootstrap

A small explicit-only skill for an already-assigned Toolkit repository controller to re-enter safely after context loss, handover, or an agreed bootstrap event.

Copy the entire `skills/controller-bootstrap/` folder to the target agent's supported skill location. The skill has no automatic startup hook, no repository write helper, and no authority token. Its local qualification reference distinguishes instruction availability from native host proof.

## Requires

- An explicit controller task and independently established controller/owner binding.
- A canonical repository identity and current RUN/Lock/CURRENT evidence.
- Trusted retrieval of the accepted Toolkit Controller and stack-registry sources at one accepted snapshot.
- Separate authority, execution custody, capability, and host-native permission for each effect.

## Stops when

Any identity, source, CURRENT, applicability, handover, approval, permission, or outcome is incomplete, stale, revoked, ambiguous, or unavailable. The result is read-only HOLD with the exact missing evidence; the skill does not choose a controller, retry an unknown outcome, or improvise a fallback.

See [SKILL.md](SKILL.md) for the operating contract and [qualification](references/qualification.md) for host claim boundaries.