#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { canonicalSerialize, digestValue } = require('./toolkit-execution-loop.cjs');
const receipt = require('./toolkit-github-program-receipt.cjs');

const REPOSITORY = 'weijunswj/ai-agent-toolkit';
const PARENT_ISSUE = 240;
const CHILD_ISSUE = 359;
const MAIN_SHA = 'c72028c63cc09dd07d3e522692065448b6b7dbb6';
const RECOVERY_ROOT = 'E3-V5-PROGRAMME-PROJECTION-BOOTSTRAP-RECOVERY-001';
const LOCK = 'DL-S2-E3-V5-PROJECTION-BOOTSTRAP-RECOVERY-001';
const OLD_ROOT = 'E3-CANONICAL-HISTORICAL-RECEIPT-RESOLUTION-003';
const PARKED_ROOT = 'E3-HISTORICAL-RECEIPT-CI-PROOF-BOUNDARY-SIMPLIFICATION-004';
const WRITE_SAFETY_MODE = 'WEB_EXCLUSIVE_SINGLE_WRITER_RECOVERY_WINDOW';
const STATE_SCHEMA = 'toolkit.github-program.state.v5';
const PROJECTION_SCHEMA = 'toolkit.github-program.projection.v1';
const SURFACE_SCHEMA = 'toolkit.github-program.surface.v5';
const DECISION_SCHEMA = 'toolkit.github-program.projection-bootstrap-recovery-decision.v1';
const EVIDENCE_SCHEMA = 'toolkit.github-program.projection-bootstrap-recovery-evidence.v1';
const BOOTSTRAP_SCHEMA = 'toolkit.github-program.controller-bootstrap.v1';
const RECOVERY_OPERATION_SCHEMA = 'toolkit.github-program.projection-bootstrap-recovery-operation.v1';
const RECOVERY_EVIDENCE_REF = 'recovery-g2-web-authority';
const HOLD_EVIDENCE_REF = 'web-recovery-g1-accepted-5580530088';
const HOLD_EVIDENCE_REFERENCE = 'github:issue-comment:359:5580530088';
const RETENTION_EVIDENCE_REF = 'web-pr379-retained-5580538176';
const RETENTION_EVIDENCE_REFERENCE = 'github:issue-comment:379:5580538176';
const SOURCE_CANONICAL_DIGEST = 'a09fdafa6b77ad85624298ceea488a5c342d00a0700218de62ba2276ed050280';
const SOURCE_PARENT_BODY_DIGEST = 'a1e16640c3cdb20ed5e94e0c2c86c0bd763ff135565bd81d4aaaaa9e2a81afae';
const SOURCE_CHILD_BODY_DIGEST = '8ba74c91078b9acdae69ce3a5f2877ea677cab57fe16a402520aef8abbf4d960';
const SOURCE_PARENT_REVISION = '2026-09-08T07:21:55Z';
const SOURCE_CHILD_REVISION = '2026-09-08T07:21:42Z';
const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const FROZEN_HEAD = 'adca2ffec8322eb57afcd9f9fdc67210503ebcf1';
const FROZEN_TREE = '2c712aa9c7c6e66a89bdd9d033acece5415fd575';
const FROZEN_BRANCH = 'codex/e3-canonical-historical-receipt-resolution-003';
const FROZEN_BASE_REF = 'main';
const FROZEN_VERSION = '2.11.0';
const PR366_HEAD = 'a7dcb69da43100c5411076008307a221e89b720f';
const PR366_TREE = '2c88782fa274e502fb6c8c5126d55470112f38e9';
const PR366_BASE_SHA = 'e86a2d74fd771f6500aa02fe0892940933bf7647';
const PR366_VERSION = '2.12.0';
const TARGET_CANONICAL_DIGEST = '1d810f3d7df41012707672cd323c12ccfcff279c172165bbf732e1a49eae39aa';
const FINALISATION_ROOT = 'E3-V5-POST-MERGE-FINALISATION-SOURCE-ANCHORED-TARGETS-002';
const FINALISATION_LOCK = 'DL-S2-E3-V5-POST-MERGE-FINALISATION-SOURCE-ANCHORED-TARGETS-002';
const FINALISATION_SCOPE = 'POST_MERGE_FINALISATION_SOURCE_ANCHORED_TARGETS';
const FINALISATION_WRITE_SAFETY_MODE = 'WEB_EXCLUSIVE_POST_MERGE_FINALISATION';
const FINALISATION_DECISION_SCHEMA = 'toolkit.github-program.post-merge-finalisation-decision.v1';
const FINALISATION_EVIDENCE_SCHEMA = 'toolkit.github-program.post-merge-finalisation-evidence.v1';
const FINALISATION_OPERATION_SCHEMA = 'toolkit.github-program.post-merge-finalisation-operation.v1';
const FINALISATION_SOURCE_CANONICAL_DIGEST = '1d810f3d7df41012707672cd323c12ccfcff279c172165bbf732e1a49eae39aa';
const FINALISATION_STAGE_A_CANONICAL_DIGEST = 'c1a84af3e7ea7baf3129cd64ce12ba038e3c71fe8d1610eb516d4955d488eb65';
const FINALISATION_STAGE_B_CANONICAL_DIGEST = '4122eead6382d95be5e0593d2e2f35b54a6c07bf8592cf4c5a5d9a67ee8b95c2';
const PR380_HEAD = 'f8afc5df62b9e86a478ce24745b6aa481cbc7a1a';
const PR380_TREE = 'd9e78e1a09fc53f88d077f3f4216027102534ce3';
const PR380_BRANCH = 'codex/e3-v5-projection-bootstrap-recovery-001';
const PR380_BASE_SHA = MAIN_SHA;
const PR380_VERSION = '2.10.8';
const PR380_MERGE_COMMIT = '4381386c5fdfa45b8848af9b30b9082df06d99a0';
const FINAL_G4_EVIDENCE_REF = 'post-merge-g4-web-acceptance-5143994659';
const FINAL_G4_EVIDENCE_REFERENCE = 'github:pull-request-review:380:5143994659';
const POST_MERGE_TECHNICAL_EVIDENCE_REF = 'post-merge-technical-finality-5144137683';
const POST_MERGE_TECHNICAL_EVIDENCE_REFERENCE = 'github:pull-request-review:380:5144137683';
const PR379_NON_CONVERGENCE_EVIDENCE_REF = 'pr379-non-convergence-5579738186';
const PR379_NON_CONVERGENCE_EVIDENCE_REFERENCE = 'github:issue-comment:379:5579738186';
const FINALISATION_TRANSITION_ID = 'e3-post-merge-finalisation-source-anchored';
const FINALISATION_PR379_SOURCE_REVISION = '2026-09-08T07:22:12Z';
const FINALISATION_AUTHORITY = Object.freeze([
  Object.freeze({ issue: 381, comment_id: 5596298954 }),
  Object.freeze({ issue: 359, comment_id: 5596300487 }),
  Object.freeze({ issue: 240, comment_id: 5596302075 }),
]);
const FINALISATION_CHECKPOINTS = Object.freeze([
  'BEFORE_STAGE_A',
  'CHILD_STAGE_A_OBSERVED',
  'PARENT_STAGE_A_OBSERVED',
  'PR379_CLOSED_STAGE_A',
  'CHILD_STAGE_B_OBSERVED',
  'FINAL_TARGET_OBSERVED',
]);
const FINALISATION_OPERATION_ORDER = Object.freeze([
  Object.freeze({ order: 1, operation_id: 'CHILD_STAGE_A', issue: CHILD_ISSUE, target_kind: 'ISSUE_BODY', target_stage: 'STAGE_A', operation_kind: 'IDEMPOTENT_SET' }),
  Object.freeze({ order: 2, operation_id: 'PARENT_STAGE_A', issue: PARENT_ISSUE, target_kind: 'ISSUE_BODY', target_stage: 'STAGE_A', operation_kind: 'IDEMPOTENT_SET' }),
  Object.freeze({ order: 3, operation_id: 'PR379_CLOSE', issue: 379, target_kind: 'PULL_REQUEST_STATE', target_stage: null, operation_kind: 'IDEMPOTENT_CLOSE' }),
  Object.freeze({ order: 4, operation_id: 'CHILD_STAGE_B', issue: CHILD_ISSUE, target_kind: 'ISSUE_BODY', target_stage: 'STAGE_B', operation_kind: 'IDEMPOTENT_SET' }),
  Object.freeze({ order: 5, operation_id: 'PARENT_STAGE_B', issue: PARENT_ISSUE, target_kind: 'ISSUE_BODY', target_stage: 'STAGE_B', operation_kind: 'IDEMPOTENT_SET' }),
]);

const AUTHORITY_CONTROLLING = Object.freeze([
  Object.freeze({ issue: CHILD_ISSUE, comment_id: 5580972753, body_digest: 'e9054376b3c26a640034496f1cfb5c2605c04ed9083dc04000b6832dd3aa6e5e' }),
  Object.freeze({ issue: PARENT_ISSUE, comment_id: 5580975069, body_digest: '522c93197d3af0d0d39dc17e3edd53ff7862be7d2aaa14eef4d76804abcadeb6' }),
  Object.freeze({ issue: 379, comment_id: 5580978455, body_digest: '215f751ad7dae274f59e00c917fad6128456018fa41aa861e8aaebabbd4daf65' }),
]);
const AUTHORITY_PREDECESSOR = Object.freeze([
  Object.freeze({ issue: CHILD_ISSUE, comment_id: 5580530088, body_digest: '15be9217334e8eba98aeeba4922de68317720aff04ea143a652bf1cecaa45159' }),
  Object.freeze({ issue: PARENT_ISSUE, comment_id: 5580534575, body_digest: '13db0765fdad8926ac3d2fd9510932f89602003cb332b48d41a292c93d2f8886' }),
  Object.freeze({ issue: 379, comment_id: 5580538176, body_digest: '802ab4f0ae3766bba52588af64b3e9cb41896c47ba47175f921d8f7fe0fec423' }),
]);
const PR379_REVIEW_FACTS = Object.freeze([
  Object.freeze({
    id: 5137053054,
    user: 'weijunswj',
    state: 'COMMENTED',
    submitted_at: '2026-09-08T03:37:30Z',
    body_digest: 'e677613f898edac018137223a27e9e747f62a44a8777657fd91b98642ba7da5f',
  }),
]);
const PR379_COMMENT_FACTS = Object.freeze([
  Object.freeze({ id: 5579264600, user: 'weijunswj', created_at: '2026-09-08T04:31:55Z', updated_at: '2026-09-08T04:31:55Z', body_digest: '5bff4ca8ec0364c899a40955832aab70c0b067cf63ef6e76f0896e29be7f1ab4' }),
  Object.freeze({ id: 5579508129, user: 'weijunswj', created_at: '2026-09-08T05:00:02Z', updated_at: '2026-09-08T05:00:02Z', body_digest: 'dce06fd266097da537c286a03c734d173e311a5ebb64e0b6195fc5b5f01dff8e' }),
  Object.freeze({ id: 5579738186, user: 'weijunswj', created_at: '2026-09-08T05:25:00Z', updated_at: '2026-09-08T05:25:00Z', body_digest: '48806a388a2771d0c8b4dc3229a202605f0bf76fd8a356f20e8c4bd18f8d436f' }),
  Object.freeze({ id: 5579993168, user: 'weijunswj', created_at: '2026-09-08T05:53:45Z', updated_at: '2026-09-08T05:53:45Z', body_digest: '67d6900eaf01f9a6063f1dbd3a6e9742325418e0284275dde4f795637bd4465c' }),
  Object.freeze({ id: 5580538176, user: 'weijunswj', created_at: '2026-09-08T06:45:59Z', updated_at: '2026-09-08T06:45:59Z', body_digest: '802ab4f0ae3766bba52588af64b3e9cb41896c47ba47175f921d8f7fe0fec423' }),
  Object.freeze({ id: 5580978455, user: 'weijunswj', created_at: '2026-09-08T07:22:12Z', updated_at: '2026-09-08T07:22:12Z', body_digest: '215f751ad7dae274f59e00c917fad6128456018fa41aa861e8aaebabbd4daf65' }),
]);
const PR379_CHECK_FACTS = Object.freeze([
  Object.freeze({ name: 'CodeQL', status: 'completed', conclusion: 'success', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:48:55Z' }),
  Object.freeze({ name: 'validate', status: 'completed', conclusion: 'failure', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:52:58Z' }),
  Object.freeze({ name: 'validate', status: 'completed', conclusion: 'failure', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:52:43Z' }),
  Object.freeze({ name: 'Analyze (actions)', status: 'completed', conclusion: 'success', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:49:01Z' }),
  Object.freeze({ name: 'Analyze (javascript-typescript)', status: 'completed', conclusion: 'success', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:49:50Z' }),
  Object.freeze({ name: 'Analyze (python)', status: 'completed', conclusion: 'success', head_sha: FROZEN_HEAD, completed_at: '2026-09-08T04:49:15Z' }),
]);

function success(code, extra = {}) { return { ok: true, code, ...extra }; }
function failure(code, extra = {}) { return { ok: false, code, ...extra }; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const FINALISATION_SOURCE_STATE = deepFreeze(
{
  "active_lanes": [],
  "children": [
    {
      "boundaries": [
        "Keep completed and merged S1 scope closed.",
        "S2 through S6 remain outside S1."
      ],
      "deliverables": [
        "Canonical Toolkit topology collapse.",
        "Permanent retirement of obsolete topology and external executor-evaluation Ledger coupling."
      ],
      "dependencies": [],
      "done_when": [
        "Canonical surfaces are retained, obsolete topology and Ledger coupling are permanently retired, and completed scope remains closed."
      ],
      "eli5": "The old layout was cleaned up and this finished step stays closed.",
      "epochs": [
        {
          "evidence_ref": "s1-accepted",
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "S1",
          "lock": "DL-S1-CANONICAL-TOPOLOGY-COLLAPSE-001-G2",
          "name": "S1 - Canonical topology collapse",
          "purpose": "Canonical topology collapse",
          "terminal_disposition": "ACCEPTED"
        }
      ],
      "finality": {
        "authority_ref": "s1-accepted",
        "state": "MERGED"
      },
      "holds": [],
      "issue": 358,
      "lifecycle": "COMPLETED",
      "objective": "Collapse Toolkit to canonical surfaces and permanently retire obsolete topology residue.",
      "order": 1,
      "out_of_scope": [
        "Reopening completed or merged S1 scope.",
        "S2 through S6 work."
      ],
      "pr_registry": [],
      "scope": [
        "Completed S1 topology collapse and permanent obsolete/Ledger coupling retirement."
      ],
      "summary": "Collapse Toolkit to canonical surfaces and permanently retire obsolete topology residue.",
      "title": "S1 — Canonical topology collapse + permanent Ledger retirement"
    },
    {
      "boundaries": [
        "Web owns E3 acceptance, Ready, merge and finality.",
        "The recovery hold is Web-exclusive and has no provider CAS claim.",
        "E4 and S3 through S6 remain pending or blocked/queued."
      ],
      "deliverables": [
        "Retained-skill productisation.",
        "GitHub programme reconciler v5.",
        "Future E4 truthful native adapters."
      ],
      "dependencies": [],
      "done_when": [
        "E1 and E2 remain accepted with retained evidence.",
        "The v5 projection recovery is read back exactly and separate Web authority records E3 acceptance.",
        "E4 truthful native adapters are complete and Web records S2 finality."
      ],
      "eli5": "The programme is paused safely while the two managed views are repaired from trusted Web evidence; no normal work lane is running.",
      "epochs": [
        {
          "evidence_ref": "e1-accepted",
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "E1",
          "lock": "DL-S2-CREATION-GATE-003",
          "name": "E1 - Creation Gate",
          "purpose": "Creation and admission gate",
          "terminal_disposition": "ACCEPTED"
        },
        {
          "evidence_ref": "e2-accepted",
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "E2",
          "lock": "DL-S2-PRODUCT-PORTFOLIO-015",
          "name": "E2 - Product Portfolio",
          "purpose": "Retained product portfolio",
          "terminal_disposition": "ACCEPTED"
        },
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "E3",
          "lock": "DL-S2-GITHUB-PROGRAM-CONVERGENCE-002",
          "name": "E3 - GitHub Programme Product",
          "purpose": "Managed GitHub programme reconciliation",
          "terminal_disposition": null
        },
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "E4",
          "lock": "DL-S2-NATIVE-ADAPTERS-002",
          "name": "E4 - Native Adapters",
          "purpose": "Truthful native host adapters",
          "terminal_disposition": null
        }
      ],
      "finality": {
        "authority_ref": null,
        "state": "HELD"
      },
      "holds": [
        {
          "id": "E3-V5-PROGRAMME-PROJECTION-BOOTSTRAP-RECOVERY-001",
          "root": "E3-V5-PROGRAMME-PROJECTION-BOOTSTRAP-RECOVERY-001",
          "lock": "DL-S2-E3-V5-PROJECTION-BOOTSTRAP-RECOVERY-001",
          "kind": "BLOCKING",
          "scope": "PROGRAMME_PROJECTION_RECOVERY",
          "active": true,
          "blocks_normal_lanes": true,
          "evidence_ref": "web-recovery-g1-accepted-5580530088",
          "summary": "Managed v5 parent and child projections are stale and remain held pending separately authorised recovery."
        }
      ],
      "issue": 359,
      "lifecycle": "CURRENT",
      "objective": "Productise retained skills, complete the GitHub programme reconciler, then finish truthful native host adapters.",
      "order": 2,
      "out_of_scope": [
        "G4 result or E3 acceptance before separate Web authority.",
        "Ready, merge, finality, E4 execution and S3 through S6 progression.",
        "Programme Apply or any provider operation in this recovery window."
      ],
      "pr_registry": [
        {
          "accepted_evidence_ref": null,
          "candidate": null,
          "completes_child": false,
          "draft": true,
          "epoch_id": "E3",
          "github_state": "CLOSED",
          "merged": false,
          "pr": 366,
          "retention_evidence_ref": null,
          "retirement_evidence_ref": "recovery-g2-web-authority",
          "role": "INTERMEDIATE",
          "status": "RETIRED"
        },
        {
          "accepted_evidence_ref": null,
          "candidate": {
            "repository": "weijunswj/ai-agent-toolkit",
            "branch": "codex/e3-canonical-historical-receipt-resolution-003",
            "base_ref": "main",
            "base_sha": "c72028c63cc09dd07d3e522692065448b6b7dbb6",
            "head": "adca2ffec8322eb57afcd9f9fdc67210503ebcf1",
            "tree": "2c712aa9c7c6e66a89bdd9d033acece5415fd575",
            "version": "2.11.0"
          },
          "completes_child": false,
          "draft": true,
          "epoch_id": "E3",
          "github_state": "OPEN",
          "merged": false,
          "pr": 379,
          "retention_evidence_ref": "web-pr379-retained-5580538176",
          "retirement_evidence_ref": null,
          "role": "INTERMEDIATE",
          "status": "RETAINED"
        }
      ],
      "scope": [
        "Read-only v5 programme projection bootstrap recovery for the canonical parent and current child.",
        "Preservation of retained and historical PR chronology without launching a normal gate."
      ],
      "summary": "E1 and E2 remain accepted; E3 is held in a zero-lane recovery window pending separate Web acceptance.",
      "title": "S2 — Productize retained skills + native host adapters"
    },
    {
      "boundaries": [
        "Consequential live or repository-protection mutation requires explicit authority.",
        "This queued child does not start until its dependencies are complete or retired."
      ],
      "deliverables": [
        "Repository Loop Manager and work graph.",
        "Leases, fences, durable recovery and idempotency.",
        "Bounded convergence with a two-repair stop.",
        "Trusted CI and permanent host-backed orchestration."
      ],
      "dependencies": [
        358
      ],
      "done_when": [
        "The Loop Manager, work graph, leases/fences, durable recovery, idempotency and bounded convergence are proven.",
        "Trusted CI and permanent host-backed orchestration are operational under accepted authority boundaries."
      ],
      "eli5": "This later step will automate the loop around the programme tool.",
      "epochs": [
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "S3",
          "lock": "S3-DESIGN-LOCK-PENDING",
          "name": "S3 - Repository Loop Manager",
          "purpose": "Repository loop and trusted CI automation",
          "terminal_disposition": null
        }
      ],
      "finality": {
        "authority_ref": null,
        "state": "HELD"
      },
      "holds": [],
      "issue": 360,
      "lifecycle": "QUEUED",
      "objective": "Build the Repository Loop Manager and trusted-CI automation around the E3 primitive.",
      "order": 3,
      "out_of_scope": [
        "S4 through S6 execution.",
        "Unapproved consequential live or repository-protection mutation."
      ],
      "pr_registry": [],
      "scope": [
        "Repository Loop Manager, work graph, leases/fences, durable recovery, idempotency, bounded convergence/two-repair stop, trusted CI and permanent host-backed orchestration."
      ],
      "summary": "Build the Repository Loop Manager and trusted-CI automation around the E3 primitive.",
      "title": "S3 — Repository Loop Manager + trusted CI live integration"
    },
    {
      "boundaries": [
        "Live n8n operations require explicit authority.",
        "This queued child does not start until its dependencies are complete or retired."
      ],
      "deliverables": [
        "Exact-pinned official n8n Skills.",
        "API-first workflow transport.",
        "Credential- and identity-safe boundaries.",
        "Pause-before-exit and JSON primitive import regressions fixed and covered."
      ],
      "dependencies": [
        358,
        359,
        360
      ],
      "done_when": [
        "Official n8n Skills are exact-pinned and API-first transport is proven.",
        "Credential/identity safety, pause-before-exit and JSON primitive import regressions pass their required evidence."
      ],
      "eli5": "This later step will make n8n support official and safely transport workflows.",
      "epochs": [
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "S4",
          "lock": "S4-DESIGN-LOCK-PENDING",
          "name": "S4 - n8n skills and transport",
          "purpose": "Official n8n skills and API-first transport",
          "terminal_disposition": null
        }
      ],
      "finality": {
        "authority_ref": null,
        "state": "HELD"
      },
      "holds": [],
      "issue": 361,
      "lifecycle": "QUEUED",
      "objective": "Move n8n support to official n8n Skills and safe API-first workflow transport.",
      "order": 4,
      "out_of_scope": [
        "Custom n8n MCP revival.",
        "Live n8n operations without explicit authority.",
        "S5 and S6 execution."
      ],
      "pr_registry": [],
      "scope": [
        "Official n8n Skills, API-first transport, credential/identity-safe boundaries and the two reported regressions."
      ],
      "summary": "Move n8n support to official n8n Skills and safe API-first workflow transport.",
      "title": "S4 — Official n8n Skills + API-first workflow transport"
    },
    {
      "boundaries": [
        "No secret values in repo, prompts, logs or public evidence.",
        "Consequential provider actions require explicit authority.",
        "This queued child does not start until its dependencies are complete or retired."
      ],
      "deliverables": [
        "External authority and secret-reference boundaries.",
        "Sensitive-file boundaries.",
        "Hosted operations, backup, rollback and health.",
        "Privacy-safe telemetry."
      ],
      "dependencies": [
        358,
        359,
        360
      ],
      "done_when": [
        "External authority, secret-reference and sensitive-file boundaries are proven.",
        "Hosted operations, backup/rollback/health and privacy-safe telemetry meet accepted evidence requirements."
      ],
      "eli5": "This later step will define who may touch providers, secrets and hosted systems.",
      "epochs": [
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "S5",
          "lock": "S5-DESIGN-LOCK-PENDING",
          "name": "S5 - External authority boundaries",
          "purpose": "External authority and hosted-operation boundaries",
          "terminal_disposition": null
        }
      ],
      "finality": {
        "authority_ref": null,
        "state": "HELD"
      },
      "holds": [],
      "issue": 362,
      "lifecycle": "QUEUED",
      "objective": "Establish external authority, secrets, provider/deployment and hosted-operation boundaries.",
      "order": 5,
      "out_of_scope": [
        "Secret values in repository files, prompts, logs or public evidence.",
        "Consequential provider actions without explicit authority.",
        "S6 execution."
      ],
      "pr_registry": [],
      "scope": [
        "External authority, secret references, sensitive files, hosted operations, backup/rollback/health and privacy-safe telemetry."
      ],
      "summary": "Establish external authority, secrets, provider/deployment and hosted-operation boundaries.",
      "title": "S5 — External authority, secrets + hosted operations"
    },
    {
      "boundaries": [
        "S6 remains last.",
        "Consequential live actions require separate authority."
      ],
      "deliverables": [
        "Final native/live UAT.",
        "Loop Manager, trusted-CI and n8n UAT.",
        "Residue verification.",
        "Final whole-Toolkit assurance."
      ],
      "dependencies": [
        358,
        359,
        360,
        361,
        362
      ],
      "done_when": [
        "Native/live, Loop Manager, trusted-CI and n8n UAT are complete under their authorities.",
        "Residue verification and final whole-Toolkit assurance are accepted by Web."
      ],
      "eli5": "This final step will test the whole Toolkit after every earlier step is done.",
      "epochs": [
        {
          "evidence_ref": null,
          "gates": [
            "G1",
            "G2",
            "G3",
            "G4"
          ],
          "id": "S6",
          "lock": "S6-DESIGN-LOCK-PENDING",
          "name": "S6 - Native UAT and assurance",
          "purpose": "Native UAT, cleanup and final assurance",
          "terminal_disposition": null
        }
      ],
      "finality": {
        "authority_ref": null,
        "state": "HELD"
      },
      "holds": [],
      "issue": 363,
      "lifecycle": "QUEUED",
      "objective": "Perform native/live UAT, residue cleanup and final whole-Toolkit assurance.",
      "order": 6,
      "out_of_scope": [
        "Starting before S1 through S5 obligations are terminal and accepted.",
        "Consequential live actions without separate authority."
      ],
      "pr_registry": [],
      "scope": [
        "Final native/live UAT, Loop Manager/trusted-CI/n8n UAT, residue verification and whole-Toolkit assurance."
      ],
      "summary": "Perform native/live UAT, residue cleanup and final whole-Toolkit assurance.",
      "title": "S6 — Native UAT + final whole-Toolkit assurance"
    }
  ],
  "concurrency_authority": {
    "authority_digest": null,
    "authority_ref": null,
    "max_active_lanes": 1,
    "mode": "SINGLE_DEFAULT",
    "permitted_child_issues": []
  },
  "design_lock": "DL-S2-E3-V5-PROJECTION-BOOTSTRAP-RECOVERY-001",
  "evidence_refs": [
    {
      "id": "e3-g4-active-transition",
      "kind": "WEB",
      "reference": "github:issue-comment:356:5456077647",
      "summary": "E3 G4 control-plane transition - PREVIEW ONLY."
    },
    {
      "id": "repair1-current",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5452138390",
      "summary": "E3 G3 convergence Repair 1 is current and awaits Web reconciliation."
    },
    {
      "id": "prior-g4-amend",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5448818142",
      "summary": "Prior isolated E3 G4 returned AMEND and required convergence G2 re-entry."
    },
    {
      "id": "convergence-g2-accepted",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5449075304",
      "summary": "E3 convergence G2 design Lock was accepted and G3 authorised."
    },
    {
      "id": "e1-accepted",
      "kind": "WEB",
      "reference": "github:issue-comment:366:5428741231",
      "summary": "S2 E1 Creation Gate was Web accepted."
    },
    {
      "id": "e2-accepted",
      "kind": "WEB",
      "reference": "github:issue-comment:366:5437266157",
      "summary": "S2 E2 Product Portfolio was Web accepted."
    },
    {
      "id": "s1-accepted",
      "kind": "WEB",
      "reference": "github:issue-comment:358:5426948394",
      "summary": "S1 was terminal, canonical, and accepted."
    },
    {
      "id": "predecessor-coverage",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5437827030",
      "summary": "Predecessor coverage is exactly 45 issues, 84 criteria, and zero unmapped."
    },
    {
      "id": "repair-head",
      "kind": "COMMIT",
      "reference": "git:commit:446471e6248bf8bc6540d4a03aa2a0e1ab625f3d",
      "summary": "Exact Repair 1 candidate commit."
    },
    {
      "id": "repair-checks",
      "kind": "CHECK",
      "reference": "github:checks:446471e6248bf8bc6540d4a03aa2a0e1ab625f3d",
      "summary": "Exact-head validation and CodeQL passed."
    },
    {
      "id": "web_7704ca0d87256b427f63",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5462985071",
      "summary": "Web-controlled E3 architecture and exact-candidate admission authority."
    },
    {
      "id": "e3-g3-dogfood-accepted",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5466912566",
      "summary": "Web accepted E3 G3 dogfood and authorised the fresh G4 transition preview."
    },
    {
      "id": "recovery-authority-5580972753",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5580972753",
      "summary": "Accepted recovery authority body bound by digest."
    },
    {
      "id": "recovery-authority-5580975069",
      "kind": "WEB",
      "reference": "github:issue-comment:240:5580975069",
      "summary": "Accepted recovery authority body bound by digest."
    },
    {
      "id": "recovery-authority-5580978455",
      "kind": "WEB",
      "reference": "github:issue-comment:379:5580978455",
      "summary": "Accepted recovery authority body bound by digest."
    },
    {
      "id": "web-recovery-g1-accepted-5580530088",
      "kind": "WEB",
      "reference": "github:issue-comment:359:5580530088",
      "summary": "Accepted G1 recovery-hold authority body bound by digest."
    },
    {
      "id": "recovery-predecessor-5580534575",
      "kind": "WEB",
      "reference": "github:issue-comment:240:5580534575",
      "summary": "Predecessor non-convergence evidence bound by digest."
    },
    {
      "id": "web-pr379-retained-5580538176",
      "kind": "WEB",
      "reference": "github:issue-comment:379:5580538176",
      "summary": "Accepted retained PR #379 chronology body bound by digest."
    }
  ],
  "extensions": [],
  "historical_transitions": [
    {
      "child_issue": 359,
      "disposition": "AMEND",
      "epoch_id": "E3",
      "evidence_ref": "prior-g4-amend",
      "gate": "G4",
      "id": "e3-prior-g4-amend"
    },
    {
      "child_issue": 359,
      "disposition": "ACCEPTED",
      "epoch_id": "E3",
      "evidence_ref": "convergence-g2-accepted",
      "gate": "G2",
      "id": "e3-convergence-g2-accepted"
    },
    {
      "child_issue": 359,
      "disposition": "ACCEPTED",
      "epoch_id": "E3",
      "evidence_ref": "e3-g3-dogfood-accepted",
      "gate": "G3",
      "id": "e3-g3-dogfood-accepted"
    }
  ],
  "parent": {
    "goal": "Deliver the six-stage Toolkit programme through truthful, deterministic, source-traceable programme views.",
    "issue": 240,
    "title": "[ PARENT THREAD ] AI Agent Toolkit — Rolling Work Queue"
  },
  "predecessor_contract_digest": "6ea9a35397376995730c042f7cd915084348c423eae76db058a480ac9c9e2276",
  "prs": [
    {
      "changed_surfaces": [
        "GitHub programme reconciler runtime and policy.",
        "Programme surface and predecessor contracts.",
        "Focused reconciliation and bridge tests.",
        "Aligned native plugin and bridge version surfaces."
      ],
      "child_issue": 359,
      "design_constraints": [
        "Role remains INTERMEDIATE and completes_child remains false.",
        "PR remains draft.",
        "No finality operation is authorised by this reconciliation."
      ],
      "eli5": "The repair and dogfood correction are accepted, and the final independent E3 review gate is active without a result.",
      "evidence_refs": [],
      "number": 366,
      "out_of_scope": [
        "G4 result or E3 acceptance before separate Web authority.",
        "Ready, merge, finality, E4 and S3 through S6 execution.",
        "Provider, deployment, credential and live n8n operations."
      ],
      "purpose": "Implement and prove the deterministic GitHub programme reconciler product for S2 E3.",
      "scope": [
        "Canonical parent, child and PR views.",
        "Managed lifecycle labels and typed events.",
        "Existing-issue sub-issue and blocked-by relationships.",
        "Preview, explicit apply, readback verification and exact rerun zero delta."
      ],
      "summary": "Historical PR #366 is closed and retired; no merged candidate is active.",
      "validation_requirements": [
        "Repair-2 focused tests passed 24/24.",
        "Relevant reconciler suite passed 255/255.",
        "Toolkit validation and audits passed.",
        "Exact-head Validate passed.",
        "Exact-head Validate toolkit passed.",
        "CodeQL and language analyses passed.",
        "Dynamic GHAS unsupported-model failure is external/non-candidate evidence.",
        "Durable original migration preview and receipt were read back.",
        "Exactly one authorised v5 migration Apply completed.",
        "Migration event: 87851b36e0f54dd969ac1b85e49e2f159aeefee1497861f20e2fd45b02128e66.",
        "Immediate migration rerun: PROGRAMME_ZERO_DELTA / mutation_count=0.",
        "Dogfood UX correction accepted by Web under authority comment 5466912566.",
        "Fresh G4: ACTIVE / NO RESULT."
      ]
    }
  ],
  "repository": "weijunswj/ai-agent-toolkit",
  "schema": "toolkit.github-program.state.v5",
  "recovery": {
    "root": "E3-V5-PROGRAMME-PROJECTION-BOOTSTRAP-RECOVERY-001",
    "lock": "DL-S2-E3-V5-PROJECTION-BOOTSTRAP-RECOVERY-001",
    "status": "HELD",
    "normal_active_lanes": 0,
    "active_blocking_recovery_hold": true,
    "e3_status": "UNACCEPTED",
    "e4_status": "PENDING",
    "queued_children": [
      360,
      361,
      362,
      363
    ],
    "old_root": {
      "root": "E3-CANONICAL-HISTORICAL-RECEIPT-RESOLUTION-003",
      "disposition": "NON_CONVERGENT",
      "terminal": true,
      "repair_budget": {
        "used": 2,
        "limit": 2,
        "further_repair_authorised": false
      }
    },
    "parked_root": {
      "root": "E3-HISTORICAL-RECEIPT-CI-PROOF-BOUNDARY-SIMPLIFICATION-004",
      "status": "NOT_LAUNCHED"
    }
  }
}
);
if (digestValue(FINALISATION_SOURCE_STATE) !== FINALISATION_SOURCE_CANONICAL_DIGEST) {
  throw new Error('FINALISATION_SOURCE_DIGEST_MISMATCH');
}
function same(left, right) { return canonicalSerialize(left) === canonicalSerialize(right); }
function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function keysFrom(required, optional = []) { return [...required, ...optional]; }
function hasOnly(value, required, optional = []) {
  return isRecord(value)
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function isDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isSha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function isIssue(value) { return Number.isSafeInteger(value) && value >= 1; }
function isSafeId(value, max = 256) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
    && !value.includes('..');
}
function isSafeRevision(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !/[\r\n]/.test(value);
}
function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}
function isStringArray(value, max = 4096) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length <= max && !/[\r\n]/.test(item));
}
function sha256Text(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function base64url(value) { return Buffer.from(value, 'utf8').toString('base64url'); }
function fromBase64url(value) {
  try { return Buffer.from(value, 'base64url').toString('utf8'); } catch (_error) { return null; }
}
function without(value, key) {
  const copy = clone(value);
  delete copy[key];
  return copy;
}
function authorityBinding(decision) {
  return {
    controlling: clone(decision.web_authority.controlling),
    predecessor: clone(decision.web_authority.predecessor),
  };
}
function authorityDigest(decision) { return digestValue(authorityBinding(decision)); }
function factsDigest(reviews, threads, comments, checks) {
  return digestValue({
    reviews: reviews.map(({ id, user, state, submitted_at, body_digest }) => ({ id, user, state, submitted_at, body_digest })),
    threads,
    comments: comments.map(({ id, user, created_at, updated_at, body_digest }) => ({ id, user, created_at, updated_at, body_digest })),
    checks,
  });
}
function sourceBoundary() {
  return {
    parent_prefix_digest: EMPTY_DIGEST,
    parent_suffix_digest: EMPTY_DIGEST,
    child_prefix_digest: EMPTY_DIGEST,
    child_suffix_digest: EMPTY_DIGEST,
  };
}
function retainedCandidate() {
  return {
    repository: REPOSITORY,
    branch: FROZEN_BRANCH,
    base_ref: FROZEN_BASE_REF,
    base_sha: MAIN_SHA,
    head: FROZEN_HEAD,
    tree: FROZEN_TREE,
    version: FROZEN_VERSION,
  };
}
function oldRootDisposition() {
  return {
    root: OLD_ROOT,
    disposition: 'NON_CONVERGENT',
    terminal: true,
    repair_budget: { used: 2, limit: 2, further_repair_authorised: false },
  };
}
function parkedRootDisposition() { return { root: PARKED_ROOT, status: 'NOT_LAUNCHED' }; }
function recoveryHold() {
  return {
    id: RECOVERY_ROOT,
    root: RECOVERY_ROOT,
    lock: LOCK,
    kind: 'BLOCKING',
    scope: 'PROGRAMME_PROJECTION_RECOVERY',
    active: true,
    blocks_normal_lanes: true,
    evidence_ref: HOLD_EVIDENCE_REF,
    summary: 'Managed v5 parent and child projections are stale and remain held pending separately authorised recovery.',
  };
}
function recoveryState() {
  return {
    root: RECOVERY_ROOT,
    lock: LOCK,
    status: 'HELD',
    normal_active_lanes: 0,
    active_blocking_recovery_hold: true,
    e3_status: 'UNACCEPTED',
    e4_status: 'PENDING',
    queued_children: [360, 361, 362, 363],
    old_root: oldRootDisposition(),
    parked_root: parkedRootDisposition(),
  };
}
function retainedRegistryEntry() {
  return {
    accepted_evidence_ref: null,
    candidate: retainedCandidate(),
    completes_child: false,
    draft: true,
    epoch_id: 'E3',
    github_state: 'OPEN',
    merged: false,
    pr: 379,
    retention_evidence_ref: RETENTION_EVIDENCE_REF,
    retirement_evidence_ref: null,
    role: 'INTERMEDIATE',
    status: 'RETAINED',
  };
}
function retired366RegistryEntry() {
  return {
    accepted_evidence_ref: null,
    candidate: null,
    completes_child: false,
    draft: true,
    epoch_id: 'E3',
    github_state: 'CLOSED',
    merged: false,
    pr: 366,
    retention_evidence_ref: null,
    retirement_evidence_ref: RECOVERY_EVIDENCE_REF,
    role: 'INTERMEDIATE',
    status: 'RETIRED',
  };
}

const DECISION_KEYS = [
  'schema', 'recovery_root', 'lock', 'repository', 'parent_issue', 'child_issue',
  'source', 'web_authority', 'pr_366', 'pr_379', 'old_root',
  'allowed_body_targets', 'prohibitions', 'self_retirement_fence', 'write_safety',
];
function makeDecisionTemplate() {
  const controlling = clone(AUTHORITY_CONTROLLING);
  const predecessor = clone(AUTHORITY_PREDECESSOR);
  const reviewFacts = clone(PR379_REVIEW_FACTS);
  const commentFacts = clone(PR379_COMMENT_FACTS);
  const checkFacts = clone(PR379_CHECK_FACTS);
  return {
    schema: DECISION_SCHEMA,
    recovery_root: RECOVERY_ROOT,
    lock: LOCK,
    repository: REPOSITORY,
    parent_issue: PARENT_ISSUE,
    child_issue: CHILD_ISSUE,
    source: {
      canonical_digest: SOURCE_CANONICAL_DIGEST,
      parent_body_sha256: SOURCE_PARENT_BODY_DIGEST,
      child_body_sha256: SOURCE_CHILD_BODY_DIGEST,
      parent_revision: SOURCE_PARENT_REVISION,
      child_revision: SOURCE_CHILD_REVISION,
      ...sourceBoundary(),
    },
    web_authority: {
      controlling,
      predecessor,
      digest: digestValue({ controlling, predecessor }),
    },
    pr_366: {
      pr: 366,
      status: 'RETIRED',
      github_state: 'CLOSED',
      draft: true,
      merged: false,
      role: 'INTERMEDIATE',
      completes_child: false,
      candidate: null,
    },
    pr_379: {
      pr: 379,
      status: 'RETAINED',
      github_state: 'OPEN',
      draft: true,
      merged: false,
      role: 'INTERMEDIATE',
      completes_child: false,
      epoch_id: 'E3',
      retention_evidence_ref: RETENTION_EVIDENCE_REF,
      candidate: retainedCandidate(),
      facts_digest: factsDigest(reviewFacts, [], commentFacts, checkFacts),
    },
    old_root: oldRootDisposition(),
    allowed_body_targets: [
      { issue: CHILD_ISSUE, order: 1, body_role: 'CHILD_MANAGED_BODY', operation_kind: 'IDEMPOTENT_SET' },
      { issue: PARENT_ISSUE, order: 2, body_role: 'PARENT_MANAGED_BODY', operation_kind: 'IDEMPOTENT_SET' },
    ],
    prohibitions: {
      active_normal_lane_creation: false,
      acceptance_or_finality: false,
      programme_apply: false,
      provider_client: false,
      provider_cas: false,
      pr_body_mutation: false,
      pr_renderer: false,
      issue_relationship_mutation: false,
      workflow_or_fetch_depth_change: false,
      repair3: false,
      g4_ready_merge: false,
    },
    self_retirement_fence: {
      source_canonical_digest: SOURCE_CANONICAL_DIGEST,
      target_canonical_digest: TARGET_CANONICAL_DIGEST,
      exact_target_canonical_only: true,
      zero_delta_retires_recovery: true,
      target_recovery_status: 'RETIRED',
      further_repair_authorised: false,
    },
    write_safety: {
      mode: WRITE_SAFETY_MODE,
      provider_cas_available: false,
      provider_cas_claim: false,
      fresh_prewrite_evidence_revision_rebinding: true,
      web_exclusive_single_writer: true,
      postwrite_exact_readback: true,
      residual_external_race_disclosed: true,
    },
  };
}
const DECISION_TEMPLATE = makeDecisionTemplate();

function validateDecision(value) {
  if (!isRecord(value) || !exactKeys(value, DECISION_KEYS)) return failure('RECOVERY_DECISION_INVALID');
  if (!same(value, DECISION_TEMPLATE)) return failure('RECOVERY_DECISION_INVALID', { reason: 'fixed_delta_or_authority_mismatch' });
  if (Object.prototype.hasOwnProperty.call(value, 'desired')
    || Object.prototype.hasOwnProperty.call(value, 'patch')
    || Object.prototype.hasOwnProperty.call(value, 'transition')) {
    return failure('RECOVERY_DECISION_INVALID', { reason: 'caller_state_control_forbidden' });
  }
  return success('RECOVERY_DECISION_VALID', { decision: clone(value), decision_digest: digestValue(value) });
}
function createRecoveryDecision() { return clone(DECISION_TEMPLATE); }

function validateCandidate(value) {
  if (!isRecord(value) || !exactKeys(value, ['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version'])
    || value.repository !== REPOSITORY || !isSafeId(value.branch, 240)
    || value.base_ref !== FROZEN_BASE_REF || !isSha(value.base_sha)
    || !isSha(value.head) || !isSha(value.tree)) return false;
  const retained = value.base_sha === MAIN_SHA
    && value.head === FROZEN_HEAD && value.tree === FROZEN_TREE && value.version === FROZEN_VERSION;
  const accepted = value.base_ref === 'main'
    && value.base_sha === PR380_BASE_SHA && value.head === PR380_HEAD
    && value.tree === PR380_TREE && value.version === PR380_VERSION;
  if (!retained && !accepted) return false;
  return true;
}
function validateEpoch(value) {
  return isRecord(value)
    && exactKeys(value, ['evidence_ref', 'gates', 'id', 'lock', 'name', 'purpose', 'terminal_disposition'])
    && (value.evidence_ref === null || isSafeId(value.evidence_ref))
    && isStringArray(value.gates)
    && isSafeId(value.id)
    && isSafeId(value.lock, 240)
    && typeof value.name === 'string'
    && typeof value.purpose === 'string'
    && (value.terminal_disposition === null || ['ACCEPTED', 'REJECTED', 'AMEND'].includes(value.terminal_disposition));
}
function validateFinality(value) {
  return isRecord(value)
    && exactKeys(value, ['authority_ref', 'state'])
    && (value.authority_ref === null || isSafeId(value.authority_ref))
    && ['HELD', 'MERGED', 'UNMERGED'].includes(value.state);
}
function validateHold(value) {
  return isRecord(value)
    && exactKeys(value, ['active', 'blocks_normal_lanes', 'evidence_ref', 'id', 'kind', 'lock', 'root', 'scope', 'summary'])
    && typeof value.active === 'boolean'
    && typeof value.blocks_normal_lanes === 'boolean'
    && isSafeId(value.evidence_ref)
    && isSafeId(value.id)
    && isSafeId(value.kind)
    && isSafeId(value.lock, 240)
    && isSafeId(value.root, 240)
    && isSafeId(value.scope, 240)
    && typeof value.summary === 'string';
}
function validateRegistryEntry(value, target = false) {
  const required = ['accepted_evidence_ref', 'completes_child', 'epoch_id', 'pr', 'retirement_evidence_ref', 'role', 'status'];
  const optional = ['candidate', 'draft', 'github_state', 'merged', 'retention_evidence_ref'];
  if (!hasOnly(value, required, optional)
    || (value.accepted_evidence_ref !== null && !isSafeId(value.accepted_evidence_ref))
    || typeof value.completes_child !== 'boolean'
    || !isSafeId(value.epoch_id)
    || !isIssue(value.pr)
    || (value.retirement_evidence_ref !== null && !isSafeId(value.retirement_evidence_ref))
    || (Object.prototype.hasOwnProperty.call(value, 'retention_evidence_ref')
      && value.retention_evidence_ref !== null && !isSafeId(value.retention_evidence_ref))
    || value.role !== 'INTERMEDIATE'
    || !['ACTIVE', 'ACCEPTED', 'RETIRED', 'RETAINED'].includes(value.status)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'draft') && typeof value.draft !== 'boolean') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'merged') && typeof value.merged !== 'boolean') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'github_state') && !['OPEN', 'CLOSED', 'MERGED'].includes(value.github_state)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'candidate') && value.candidate !== null && !validateCanonicalCandidateShape(value.candidate)) return false;
  if (target && !exactKeys(value, ['accepted_evidence_ref', 'candidate', 'completes_child', 'draft', 'epoch_id', 'github_state', 'merged', 'pr', 'retention_evidence_ref', 'retirement_evidence_ref', 'role', 'status'])) return false;
  return true;
}
function validateCanonicalCandidateShape(value) {
  return isRecord(value)
    && exactKeys(value, ['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version'])
    && typeof value.repository === 'string' && value.repository.length > 0 && !/[\r\n\t]/.test(value.repository)
    && typeof value.branch === 'string' && value.branch.length > 0 && !/[\r\n\t]/.test(value.branch)
    && typeof value.base_ref === 'string' && value.base_ref.length > 0 && !/[\r\n\t]/.test(value.base_ref)
    && isSha(value.base_sha) && isSha(value.head) && isSha(value.tree)
    && typeof value.version === 'string' && value.version.length > 0 && !/[\r\n\t]/.test(value.version);
}
function validateChild(value) {
  const keys = ['boundaries', 'deliverables', 'dependencies', 'done_when', 'eli5', 'epochs', 'finality', 'holds', 'issue', 'lifecycle', 'objective', 'order', 'out_of_scope', 'pr_registry', 'scope', 'summary', 'title'];
  return isRecord(value)
    && exactKeys(value, keys)
    && isStringArray(value.boundaries)
    && isStringArray(value.deliverables)
    && Array.isArray(value.dependencies) && value.dependencies.every(isIssue)
    && isStringArray(value.done_when)
    && typeof value.eli5 === 'string'
    && Array.isArray(value.epochs) && value.epochs.every(validateEpoch)
    && validateFinality(value.finality)
    && Array.isArray(value.holds) && value.holds.every(validateHold)
    && isIssue(value.issue)
    && ['COMPLETED', 'CURRENT', 'QUEUED'].includes(value.lifecycle)
    && typeof value.objective === 'string'
    && Number.isSafeInteger(value.order)
    && isStringArray(value.out_of_scope)
    && Array.isArray(value.pr_registry) && value.pr_registry.every((entry) => validateRegistryEntry(entry))
    && isStringArray(value.scope)
    && typeof value.summary === 'string'
    && typeof value.title === 'string';
}
function validateParent(value) {
  return isRecord(value)
    && exactKeys(value, ['goal', 'issue', 'title'])
    && typeof value.goal === 'string'
    && value.issue === PARENT_ISSUE
    && typeof value.title === 'string';
}
function validatePrDescriptor(value) {
  const keys = ['changed_surfaces', 'child_issue', 'design_constraints', 'eli5', 'evidence_refs', 'number', 'out_of_scope', 'purpose', 'scope', 'summary', 'validation_requirements'];
  return isRecord(value)
    && hasOnly(value, keys, ['candidate'])
    && isStringArray(value.changed_surfaces)
    && isIssue(value.child_issue)
    && isStringArray(value.design_constraints)
    && typeof value.eli5 === 'string'
    && Array.isArray(value.evidence_refs) && value.evidence_refs.every((item) => isSafeId(item))
    && isIssue(value.number)
    && isStringArray(value.out_of_scope)
    && typeof value.purpose === 'string'
    && isStringArray(value.scope)
    && typeof value.summary === 'string'
    && isStringArray(value.validation_requirements)
    && (!Object.prototype.hasOwnProperty.call(value, 'candidate') || value.candidate === null || validateCanonicalCandidateShape(value.candidate));
}
function validateLane(value) {
  return isRecord(value)
    && exactKeys(value, ['candidate', 'child_issue', 'epoch_id', 'gate', 'gate_result', 'gate_state', 'lane_id', 'work_claims'])
    && isRecord(value.candidate)
    && isSafeId(value.candidate.branch, 240)
    && value.candidate.base_ref === FROZEN_BASE_REF
    && isSha(value.candidate.base_sha)
    && isSha(value.candidate.head)
    && isSha(value.candidate.tree)
    && isSafeId(value.candidate.epoch_id)
    && isIssue(value.candidate.pr)
    && typeof value.candidate.version === 'string'
    && isIssue(value.child_issue)
    && isSafeId(value.epoch_id)
    && isSafeId(value.gate)
    && (value.gate_result === null || typeof value.gate_result === 'string')
    && value.gate_state === 'ACTIVE'
    && isSafeId(value.lane_id)
    && Array.isArray(value.work_claims)
    && value.work_claims.every((claim) => isRecord(claim)
      && exactKeys(claim, ['mode', 'operation', 'resource'])
      && isSafeId(claim.mode) && isSafeId(claim.operation) && isSafeId(claim.resource, 240));
}
function validateEvidenceRef(value) {
  return isRecord(value)
    && exactKeys(value, ['id', 'kind', 'reference', 'summary'])
    && isSafeId(value.id)
    && isSafeId(value.kind)
    && isSafeId(value.reference, 512)
    && typeof value.summary === 'string';
}
function validateTransition(value) {
  return isRecord(value)
    && exactKeys(value, ['child_issue', 'disposition', 'epoch_id', 'evidence_ref', 'gate', 'id'])
    && isIssue(value.child_issue)
    && isSafeId(value.disposition)
    && isSafeId(value.epoch_id)
    && isSafeId(value.evidence_ref)
    && isSafeId(value.gate)
    && isSafeId(value.id);
}
function validateOldRoot(value) {
  return isRecord(value)
    && exactKeys(value, ['disposition', 'repair_budget', 'root', 'terminal'])
    && value.root === OLD_ROOT
    && value.disposition === 'NON_CONVERGENT'
    && value.terminal === true
    && isRecord(value.repair_budget)
    && exactKeys(value.repair_budget, ['further_repair_authorised', 'limit', 'used'])
    && value.repair_budget.used === 2
    && value.repair_budget.limit === 2
    && value.repair_budget.further_repair_authorised === false;
}
function validateRecoveryState(value) {
  return isRecord(value)
    && exactKeys(value, ['active_blocking_recovery_hold', 'e3_status', 'e4_status', 'lock', 'normal_active_lanes', 'old_root', 'parked_root', 'queued_children', 'root', 'status'])
    && value.root === RECOVERY_ROOT
    && value.lock === LOCK
    && value.status === 'HELD'
    && value.normal_active_lanes === 0
    && value.active_blocking_recovery_hold === true
    && value.e3_status === 'UNACCEPTED'
    && value.e4_status === 'PENDING'
    && same(value.queued_children, [360, 361, 362, 363])
    && validateOldRoot(value.old_root)
    && isRecord(value.parked_root)
    && exactKeys(value.parked_root, ['root', 'status'])
    && value.parked_root.root === PARKED_ROOT
    && value.parked_root.status === 'NOT_LAUNCHED';
}
function hasWebEvidence(state, id, reference) {
  return Array.isArray(state?.evidence_refs)
    && state.evidence_refs.filter((item) => item.id === id && item.kind === 'WEB' && item.reference === reference).length === 1;
}
function eligibleRecoveryHold(child, state) {
  return Array.isArray(child?.holds)
    && child.holds.length === 1
    && same(child.holds[0], recoveryHold())
    && hasWebEvidence(state, HOLD_EVIDENCE_REF, HOLD_EVIDENCE_REFERENCE);
}
function validateCanonicalStateV5(value) {
  if (looksLikeInterEpochState(value)) return validateInterEpochStateV5(value);
  const required = ['active_lanes', 'children', 'concurrency_authority', 'design_lock', 'evidence_refs', 'extensions', 'historical_transitions', 'parent', 'predecessor_contract_digest', 'prs', 'repository', 'schema'];
  const optional = ['recovery'];
  if (!hasOnly(value, required, optional)
    || value.schema !== STATE_SCHEMA
    || value.repository !== REPOSITORY
    || typeof value.design_lock !== 'string'
    || !validateParent(value.parent)
    || !isDigest(value.predecessor_contract_digest)
    || !Array.isArray(value.children)
    || value.children.length !== 6
    || !value.children.every(validateChild)
    || !Array.isArray(value.prs)
    || !value.prs.every(validatePrDescriptor)
    || !isRecord(value.concurrency_authority)
    || !exactKeys(value.concurrency_authority, ['authority_digest', 'authority_ref', 'max_active_lanes', 'mode', 'permitted_child_issues'])
    || (value.concurrency_authority.authority_digest !== null && !isDigest(value.concurrency_authority.authority_digest))
    || (value.concurrency_authority.authority_ref !== null && !isSafeId(value.concurrency_authority.authority_ref))
    || value.concurrency_authority.max_active_lanes !== 1
    || value.concurrency_authority.mode !== 'SINGLE_DEFAULT'
    || !Array.isArray(value.concurrency_authority.permitted_child_issues)
    || value.concurrency_authority.permitted_child_issues.some((item) => !isIssue(item))
    || !Array.isArray(value.active_lanes)
    || !Array.isArray(value.evidence_refs)
    || !value.evidence_refs.every(validateEvidenceRef)
    || !Array.isArray(value.historical_transitions)
    || !value.historical_transitions.every(validateTransition)
    || !Array.isArray(value.extensions)
    || value.extensions.some((item) => !isRecord(item))) return failure('V5_STATE_INVALID');
  const expectedIssues = [358, 359, 360, 361, 362, 363];
  const issues = value.children.map((child) => child.issue);
  if (!same(issues, expectedIssues) || new Set(issues).size !== issues.length) return failure('V5_STATE_INVALID', { reason: 'child_topology' });
  if (value.children.some((child, index) => child.order !== index + 1)) return failure('V5_STATE_INVALID', { reason: 'child_order' });
  const current = value.children.filter((child) => child.lifecycle === 'CURRENT');
  if (current.length !== 1 || current[0].issue !== CHILD_ISSUE) return failure('V5_STATE_INVALID', { reason: 'current_child' });
  const laneChildren = new Set();
  for (const lane of value.active_lanes) {
    if (!validateLane(lane) || laneChildren.has(lane.child_issue)) return failure('V5_STATE_INVALID', { reason: 'active_lane' });
    laneChildren.add(lane.child_issue);
    const child = value.children.find((item) => item.issue === lane.child_issue);
    if (!child || child.lifecycle !== 'CURRENT') return failure('V5_STATE_INVALID', { reason: 'lane_not_current' });
  }
  if (value.active_lanes.length > value.concurrency_authority.max_active_lanes) return failure('V5_STATE_INVALID', { reason: 'lane_limit' });
  if (value.active_lanes.length === 0) {
    if (!Object.prototype.hasOwnProperty.call(value, 'recovery') || !validateRecoveryState(value.recovery)
      || current[0].finality.state !== 'HELD' || !eligibleRecoveryHold(current[0], value)) {
      return failure('V5_CURRENT_ZERO_LANE_HOLD_REQUIRED');
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'recovery')) {
    if (!validateRecoveryState(value.recovery)
      || value.active_lanes.length !== 0
      || value.children.find((child) => child.issue === CHILD_ISSUE).finality.state !== 'HELD'
      || !eligibleRecoveryHold(value.children.find((child) => child.issue === CHILD_ISSUE), value)) {
      return failure('V5_RECOVERY_STATE_INVALID');
    }
    const registry = value.children.find((child) => child.issue === CHILD_ISSUE).pr_registry;
    if (registry.length !== 2) return failure('V5_RECOVERY_STATE_INVALID', { reason: 'pr_registry_count' });
    const byPr = new Map(registry.map((entry) => [entry.pr, entry]));
    if (!byPr.has(366) || !byPr.has(379)
      || !validateRegistryEntry(byPr.get(366), true)
      || !validateRegistryEntry(byPr.get(379), true)
      || !same(byPr.get(366), retired366RegistryEntry())
      || !same(byPr.get(379), retainedRegistryEntry())) {
      return failure('V5_RECOVERY_STATE_INVALID', { reason: 'pr_registry_semantics' });
    }
    if (!hasWebEvidence(value, RETENTION_EVIDENCE_REF, RETENTION_EVIDENCE_REFERENCE)) {
      return failure('V5_RECOVERY_STATE_INVALID', { reason: 'retention_evidence' });
    }
    if (TARGET_CANONICAL_DIGEST !== null && digestValue(value) !== TARGET_CANONICAL_DIGEST) {
      return failure('V5_RECOVERY_TARGET_NOT_EXACT');
    }
  }
  return success('V5_STATE_VALID', { state: clone(value), canonical_digest: digestValue(value) });
}

function recoveryAuthorityEvidence(entry) {
  if (entry.issue === CHILD_ISSUE && entry.comment_id === 5580530088) {
    return {
      id: HOLD_EVIDENCE_REF,
      kind: 'WEB',
      reference: HOLD_EVIDENCE_REFERENCE,
      summary: 'Accepted G1 recovery-hold authority body bound by digest.',
    };
  }
  if (entry.issue === 379 && entry.comment_id === 5580538176) {
    return {
      id: RETENTION_EVIDENCE_REF,
      kind: 'WEB',
      reference: RETENTION_EVIDENCE_REFERENCE,
      summary: 'Accepted retained PR #379 chronology body bound by digest.',
    };
  }
  return {
    id: 'recovery-authority-' + String(entry.comment_id),
    kind: 'WEB',
    reference: 'github:issue-comment:' + String(entry.issue) + ':' + String(entry.comment_id),
    summary: 'Accepted recovery authority body bound by digest.',
  };
}
function recoveryPredecessorEvidence(entry) {
  if (entry.issue === CHILD_ISSUE && entry.comment_id === 5580530088) {
    return {
      id: HOLD_EVIDENCE_REF,
      kind: 'WEB',
      reference: HOLD_EVIDENCE_REFERENCE,
      summary: 'Accepted G1 recovery-hold authority body bound by digest.',
    };
  }
  if (entry.issue === 379 && entry.comment_id === 5580538176) {
    return {
      id: RETENTION_EVIDENCE_REF,
      kind: 'WEB',
      reference: RETENTION_EVIDENCE_REFERENCE,
      summary: 'Accepted retained PR #379 chronology body bound by digest.',
    };
  }
  return {
    id: 'recovery-predecessor-' + String(entry.comment_id),
    kind: 'WEB',
    reference: 'github:issue-comment:' + String(entry.issue) + ':' + String(entry.comment_id),
    summary: 'Predecessor non-convergence evidence bound by digest.',
  };
}
function buildRecoveryTargetState(sourceState) {
  const valid = validateCanonicalStateV5(sourceState);
  if (!valid.ok || Object.prototype.hasOwnProperty.call(sourceState, 'recovery')) return null;
  const next = clone(sourceState);
  next.design_lock = LOCK;
  next.active_lanes = [];
  next.concurrency_authority.permitted_child_issues = [];
  const child = next.children.find((item) => item.issue === CHILD_ISSUE);
  child.summary = 'E1 and E2 remain accepted; E3 is held in a zero-lane recovery window pending separate Web acceptance.';
  child.done_when = [
    'E1 and E2 remain accepted with retained evidence.',
    'The v5 projection recovery is read back exactly and separate Web authority records E3 acceptance.',
    'E4 truthful native adapters are complete and Web records S2 finality.',
  ];
  child.scope = [
    'Read-only v5 programme projection bootstrap recovery for the canonical parent and current child.',
    'Preservation of retained and historical PR chronology without launching a normal gate.',
  ];
  child.out_of_scope = [
    'G4 result or E3 acceptance before separate Web authority.',
    'Ready, merge, finality, E4 execution and S3 through S6 progression.',
    'Programme Apply or any provider operation in this recovery window.',
  ];
  child.boundaries = [
    'Web owns E3 acceptance, Ready, merge and finality.',
    'The recovery hold is Web-exclusive and has no provider CAS claim.',
    'E4 and S3 through S6 remain pending or blocked/queued.',
  ];
  child.eli5 = 'The programme is paused safely while the two managed views are repaired from trusted Web evidence; no normal work lane is running.';
  child.finality = { authority_ref: null, state: 'HELD' };
  child.holds = [recoveryHold()];
  child.pr_registry = [retired366RegistryEntry(), retainedRegistryEntry()];
  const oldPr = next.prs.find((item) => item.number === 366);
  if (oldPr) {
    oldPr.summary = 'Historical PR #366 is closed and retired; no merged candidate is active.';
  }
  next.evidence_refs = [
    ...next.evidence_refs,
    ...DECISION_TEMPLATE.web_authority.controlling.map(recoveryAuthorityEvidence),
    ...DECISION_TEMPLATE.web_authority.predecessor.map(recoveryPredecessorEvidence),
  ];
  next.recovery = recoveryState();
  return next;
}

function childByIssue(state, issue) { return state.children.find((child) => child.issue === issue) || null; }
function childSnapshotState(state) {
  const child = childByIssue(state, CHILD_ISSUE);
  const lane = state.active_lanes.find((item) => item.child_issue === CHILD_ISSUE) || null;
  return {
    lifecycle: child.lifecycle,
    finality: child.finality.state,
    gate_state: state.recovery ? 'HELD' : lane ? lane.gate_state : 'NONE',
    normal_active_lanes: state.active_lanes.length,
    active_blocking_recovery_hold: Boolean(state.recovery && eligibleRecoveryHold(child, state)),
  };
}
function projectionPayload(state, kind) {
  const child = childByIssue(state, CHILD_ISSUE);
  const interEpoch = looksLikeInterEpochState(state);
  if (kind === 'parent') {
    const payload = {
      schema: PROJECTION_SCHEMA,
      kind: 'parent',
      number: PARENT_ISSUE,
      parent_issue: PARENT_ISSUE,
      repository: REPOSITORY,
      lifecycle: state.recovery ? 'HELD' : 'ACTIVE',
      finality: state.recovery ? 'HELD' : child.finality.state,
      normal_active_lanes: state.active_lanes.length,
      active_blocking_recovery_hold: Boolean(state.recovery),
      current_child_issues: state.children.filter((item) => item.lifecycle === 'CURRENT').map((item) => item.issue),
      queued_children: state.children.filter((item) => item.lifecycle === 'QUEUED').map((item) => item.issue),
      retained_pr: state.recovery ? 379 : null,
      retired_pr: state.recovery ? 366 : interEpoch ? 379 : null,
      accepted_pr: interEpoch ? 380 : null,
      pr_379_github_state: interEpoch ? child.pr_registry.find((entry) => entry.pr === 379)?.github_state : null,
      e3_status: state.recovery ? 'UNACCEPTED' : interEpoch ? 'ACCEPTED' : null,
      e4_status: state.recovery || interEpoch ? 'PENDING' : null,
      old_root: state.recovery ? OLD_ROOT : null,
      parked_root: state.recovery ? PARKED_ROOT : null,
    };
    if (state.recovery) {
      delete payload.accepted_pr;
      delete payload.pr_379_github_state;
    }
    return payload;
  }
  const payload = {
    schema: PROJECTION_SCHEMA,
    kind: 'child',
    number: CHILD_ISSUE,
    parent_issue: PARENT_ISSUE,
    repository: REPOSITORY,
    lifecycle: child.lifecycle,
    finality: child.finality.state,
    epoch: 'E3',
    gate: state.recovery || interEpoch ? 'NONE' : 'G4',
    gate_state: state.recovery ? 'HELD' : interEpoch ? 'NONE' : 'ACTIVE',
    normal_active_lanes: state.active_lanes.length,
    active_blocking_recovery_hold: Boolean(state.recovery && eligibleRecoveryHold(child, state)),
    e3_status: state.recovery ? 'UNACCEPTED' : interEpoch ? 'ACCEPTED' : 'ACTIVE',
    e4_status: 'PENDING',
    retained_pr: state.recovery ? 379 : null,
    retired_pr: state.recovery ? 366 : interEpoch ? 379 : null,
    accepted_pr: interEpoch ? 380 : null,
    pr_379_github_state: interEpoch ? child.pr_registry.find((entry) => entry.pr === 379)?.github_state : null,
    queued_children: [360, 361, 362, 363],
    old_root: state.recovery ? OLD_ROOT : null,
    parked_root: state.recovery ? PARKED_ROOT : null,
  };
  if (state.recovery) {
    delete payload.accepted_pr;
    delete payload.pr_379_github_state;
  }
  return payload;
}
function projectionEnvelope(state, kind) {
  const payload = projectionPayload(state, kind);
  const extension = {
    schema: SURFACE_SCHEMA,
    recovery: state.recovery || null,
  };
  if (looksLikeInterEpochState(state)) extension.finalisation = FINALISATION_ROOT;
  return {
    canonical_digest: digestValue(state),
    extension_digest: digestValue(extension),
    kind,
    number: kind === 'parent' ? PARENT_ISSUE : CHILD_ISSUE,
    parent_issue: PARENT_ISSUE,
    projection_digest: digestValue(payload),
    repository: REPOSITORY,
    schema: PROJECTION_SCHEMA,
  };
}
function validateProjectionEnvelope(value, kind, canonicalDigest) {
  if (!isRecord(value)
    || !exactKeys(value, ['canonical_digest', 'extension_digest', 'kind', 'number', 'parent_issue', 'projection_digest', 'repository', 'schema'])
    || !isDigest(value.canonical_digest)
    || !isDigest(value.extension_digest)
    || value.kind !== kind
    || value.number !== (kind === 'parent' ? PARENT_ISSUE : CHILD_ISSUE)
    || value.parent_issue !== PARENT_ISSUE
    || !isDigest(value.projection_digest)
    || value.repository !== REPOSITORY
    || value.schema !== PROJECTION_SCHEMA
    || canonicalDigest !== undefined && value.canonical_digest !== canonicalDigest) return false;
  return true;
}
const MANAGED_MARKERS = Object.freeze({
  parent: Object.freeze({
    begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v5 -->',
    end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->',
  }),
  child: Object.freeze({
    begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v5 -->',
    end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->',
  }),
});
function splitManagedBlock(body, kind) {
  if (typeof body !== 'string') return null;
  const marker = MANAGED_MARKERS[kind];
  const start = body.indexOf(marker.begin);
  const end = body.indexOf(marker.end);
  if (start < 0 || end < start || body.indexOf(marker.begin, start + marker.begin.length) >= 0
    || body.indexOf(marker.end, end + marker.end.length) >= 0) return null;
  return {
    prefix: body.slice(0, start),
    managed: body.slice(start, end + marker.end.length),
    suffix: body.slice(end + marker.end.length),
  };
}
function markerPayload(body, expression) {
  const matches = [...body.matchAll(expression)];
  return matches.length === 1 ? matches[0][1] : null;
}
function parseParentV5Body(body, options = {}) {
  if (options.complete === false || typeof body !== 'string') return failure('PARENT_V5_BODY_INCOMPLETE');
  const split = splitManagedBlock(body, 'parent');
  if (!split) return failure('PARENT_V5_PARSE_UNCERTAIN');
  const encoded = markerPayload(split.managed, /^<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v5 ([A-Za-z0-9_-]+) -->$/gm);
  if (!encoded) return failure('PARENT_V5_PARSE_UNCERTAIN');
  const decoded = fromBase64url(encoded);
  if (decoded === null) return failure('PARENT_V5_PARSE_UNCERTAIN');
  let payload;
  try { payload = JSON.parse(decoded); } catch (_error) { return failure('PARENT_V5_PARSE_UNCERTAIN'); }
  if (!isRecord(payload) || !exactKeys(payload, ['envelope', 'state'])) return failure('PARENT_V5_PARSE_UNCERTAIN');
  const stateValid = validateCanonicalStateV5(payload.state);
  if (!stateValid.ok || !validateProjectionEnvelope(payload.envelope, 'parent', stateValid.canonical_digest)) return failure('PARENT_V5_STATE_INVALID');
  if (options.repository && options.repository !== payload.state.repository) return failure('PARENT_V5_IDENTITY_MISMATCH');
  if (options.parent_issue && options.parent_issue !== payload.state.parent.issue) return failure('PARENT_V5_IDENTITY_MISMATCH');
  return success('PARENT_V5_VALID', {
    kind: 'parent',
    state: clone(payload.state),
    envelope: clone(payload.envelope),
    prefix: split.prefix,
    suffix: split.suffix,
    managed: split.managed,
    body_digest: sha256Text(body),
    managed_digest: sha256Text(split.managed),
    prefix_digest: sha256Text(split.prefix),
    suffix_digest: sha256Text(split.suffix),
  });
}
function parseChildV5Body(body, options = {}) {
  if (options.complete === false || typeof body !== 'string') return failure('CHILD_V5_BODY_INCOMPLETE');
  const split = splitManagedBlock(body, 'child');
  if (!split) return failure('CHILD_V5_PARSE_UNCERTAIN');
  const encoded = markerPayload(split.managed, /^<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 ([A-Za-z0-9_-]+) -->$/gm);
  if (!encoded) return failure('CHILD_V5_PARSE_UNCERTAIN');
  const decoded = fromBase64url(encoded);
  if (decoded === null) return failure('CHILD_V5_PARSE_UNCERTAIN');
  let envelope;
  try { envelope = JSON.parse(decoded); } catch (_error) { return failure('CHILD_V5_PARSE_UNCERTAIN'); }
  if (!validateProjectionEnvelope(envelope, 'child', options.canonical_digest)) return failure('CHILD_V5_PROJECTION_INVALID');
  if (options.repository && options.repository !== envelope.repository) return failure('CHILD_V5_IDENTITY_MISMATCH');
  if (options.parent_issue && options.parent_issue !== envelope.parent_issue) return failure('CHILD_V5_IDENTITY_MISMATCH');
  return success('CHILD_V5_VALID', {
    kind: 'child',
    envelope: clone(envelope),
    prefix: split.prefix,
    suffix: split.suffix,
    managed: split.managed,
    body_digest: sha256Text(body),
    managed_digest: sha256Text(split.managed),
    prefix_digest: sha256Text(split.prefix),
    suffix_digest: sha256Text(split.suffix),
  });
}
function parseProgrammeV5Body(body, kind, options = {}) {
  return kind === 'parent' ? parseParentV5Body(body, options) : parseChildV5Body(body, options);
}

function managedContent(kind, state) {
  const child = childByIssue(state, CHILD_ISSUE);
  const recovery = state.recovery || null;
  const interEpoch = looksLikeInterEpochState(state);
  const registry = child.pr_registry;
  const registryRows = registry.map((entry) => '| #' + String(entry.pr) + ' | ' + entry.status + ' | ' + (entry.github_state || 'UNKNOWN') + ' | ' + String(entry.draft ?? false) + ' | ' + String(entry.merged ?? false) + ' | ' + entry.role + ' | ' + String(entry.completes_child) + ' | ' + entry.epoch_id + ' |');
  const e3Status = recovery ? 'UNACCEPTED / HELD' : interEpoch ? 'ACCEPTED' : 'ACTIVE';
  const e3LegacyStatus = recovery ? 'UNACCEPTED' : e3Status;
  const e4Status = 'PENDING';
  const gateState = recovery ? 'HELD' : interEpoch ? 'NONE' : 'ACTIVE';
  const lines = [];
  if (kind === 'parent') {
    lines.push(
      MANAGED_MARKERS.parent.begin,
      '# AI Agent Toolkit Programme',
      '',
      '## Programme status',
      '| Field | Value |',
      '| --- | --- |',
      '| Repository | ' + REPOSITORY + ' |',
      '| Programme lifecycle | ' + (recovery ? 'HELD' : 'ACTIVE') + ' |',
      '| Programme finality | ' + (recovery ? 'HELD' : child.finality.state) + ' |',
      '| Normal active lanes | ' + String(state.active_lanes.length) + ' |',
      '| Active blocking recovery hold | ' + (recovery ? 'YES' : 'NO') + ' |',
      '',
      '## Active normal lanes',
      recovery ? 'None. #359 is held by the eligible blocking recovery hold.' : String(state.active_lanes.length),
      '',
      '## Children',
      '| Issue | Lifecycle | Gate state | Result |',
      '| --- | --- | --- | --- |',
    );
    for (const item of state.children) {
      const blocked = recovery && item.lifecycle === 'QUEUED' ? 'BLOCKED/QUEUED' : item.lifecycle;
      const result = item.issue === CHILD_ISSUE && recovery ? 'CURRENT / HELD' : blocked;
      lines.push('| #' + String(item.issue) + ' | ' + blocked + ' | ' + (item.issue === CHILD_ISSUE && recovery ? 'HELD' : 'NONE') + ' | ' + result + ' |');
    }
    lines.push(
      '',
      '## PR registry',
      '| PR | Status | GitHub state | Draft | Merged | Role | Completes child | Epoch |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...registryRows,
      '',
      '## Recovery hold',
      recovery ? '- Active blocking recovery hold: YES' : '- Active blocking recovery hold: NO',
      recovery ? '- Write safety: ' + WRITE_SAFETY_MODE : '- No recovery window is active.',
      recovery ? '- Provider CAS claim: NO' : '',
      recovery ? '- Hold evidence: ' + HOLD_EVIDENCE_REF : '',
      recovery ? '- #379 retention evidence: ' + RETENTION_EVIDENCE_REF : '',
      '',
      '## Root dispositions',
      recovery ? '- Old root: ' + OLD_ROOT + ' / NON_CONVERGENT / terminal=true / repair budget=2/2 / further repair authorised=false' : '- None',
      recovery ? '- Parked root: ' + PARKED_ROOT + ' / NOT_LAUNCHED' : '',
      '',
      '## Epoch and queue status',
      '- E3: ' + e3LegacyStatus,
      '- E4: ' + e4Status,
      '- S3-S6: BLOCKED/QUEUED',
      '- G4 active: NO',
      '',
      '## Boundaries',
      '- Web owns E3 acceptance, Ready, merge and finality.',
      '- No normal G1/G2/G3/G4 lane is manufactured by this recovery.',
      '- Programme Apply is not authorised.',
      '',
      '## Next action',
      recovery
        ? 'Maintain the Web-exclusive recovery hold and wait for fresh prewrite evidence; do not launch G4 or Programme Apply.'
        : 'E3 is accepted at a clean inter-epoch boundary; keep E4 pending and do not launch E4 or Programme Apply.',
      '',
      '## ELI5',
      recovery
        ? 'The programme is paused safely while its two managed views are rebuilt from trusted Web evidence.'
        : 'E3 is accepted, E4 is still pending, and no normal work lane is running.',
      '',
      '## Additional context',
      interEpoch
        ? 'PR #380 is the accepted merged intermediate candidate; PR #379 is retired chronology and does not complete the child.'
        : 'The retained PR is chronology only; it is not active execution, accepted, Ready, G4, merged or child completion.',
      '',
      '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v5 ' + base64url(JSON.stringify({ envelope: projectionEnvelope(state, 'parent'), state })) + ' -->',
      MANAGED_MARKERS.parent.end,
    );
    return lines.join('\n');
  }
  lines.push(
    MANAGED_MARKERS.child.begin,
    '# S2 - Productize retained skills + native host adapters',
    '',
    '## Summary',
    child.summary,
    '',
    '## Operating contract',
    '| Field | Value |',
    '| --- | --- |',
    '| Parent | #240 |',
    '| Lane | ' + (state.active_lanes.length === 0 ? 'None' : String(state.active_lanes.length)) + ' |',
    '| Lifecycle | CURRENT |',
    '| Epoch | E3 |',
    '| Gate | ' + (recovery ? 'None' : interEpoch ? 'None' : 'G4') + ' |',
    '| Gate state | ' + gateState + ' |',
    '| Lock | ' + state.design_lock + ' |',
    '| Finality | ' + child.finality.state + ' |',
    '',
    '## Objective',
    child.objective,
    '',
    '## Progress',
    '- E1: ACCEPTED',
    '- E2: ACCEPTED',
    '- E3: ' + e3LegacyStatus,
    '- E4: ' + e4Status,
    '- Normal active lanes: ' + String(state.active_lanes.length),
    '- Active blocking recovery hold: ' + (recovery ? 'YES' : 'NO'),
    '',
    '## PR registry',
    '| PR | Status | GitHub state | Draft | Merged | Role | Completes child | Epoch |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...registryRows,
    '',
    '## Holds',
    '- Active blocking recovery hold: ' + (recovery ? 'YES' : 'NO'),
    recovery ? '- Write safety: ' + WRITE_SAFETY_MODE : '- Write safety: ' + FINALISATION_WRITE_SAFETY_MODE,
    '- Provider CAS claim: NO',
    recovery ? '- Hold evidence: ' + HOLD_EVIDENCE_REF : '- No recovery hold is active.',
    '',
    '## Epochs / Locks',
    '| Epoch | State |',
    '| --- | --- |',
    '| E1 | ACCEPTED |',
    '| E2 | ACCEPTED |',
    '| E3 | ' + e3Status + ' |',
    '| E4 | PENDING |',
    '',
    '## Boundaries',
    '- G4 active: ' + (interEpoch ? 'NO.' : 'NO.'),
    '- E3 acceptance, Ready, merge and finality remain Web-owned.',
    '- S3-S6 remain BLOCKED/QUEUED.',
    '- Programme Apply is not authorised.',
    '',
    '## Next action',
    recovery
      ? 'Maintain the blocking recovery hold; collect fresh prewrite evidence and exact readback only under the authorised Web window.'
      : 'Keep E4 pending; no E4 activation, Programme Apply, or provider operation is performed by this source-only contract.',
    '',
    '## Root dispositions',
    '- Old root: ' + OLD_ROOT + ' / NON_CONVERGENT / terminal=true / repair budget=2/2 / further repair authorised=false',
    '- Parked root: ' + PARKED_ROOT + ' / NOT_LAUNCHED',
    '- #379 retention evidence: ' + RETENTION_EVIDENCE_REF,
    '',
    '## ELI5',
    recovery
      ? 'The current child is held safely with no normal work lane while the parent and child views are repaired together.'
      : 'The current child remains unmerged at a clean inter-epoch boundary while E4 waits for separate authority.',
    '',
    '## Additional context',
    interEpoch
      ? 'PR #380 remains immutable accepted merge evidence. PR #379 transitions from OPEN to CLOSED while its registry status is RETIRED.'
      : 'Retained PR #379 remains frozen chronology. Retired PR #366 is historical only.',
    '',
    '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 ' + base64url(JSON.stringify(projectionEnvelope(state, 'child'))) + ' -->',
    MANAGED_MARKERS.child.end,
  );
  return lines.join('\n');
}
function renderProgrammeV5(state) {
  const valid = validateCanonicalStateV5(state);
  if (!valid.ok) return valid;
  const parent = managedContent('parent', state);
  const child = managedContent('child', state);
  return success('V5_RENDER_READY', {
    state: clone(state),
    canonical_digest: digestValue(state),
    parent,
    child,
    projections: {
      parent: projectionEnvelope(state, 'parent'),
      child: projectionEnvelope(state, 'child'),
    },
  });
}
function materialize(parsed, managed) {
  return parsed.prefix + managed + parsed.suffix;
}

function normalizedReviewFacts(value) {
  return value.map(({ id, user, state, submitted_at, body_digest }) => ({ id, user, state, submitted_at, body_digest }));
}
function normalizedCommentFacts(value) {
  return value.map(({ id, user, created_at, updated_at, body_digest }) => ({ id, user, created_at, updated_at, body_digest }));
}
function validatePR379(value) {
  const required = ['repository', 'pr', 'state', 'draft', 'merged', 'merged_at', 'head', 'tree', 'branch', 'base_ref', 'base_sha', 'changed_files', 'candidate', 'reviews', 'threads', 'comments', 'checks', 'facts_digest', 'complete'];
  if (!isRecord(value) || !exactKeys(value, required)
    || value.repository !== REPOSITORY
    || value.pr !== 379
    || value.state !== 'OPEN'
    || value.draft !== true
    || value.merged !== false
    || value.merged_at !== null
    || value.head !== FROZEN_HEAD
    || value.tree !== FROZEN_TREE
    || value.branch !== FROZEN_BRANCH
    || value.base_ref !== FROZEN_BASE_REF
    || value.base_sha !== MAIN_SHA
    || value.changed_files !== 48
    || !validateCandidate(value.candidate)
    || !Array.isArray(value.reviews)
    || !Array.isArray(value.threads)
    || !Array.isArray(value.comments)
    || !Array.isArray(value.checks)
    || !isDigest(value.facts_digest)
    || value.complete !== true) return failure('RECOVERY_PR379_INVALID');
  const expectedReviews = PR379_REVIEW_FACTS;
  if (value.reviews.length !== expectedReviews.length || value.reviews.some((item, index) => !isRecord(item)
    || !exactKeys(item, ['id', 'user', 'state', 'submitted_at', 'body', 'body_digest'])
    || item.id !== expectedReviews[index].id
    || item.user !== expectedReviews[index].user
    || item.state !== expectedReviews[index].state
    || item.submitted_at !== expectedReviews[index].submitted_at
    || typeof item.body !== 'string'
    || sha256Text(item.body) !== item.body_digest
    || item.body_digest !== expectedReviews[index].body_digest)) return failure('RECOVERY_PR379_REVIEW_MOVED');
  if (!same(value.threads, [])) return failure('RECOVERY_PR379_THREAD_MOVED');
  const expectedComments = PR379_COMMENT_FACTS;
  if (value.comments.length !== expectedComments.length || value.comments.some((item, index) => !isRecord(item)
    || !exactKeys(item, ['id', 'user', 'created_at', 'updated_at', 'body', 'body_digest'])
    || item.id !== expectedComments[index].id
    || item.user !== expectedComments[index].user
    || item.created_at !== expectedComments[index].created_at
    || item.updated_at !== expectedComments[index].updated_at
    || typeof item.body !== 'string'
    || sha256Text(item.body) !== item.body_digest
    || item.body_digest !== expectedComments[index].body_digest)) return failure('RECOVERY_PR379_COMMENT_MOVED');
  if (value.checks.length !== PR379_CHECK_FACTS.length || value.checks.some((item, index) => !same(item, PR379_CHECK_FACTS[index]))) return failure('RECOVERY_PR379_CHECK_MOVED');
  const computed = factsDigest(value.reviews, value.threads, value.comments, value.checks);
  if (value.facts_digest !== computed || value.facts_digest !== DECISION_TEMPLATE.pr_379.facts_digest) return failure('RECOVERY_PR379_FACTS_INVALID');
  return success('RECOVERY_PR379_VALID');
}
function validatePR366(value) {
  return isRecord(value)
    && exactKeys(value, ['pr', 'status', 'github_state', 'draft', 'merged', 'merged_at', 'merge_commit', 'role', 'completes_child', 'candidate', 'head', 'tree', 'base_ref', 'base_sha', 'complete'])
    && value.pr === 366
    && value.status === 'RETIRED'
    && value.github_state === 'CLOSED'
    && value.draft === true
    && value.merged === false
    && value.merged_at === null
    && value.merge_commit === null
    && value.role === 'INTERMEDIATE'
    && value.completes_child === false
    && value.candidate === null
    && value.head === PR366_HEAD
    && value.tree === PR366_TREE
    && value.base_ref === FROZEN_BASE_REF
    && value.base_sha === PR366_BASE_SHA
    && value.complete === true;
}
const PAGINATION_COLLECTIONS = Object.freeze({
  parent: Object.freeze({ endpoint: 'github:issues/240', items: 1, transport_mode: 'DIRECT', server_total: 'UNAVAILABLE' }),
  child: Object.freeze({ endpoint: 'github:issues/359', items: 1, transport_mode: 'DIRECT', server_total: 'UNAVAILABLE' }),
  native_children: Object.freeze({ endpoint: 'github:issues/240/sub_issues', items: 6, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  current_label: Object.freeze({ endpoint: 'github:issues/359/labels', items: 1, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  pr366: Object.freeze({ endpoint: 'github:pulls/366', items: 1, transport_mode: 'DIRECT', server_total: 'UNAVAILABLE' }),
  pr379: Object.freeze({ endpoint: 'github:pulls/379', items: 1, transport_mode: 'DIRECT', server_total: 'UNAVAILABLE' }),
  reviews: Object.freeze({ endpoint: 'github:pulls/379/reviews', items: 1, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  threads: Object.freeze({ endpoint: 'github:pulls/379/review-threads', items: 0, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  review_thread_comments: Object.freeze({ endpoint: 'github:pulls/379/review-thread-comments', items: 0, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  comments: Object.freeze({ endpoint: 'github:issues/379/comments', items: 6, transport_mode: 'LINK', server_total: 'UNAVAILABLE' }),
  checks: Object.freeze({ endpoint: 'github:commits/' + FROZEN_HEAD + '/check-runs', items: 6, transport_mode: 'LINK', server_total: 'AVAILABLE' }),
  web_authority: Object.freeze({ endpoint: 'github:web-authority:issues/240,359;pull/379', items: 6, transport_mode: 'DIRECT', server_total: 'UNAVAILABLE' }),
});
const PAGINATION_KEYS = Object.freeze(Object.keys(PAGINATION_COLLECTIONS));
const PAGINATION_PAGE_SIZE = 100;
const CHECK_RUNS_TOTAL_FIELD = 'total_count';
function paginationInventory(key, evidence) {
  if (!isRecord(evidence)) return null;
  switch (key) {
    case 'parent':
      return isRecord(evidence.parent) ? {
        issue: evidence.parent.issue,
        body_digest: evidence.parent.body_digest,
        canonical_digest: evidence.parent.canonical_digest,
        revision: evidence.parent.revision,
        native_children: evidence.parent.native_children,
        relationships: evidence.parent.relationships,
      } : null;
    case 'child':
      return isRecord(evidence.child) ? {
        issue: evidence.child.issue,
        body_digest: evidence.child.body_digest,
        canonical_digest: evidence.child.canonical_digest,
        revision: evidence.child.revision,
        labels: evidence.child.labels,
        native_parent: evidence.child.native_parent,
        relationships: evidence.child.relationships,
        sole_current: evidence.child.sole_current,
        dependencies: evidence.child.dependencies,
      } : null;
    case 'native_children':
      return evidence.parent?.native_children || null;
    case 'current_label':
      return evidence.child?.labels || null;
    case 'pr366':
      return evidence.pr_366 || null;
    case 'pr379':
      return evidence.pr_379 || null;
    case 'reviews':
      return Array.isArray(evidence.pr_379?.reviews) ? normalizedReviewFacts(evidence.pr_379.reviews) : null;
    case 'threads':
      return Array.isArray(evidence.pr_379?.threads) ? evidence.pr_379.threads : null;
    case 'review_thread_comments':
      return Array.isArray(evidence.pr_379?.threads) && evidence.pr_379.threads.length === 0 ? [] : null;
    case 'comments':
      return Array.isArray(evidence.pr_379?.comments) ? normalizedCommentFacts(evidence.pr_379.comments) : null;
    case 'checks':
      return Array.isArray(evidence.pr_379?.checks) ? evidence.pr_379.checks : null;
    case 'web_authority':
      return Array.isArray(evidence.web_authority)
        ? evidence.web_authority.map(({ issue, comment_id, body_digest }) => ({ issue, comment_id, body_digest }))
        : null;
    default:
      return null;
  }
}
function validateProviderEvidence(value) {
  return isRecord(value)
    && exactKeys(value, ['check_runs'])
    && isRecord(value.check_runs)
    && exactKeys(value.check_runs, ['endpoint_or_query_identity', 'field', 'value'])
    && value.check_runs.endpoint_or_query_identity === PAGINATION_COLLECTIONS.checks.endpoint
    && value.check_runs.field === CHECK_RUNS_TOTAL_FIELD
    && Number.isSafeInteger(value.check_runs.value)
    && value.check_runs.value >= 0;
}
function providerTotalCount(key, evidence) {
  if (key !== 'checks' || !isRecord(evidence?.provider_evidence?.check_runs)) return null;
  const value = evidence.provider_evidence.check_runs.value;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function inventoryCount(inventory) {
  return Array.isArray(inventory) ? inventory.length : inventory === null ? null : 1;
}
function buildPaginationEvidence(key, evidence) {
  const definition = PAGINATION_COLLECTIONS[key];
  const inventory = paginationInventory(key, evidence);
  const retrievedCount = inventoryCount(inventory);
  if (!definition || inventory === null || !Number.isSafeInteger(retrievedCount)) return null;
  const providerTotal = definition.server_total === 'AVAILABLE' ? providerTotalCount(key, evidence) : null;
  const isLink = definition.transport_mode === 'LINK';
  const pageDigest = digestValue({ endpoint_or_query_identity: definition.endpoint, page: 1, inventory });
  return {
    complete: true,
    endpoint_or_query_identity: definition.endpoint,
    transport_mode: definition.transport_mode,
    page_size: isLink ? PAGINATION_PAGE_SIZE : null,
    page_count: 1,
    ordered_page_digests: [{ page: 1, digest: pageDigest }],
    retrieved_count: retrievedCount,
    provider_total_count: providerTotal,
    server_total: providerTotal === null
      ? { status: 'UNAVAILABLE', value: null }
      : { status: 'AVAILABLE', value: providerTotal },
    progression: isLink ? { style: 'LINK', pages: [{ page: 1, next_url: null }] } : null,
    terminal_state: isLink ? { has_next_page: false, next_url: null } : null,
    inventory_digest: digestValue(inventory),
  };
}
function validateLinkProgression(value) {
  return isRecord(value.progression)
    && exactKeys(value.progression, ['pages', 'style'])
    && value.progression.style === 'LINK'
    && Array.isArray(value.progression.pages)
    && value.progression.pages.length === value.page_count
    && value.progression.pages.every((page, index) => isRecord(page)
      && exactKeys(page, ['next_url', 'page'])
      && page.page === index + 1
      && (page.next_url === null || (typeof page.next_url === 'string' && page.next_url.length > 0 && !/[\r\n]/.test(page.next_url))))
    && value.progression.pages[0]?.next_url === null
    && isRecord(value.terminal_state)
    && exactKeys(value.terminal_state, ['has_next_page', 'next_url'])
    && value.terminal_state.has_next_page === false
    && value.terminal_state.next_url === null
    && value.progression.pages[value.progression.pages.length - 1]?.next_url === value.terminal_state.next_url;
}
function validateDirectTransport(value) {
  return value.page_size === null && value.progression === null && value.terminal_state === null;
}
function validatePage(value, key, evidence) {
  const definition = PAGINATION_COLLECTIONS[key];
  const inventory = paginationInventory(key, evidence);
  const retrievedCount = inventoryCount(inventory);
  const providerTotal = definition ? providerTotalCount(key, evidence) : null;
  const isLink = definition?.transport_mode === 'LINK';
  if (!definition || inventory === null || !isRecord(value)
    || !exactKeys(value, [
      'complete', 'endpoint_or_query_identity', 'inventory_digest', 'ordered_page_digests',
      'page_count', 'page_size', 'progression', 'provider_total_count', 'retrieved_count',
      'server_total', 'terminal_state', 'transport_mode',
    ])
    || value.complete !== true
    || value.endpoint_or_query_identity !== definition.endpoint
    || value.transport_mode !== definition.transport_mode
    || (isLink ? value.page_size !== PAGINATION_PAGE_SIZE : !validateDirectTransport(value))
    || !Number.isSafeInteger(value.page_count) || value.page_count !== 1
    || !Number.isSafeInteger(value.retrieved_count) || value.retrieved_count !== definition.items
    || value.retrieved_count !== retrievedCount
    || !Array.isArray(value.ordered_page_digests) || value.ordered_page_digests.length !== value.page_count
    || !value.ordered_page_digests.every((page, index) => isRecord(page)
      && exactKeys(page, ['digest', 'page'])
      && page.page === index + 1
      && isDigest(page.digest))
    || value.ordered_page_digests[0]?.digest !== digestValue({
      endpoint_or_query_identity: definition.endpoint,
      page: 1,
      inventory,
    })
    || value.provider_total_count !== providerTotal
    || !isRecord(value.server_total)
    || !exactKeys(value.server_total, ['status', 'value'])
    || value.server_total.status !== definition.server_total
    || !['AVAILABLE', 'UNAVAILABLE'].includes(value.server_total.status)
    || (value.server_total.status === 'AVAILABLE'
      && (providerTotal === null
        || !Number.isSafeInteger(value.server_total.value)
        || value.server_total.value !== providerTotal
        || value.server_total.value !== value.retrieved_count))
    || (value.server_total.status === 'UNAVAILABLE'
      && (value.server_total.value !== null || providerTotal !== null))
    || (isLink ? !validateLinkProgression(value) : !validateDirectTransport(value))
    || value.inventory_digest !== digestValue(inventory)) return false;
  return true;
}
function validatePagination(value, evidence) {
  if (!isRecord(value) || !exactKeys(value, PAGINATION_KEYS)) return false;
  return PAGINATION_KEYS.every((key) => validatePage(value[key], key, evidence));
}
function validateCollector(value) {
  return isRecord(value)
    && exactKeys(value, ['kind', 'identity', 'version', 'authenticated', 'provider_client_used'])
    && value.kind === 'WEB_AUTHENTICATED_GITHUB_COLLECTION'
    && value.identity === 'github-web-readonly-adapter'
    && value.version === 'v1'
    && value.authenticated === true
    && value.provider_client_used === false;
}
function validateWebAuthority(value, decision) {
  const expected = [...decision.web_authority.controlling, ...decision.web_authority.predecessor];
  if (!Array.isArray(value) || value.length !== expected.length) return failure('RECOVERY_AUTHORITY_INCOMPLETE');
  if (value.some((item, index) => !isRecord(item)
    || !exactKeys(item, ['issue', 'comment_id', 'body', 'body_digest'])
    || item.issue !== expected[index].issue
    || item.comment_id !== expected[index].comment_id
    || typeof item.body !== 'string'
    || sha256Text(item.body) !== item.body_digest
    || item.body_digest !== expected[index].body_digest)) return failure('RECOVERY_AUTHORITY_CONTRADICTORY');
  const normalized = value.map(({ issue, comment_id, body_digest }) => ({ issue, comment_id, body_digest }));
  if (!same(normalized, expected)) return failure('RECOVERY_AUTHORITY_MOVED');
  return success('RECOVERY_AUTHORITY_VALID');
}
function expectedChildSnapshotState(state) { return childSnapshotState(state); }
function validateSnapshotState(value, expected) {
  return isRecord(value)
    && exactKeys(value, ['active_blocking_recovery_hold', 'finality', 'gate_state', 'lifecycle', 'normal_active_lanes'])
    && same(value, expected);
}
function classifySnapshot(parentDigest, childDigest, targetDigest) {
  const parentSource = parentDigest === SOURCE_CANONICAL_DIGEST;
  const childSource = childDigest === SOURCE_CANONICAL_DIGEST;
  const parentTarget = parentDigest === targetDigest;
  const childTarget = childDigest === targetDigest;
  if (parentSource && childSource) return 'BEFORE_CHILD';
  if (parentSource && childTarget) return 'CHILD_WRITTEN_PARENT_STALE';
  if (parentTarget && childTarget) return 'PARENT_AND_CHILD_TARGET_OBSERVED';
  return null;
}
function classifyPartialState(input = {}) {
  if (!isRecord(input)
    || !isDigest(input.parent_canonical_digest)
    || !isDigest(input.child_canonical_digest)
    || !isDigest(input.source_canonical_digest)
    || !isDigest(input.target_canonical_digest)) return failure('RECOVERY_PARTIAL_STATE_INVALID');
  const classification = classifySnapshot(input.parent_canonical_digest, input.child_canonical_digest, input.target_canonical_digest);
  return classification ? success('RECOVERY_PARTIAL_STATE_CLASSIFIED', { classification }) : failure('RECOVERY_PARTIAL_STATE_INVALID');
}
function validateContinuation(value, expected, decisionDigest, authorityDigestValue) {
  if (!isRecord(value)
    || !exactKeys(value, ['authority_digest', 'child_operation_digest', 'child_operation_id', 'decision_digest', 'preview_id', 'receipt_operation_digest', 'receipt_operation_id', 'safety_mode'])
    || value.preview_id !== expected.preview_id
    || value.child_operation_id !== expected.child_operation_id
    || value.child_operation_digest !== expected.child_operation_digest
    || value.receipt_operation_digest !== expected.receipt_operation_digest
    || !isSafeId(value.receipt_operation_id)
    || value.decision_digest !== decisionDigest
    || value.authority_digest !== authorityDigestValue
    || value.safety_mode !== WRITE_SAFETY_MODE) return failure('RECOVERY_CONTINUATION_INVALID');
  return success('RECOVERY_CONTINUATION_VALID');
}

function buildReceiptOperationDescriptor(input) {
  const sourceBinding = digestValue({
    mode: WRITE_SAFETY_MODE,
    authority_digest: input.authority_digest,
    source_body_digest: input.source_body_digest,
    source_revision: input.source_revision,
  });
  const targetIdentity = {
    resource_type: 'provider_resource',
    resource_id: 'github:issue:' + String(input.issue) + '/body',
  };
  return {
    operation_kind: 'IDEMPOTENT_SET',
    safety_class: 'IDEMPOTENT',
    target_identity: targetIdentity,
    target_digest: digestValue(targetIdentity),
    expected_source_digest: input.source_body_digest,
    cas_digest: sourceBinding,
    expected_post_state_digest: input.target_body_digest,
    adapter_identity_digest: digestValue({
      adapter: 'github-web-readonly-adapter',
      mode: WRITE_SAFETY_MODE,
      provider_cas_claim: false,
    }),
    retry_of_operation_id: null,
  };
}
function makeOperation(input) {
  const descriptor = buildReceiptOperationDescriptor(input);
  try { receipt.validateOperationDescriptor(descriptor); } catch (_error) { return failure('RECOVERY_RECEIPT_BINDING_INVALID'); }
  const logical = digestValue({
    operation_kind: descriptor.operation_kind,
    safety_class: descriptor.safety_class,
    target_identity: descriptor.target_identity,
    target_digest: descriptor.target_digest,
    expected_post_state_digest: descriptor.expected_post_state_digest,
    adapter_identity_digest: descriptor.adapter_identity_digest,
  });
  const operationId = digestValue({
    schema: RECOVERY_OPERATION_SCHEMA,
    issue: input.issue,
    body_role: input.body_role,
    source_body_digest: input.source_body_digest,
    target_body_digest: input.target_body_digest,
    target_canonical_digest: input.target_canonical_digest,
    target_projection_digest: input.target_projection_digest,
    decision_digest: input.decision_digest,
    authority_digest: input.authority_digest,
    write_safety_mode: WRITE_SAFETY_MODE,
  });
  return success('RECOVERY_OPERATION_READY', {
    operation: {
      schema: RECOVERY_OPERATION_SCHEMA,
      order: input.order,
      issue: input.issue,
      body_role: input.body_role,
      operation_kind: 'IDEMPOTENT_SET',
      safety_class: 'IDEMPOTENT',
      target_identity: descriptor.target_identity,
      target_identity_digest: descriptor.target_digest,
      source_body_digest: input.source_body_digest,
      source_revision: input.source_revision,
      target_body_digest: input.target_body_digest,
      target_canonical_digest: input.target_canonical_digest,
      target_projection_digest: input.target_projection_digest,
      target_bytes: input.target_bytes,
      source_revision_binding_digest: descriptor.cas_digest,
      receipt_operation_kind: 'IDEMPOTENT_SET',
      receipt_safety_class: 'IDEMPOTENT',
      receipt_logical_operation_digest: logical,
      receipt_descriptor_digest: receipt.digestValue(descriptor),
      provider_cas_claim: false,
      write_safety_mode: WRITE_SAFETY_MODE,
      operation_id: operationId,
    },
  });
}

function validateEvidence(value, decisionInput = DECISION_TEMPLATE) {
  const decisionValid = validateDecision(decisionInput);
  if (!decisionValid.ok) return decisionValid;
  const required = [
    'schema', 'recovery_root', 'lock', 'decision_digest', 'snapshot', 'repository',
    'parent_issue', 'child_issue', 'parent', 'child', 'pr_366', 'pr_379',
    'web_authority', 'pagination', 'provider_evidence', 'collector', 'authority_digest', 'continuation',
    'evidence_digest',
  ];
  if (!isRecord(value) || !exactKeys(value, required)
    || value.schema !== EVIDENCE_SCHEMA
    || value.recovery_root !== RECOVERY_ROOT
    || value.lock !== LOCK
    || value.decision_digest !== decisionValid.decision_digest
    || !['BEFORE_CHILD', 'CHILD_WRITTEN_PARENT_STALE', 'PARENT_AND_CHILD_TARGET_OBSERVED'].includes(value.snapshot)
    || value.repository !== REPOSITORY
    || value.parent_issue !== PARENT_ISSUE
    || value.child_issue !== CHILD_ISSUE
    || !isDigest(value.authority_digest)
    || !validateCollector(value.collector)
    || !validateProviderEvidence(value.provider_evidence)
    || !isDigest(value.evidence_digest)) return failure('RECOVERY_EVIDENCE_INVALID');
  if (value.authority_digest !== decisionInput.web_authority.digest) return failure('RECOVERY_AUTHORITY_DIGEST_MISMATCH');
  const webValid = validateWebAuthority(value.web_authority, decisionInput);
  if (!webValid.ok) return webValid;
  if (!isRecord(value.parent)
    || !exactKeys(value.parent, ['issue', 'raw_body', 'body_digest', 'canonical_digest', 'revision', 'state', 'native_children', 'relationships', 'prefix_digest', 'suffix_digest', 'complete'])
    || value.parent.issue !== PARENT_ISSUE
    || typeof value.parent.raw_body !== 'string'
    || sha256Text(value.parent.raw_body) !== value.parent.body_digest
    || !isDigest(value.parent.canonical_digest)
    || !isSafeRevision(value.parent.revision)
    || !Array.isArray(value.parent.native_children)
    || !same(value.parent.native_children, [358, 359, 360, 361, 362, 363])
    || !isRecord(value.parent.relationships)
    || !exactKeys(value.parent.relationships, ['child_issue', 'child_is_native_sub_issue', 'parent_issue', 'sole_current'])
    || !same(value.parent.relationships, { child_issue: CHILD_ISSUE, child_is_native_sub_issue: true, parent_issue: PARENT_ISSUE, sole_current: true })
    || !isDigest(value.parent.prefix_digest)
    || !isDigest(value.parent.suffix_digest)
    || value.parent.complete !== true
    || !isRecord(value.parent.state)) return failure('RECOVERY_PARENT_EVIDENCE_INVALID');
  const parentParsed = parseParentV5Body(value.parent.raw_body, { repository: REPOSITORY, parent_issue: PARENT_ISSUE });
  if (!parentParsed.ok
    || parentParsed.body_digest !== value.parent.body_digest
    || parentParsed.canonical_digest === undefined && parentParsed.envelope.canonical_digest !== value.parent.canonical_digest
    || parentParsed.envelope.canonical_digest !== value.parent.canonical_digest
    || parentParsed.prefix_digest !== value.parent.prefix_digest
    || parentParsed.suffix_digest !== value.parent.suffix_digest
    || !same(parentParsed.state, value.parent.state)) return failure('RECOVERY_PARENT_EVIDENCE_INVALID');
  const sourceParent = value.parent.canonical_digest === SOURCE_CANONICAL_DIGEST;
  if (sourceParent && (value.parent.body_digest !== decisionInput.source.parent_body_sha256
    || value.parent.revision !== decisionInput.source.parent_revision
    || value.parent.prefix_digest !== decisionInput.source.parent_prefix_digest
    || value.parent.suffix_digest !== decisionInput.source.parent_suffix_digest)) return failure('RECOVERY_PARENT_SOURCE_STALE');
  if (!sourceParent && !Object.prototype.hasOwnProperty.call(value.parent.state, 'recovery')) return failure('RECOVERY_PARENT_TARGET_INVALID');
  const stateValid = validateCanonicalStateV5(value.parent.state);
  if (!stateValid.ok) return failure('RECOVERY_PARENT_STATE_INVALID');
  if (!isRecord(value.child)
    || !exactKeys(value.child, ['issue', 'raw_body', 'body_digest', 'canonical_digest', 'revision', 'labels', 'native_parent', 'relationships', 'sole_current', 'dependencies', 'state', 'projection', 'prefix_digest', 'suffix_digest', 'complete'])
    || value.child.issue !== CHILD_ISSUE
    || typeof value.child.raw_body !== 'string'
    || sha256Text(value.child.raw_body) !== value.child.body_digest
    || !isDigest(value.child.canonical_digest)
    || !isSafeRevision(value.child.revision)
    || !Array.isArray(value.child.labels)
    || !same(value.child.labels, ['current'])
    || value.child.native_parent !== PARENT_ISSUE
    || !isRecord(value.child.relationships)
    || !exactKeys(value.child.relationships, ['child_issue', 'child_is_native_sub_issue', 'parent_issue', 'sole_current'])
    || !same(value.child.relationships, { child_issue: CHILD_ISSUE, child_is_native_sub_issue: true, parent_issue: PARENT_ISSUE, sole_current: true })
    || value.child.sole_current !== true
    || !same(value.child.dependencies, [])
    || !validateSnapshotState(value.child.state, expectedChildSnapshotState(
      value.child.canonical_digest === SOURCE_CANONICAL_DIGEST
        ? value.parent.state
        : (buildRecoveryTargetState(value.parent.state) || value.parent.state),
    ))
    || !isRecord(value.child.projection)
    || !isDigest(value.child.prefix_digest)
    || !isDigest(value.child.suffix_digest)
    || value.child.complete !== true) return failure('RECOVERY_CHILD_EVIDENCE_INVALID');
  const childParsed = parseChildV5Body(value.child.raw_body, { repository: REPOSITORY, parent_issue: PARENT_ISSUE });
  if (!childParsed.ok
    || childParsed.body_digest !== value.child.body_digest
    || childParsed.envelope.canonical_digest !== value.child.canonical_digest
    || childParsed.prefix_digest !== value.child.prefix_digest
    || childParsed.suffix_digest !== value.child.suffix_digest
    || !same(childParsed.envelope, value.child.projection)) return failure('RECOVERY_CHILD_EVIDENCE_INVALID');
  if (value.child.canonical_digest !== value.parent.canonical_digest
    && value.parent.canonical_digest !== SOURCE_CANONICAL_DIGEST) return failure('RECOVERY_PROJECTION_CANONICAL_MISMATCH');
  const sourceChild = value.child.canonical_digest === SOURCE_CANONICAL_DIGEST;
  if (sourceChild && (value.child.body_digest !== decisionInput.source.child_body_sha256
    || value.child.revision !== decisionInput.source.child_revision
    || value.child.prefix_digest !== decisionInput.source.child_prefix_digest
    || value.child.suffix_digest !== decisionInput.source.child_suffix_digest)) return failure('RECOVERY_CHILD_SOURCE_STALE');
  const targetState = sourceParent ? buildRecoveryTargetState(value.parent.state) : value.parent.state;
  if (!targetState) return failure('RECOVERY_TARGET_BUILD_FAILED');
  const targetValid = validateCanonicalStateV5(targetState);
  if (!targetValid.ok) return failure('RECOVERY_TARGET_INVALID');
  const targetDigest = targetValid.canonical_digest;
  const classification = classifySnapshot(value.parent.canonical_digest, value.child.canonical_digest, targetDigest);
  if (!classification || value.snapshot !== classification) return failure('RECOVERY_PARTIAL_STATE_INVALID');
  const rendered = renderProgrammeV5(targetState);
  if (value.parent.canonical_digest === targetDigest) {
    if (value.parent.prefix_digest !== decisionInput.source.parent_prefix_digest
      || value.parent.suffix_digest !== decisionInput.source.parent_suffix_digest
      || value.parent.raw_body !== value.parent.raw_body.slice(0, value.parent.raw_body.indexOf(MANAGED_MARKERS.parent.begin))
        + rendered.parent
        + value.parent.raw_body.slice(value.parent.raw_body.indexOf(MANAGED_MARKERS.parent.end) + MANAGED_MARKERS.parent.end.length)) return failure('RECOVERY_PARENT_TARGET_BYTES_INVALID');
  }
  if (value.child.canonical_digest === targetDigest) {
    if (value.child.prefix_digest !== decisionInput.source.child_prefix_digest
      || value.child.suffix_digest !== decisionInput.source.child_suffix_digest
      || value.child.raw_body !== value.child.raw_body.slice(0, value.child.raw_body.indexOf(MANAGED_MARKERS.child.begin))
        + rendered.child
        + value.child.raw_body.slice(value.child.raw_body.indexOf(MANAGED_MARKERS.child.end) + MANAGED_MARKERS.child.end.length)) return failure('RECOVERY_CHILD_TARGET_BYTES_INVALID');
    if (value.child.projection.projection_digest !== rendered.projections.child.projection_digest) return failure('RECOVERY_CHILD_PROJECTION_INVALID');
  }
  if (value.parent.canonical_digest === targetDigest && value.parent.projection_digest !== undefined) return failure('RECOVERY_PARENT_PROJECTION_INVALID');
  if (!validatePR366(value.pr_366)) return failure('RECOVERY_PR366_INVALID');
  const pr379Valid = validatePR379(value.pr_379);
  if (!pr379Valid.ok) return pr379Valid;
  if (!validatePagination(value.pagination, value)) return failure('RECOVERY_PAGINATION_INVALID');
  if (value.continuation !== null) {
    if (classification === 'BEFORE_CHILD') return failure('RECOVERY_CONTINUATION_UNEXPECTED');
    const parentTargetBody = materialize(parentParsed, rendered.parent);
    const childTargetBody = materialize(childParsed, rendered.child);
    const childOperationResult = makeOperation({
      order: 1,
      issue: CHILD_ISSUE,
      body_role: 'CHILD_MANAGED_BODY',
      source_body_digest: decisionInput.source.child_body_sha256,
      source_revision: decisionInput.source.child_revision,
      target_body_digest: sha256Text(childTargetBody),
      target_canonical_digest: targetDigest,
      target_projection_digest: rendered.projections.child.projection_digest,
      target_bytes: childTargetBody,
      decision_digest: decisionValid.decision_digest,
      authority_digest: decisionInput.web_authority.digest,
    });
    if (!childOperationResult.ok) return childOperationResult;
    const parentOperationResult = makeOperation({
      order: 2,
      issue: PARENT_ISSUE,
      body_role: 'PARENT_MANAGED_BODY',
      source_body_digest: decisionInput.source.parent_body_sha256,
      source_revision: decisionInput.source.parent_revision,
      target_body_digest: sha256Text(parentTargetBody),
      target_canonical_digest: targetDigest,
      target_projection_digest: rendered.projections.parent.projection_digest,
      target_bytes: parentTargetBody,
      decision_digest: decisionValid.decision_digest,
      authority_digest: decisionInput.web_authority.digest,
    });
    if (!parentOperationResult.ok) return parentOperationResult;
    const basePreviewId = previewIdentity({
      decision_digest: decisionValid.decision_digest,
      authority_digest: decisionInput.web_authority.digest,
      target_canonical_digest: targetDigest,
      target_body_digests: { parent: sha256Text(parentTargetBody), child: sha256Text(childTargetBody) },
      target_projection_digests: { parent: rendered.projections.parent.projection_digest, child: rendered.projections.child.projection_digest },
      ordered_operation_digest: digestValue([childOperationResult.operation, parentOperationResult.operation]),
    });
    const expectedContinuation = {
      preview_id: basePreviewId,
      child_operation_digest: childOperationResult.operation.receipt_logical_operation_digest,
      child_operation_id: childOperationResult.operation.operation_id,
      receipt_operation_digest: childOperationResult.operation.receipt_logical_operation_digest,
    };
    const continuationValid = validateContinuation(value.continuation, expectedContinuation, decisionValid.decision_digest, decisionInput.web_authority.digest);
    if (!continuationValid.ok) return continuationValid;
  } else if (classification !== 'BEFORE_CHILD') {
    return failure('RECOVERY_CONTINUATION_REQUIRED');
  }
  const expectedEvidenceDigest = digestValue(without(value, 'evidence_digest'));
  if (value.evidence_digest !== expectedEvidenceDigest) return failure('RECOVERY_EVIDENCE_DIGEST_INVALID');
  return success('RECOVERY_EVIDENCE_VALID', {
    evidence: clone(value),
    parsed: { parent: parentParsed, child: childParsed, target_state: targetState, target_digest: targetDigest, classification },
    evidence_digest: value.evidence_digest,
  });
}

function previewIdentity(input) {
  return digestValue({
    schema: RECOVERY_OPERATION_SCHEMA,
    decision_digest: input.decision_digest,
    authority_digest: input.authority_digest,
    source_canonical_digest: SOURCE_CANONICAL_DIGEST,
    source_body_digests: {
      parent: SOURCE_PARENT_BODY_DIGEST,
      child: SOURCE_CHILD_BODY_DIGEST,
    },
    target_canonical_digest: input.target_canonical_digest,
    target_body_digests: input.target_body_digests,
    target_projection_digests: input.target_projection_digests,
    ordered_operation_digest: input.ordered_operation_digest,
    write_safety_mode: WRITE_SAFETY_MODE,
  });
}
function previewRecovery(input = {}) {
  if (!isRecord(input) || !exactKeys(input, ['decision', 'evidence'])) return failure('RECOVERY_PREVIEW_INPUT_INVALID');
  const decisionValid = validateDecision(input.decision);
  if (!decisionValid.ok) return decisionValid;
  const evidenceValid = validateEvidence(input.evidence, input.decision);
  if (!evidenceValid.ok) return evidenceValid;
  const parsed = evidenceValid.parsed;
  const targetState = parsed.target_state;
  const rendered = renderProgrammeV5(targetState);
  if (!rendered.ok) return failure('RECOVERY_TARGET_RENDER_INVALID');
  const parentTargetBytes = parsed.parent.canonical_digest === parsed.target_digest
    ? parsed.parent.raw_body
    : materialize(parsed.parent, rendered.parent);
  const childTargetBytes = parsed.child.canonical_digest === parsed.target_digest
    ? parsed.child.raw_body
    : materialize(parsed.child, rendered.child);
  const targetBodyDigests = { parent: sha256Text(parentTargetBytes), child: sha256Text(childTargetBytes) };
  const targetProjectionDigests = {
    parent: rendered.projections.parent.projection_digest,
    child: rendered.projections.child.projection_digest,
  };
  const operations = [];
  const fullPlan = [];
  const childPlan = makeOperation({
    order: 1,
    issue: CHILD_ISSUE,
    body_role: 'CHILD_MANAGED_BODY',
    source_body_digest: decisionValid.decision.source.child_body_sha256,
    source_revision: decisionValid.decision.source.child_revision,
    target_body_digest: targetBodyDigests.child,
    target_canonical_digest: parsed.target_digest,
    target_projection_digest: targetProjectionDigests.child,
    target_bytes: childTargetBytes,
    decision_digest: decisionValid.decision_digest,
    authority_digest: decisionValid.decision.web_authority.digest,
  });
  const parentPlan = makeOperation({
    order: 2,
    issue: PARENT_ISSUE,
    body_role: 'PARENT_MANAGED_BODY',
    source_body_digest: decisionValid.decision.source.parent_body_sha256,
    source_revision: decisionValid.decision.source.parent_revision,
    target_body_digest: targetBodyDigests.parent,
    target_canonical_digest: parsed.target_digest,
    target_projection_digest: targetProjectionDigests.parent,
    target_bytes: parentTargetBytes,
    decision_digest: decisionValid.decision_digest,
    authority_digest: decisionValid.decision.web_authority.digest,
  });
  if (!childPlan.ok || !parentPlan.ok) return failure('RECOVERY_OPERATION_BINDING_INVALID');
  fullPlan.push(childPlan.operation, parentPlan.operation);
  if (parsed.classification === 'BEFORE_CHILD') {
    operations.push(...fullPlan);
  } else if (parsed.classification === 'CHILD_WRITTEN_PARENT_STALE') {
    operations.push(parentPlan.operation);
  }
  const orderedOperationDigest = digestValue(operations);
  const previewId = previewIdentity({
    decision_digest: decisionValid.decision_digest,
    authority_digest: decisionValid.decision.web_authority.digest,
    target_canonical_digest: parsed.target_digest,
    target_body_digests: targetBodyDigests,
    target_projection_digests: targetProjectionDigests,
    ordered_operation_digest: digestValue(fullPlan),
  });
  if (parsed.classification === 'CHILD_WRITTEN_PARENT_STALE') {
    if (input.evidence.continuation.preview_id !== previewId) return failure('RECOVERY_CONTINUATION_PREVIEW_MISMATCH');
  }
  const zeroDelta = parsed.classification === 'PARENT_AND_CHILD_TARGET_OBSERVED';
  const response = {
    ok: true,
    code: zeroDelta ? 'PROGRAMME_ZERO_DELTA' : 'PROJECTION_BOOTSTRAP_RECOVERY_PREVIEW_READY',
    schema: RECOVERY_OPERATION_SCHEMA,
    recovery_root: RECOVERY_ROOT,
    lock: LOCK,
    status: zeroDelta ? 'RECOVERY_ALREADY_TARGET' : 'PREVIEW_READY',
    partial_state: parsed.classification,
    recovery_retired: zeroDelta,
    preview_id: previewId,
    source: {
      canonical_digest: SOURCE_CANONICAL_DIGEST,
      body_digests: { parent: decisionValid.decision.source.parent_body_sha256, child: decisionValid.decision.source.child_body_sha256 },
      projection_digests: { parent: parsed.parent.envelope.projection_digest, child: parsed.child.envelope.projection_digest },
    },
    target: {
      canonical_digest: parsed.target_digest,
      body_digests: targetBodyDigests,
      projection_digests: targetProjectionDigests,
      bodies: { parent: parentTargetBytes, child: childTargetBytes },
    },
    decision_digest: decisionValid.decision_digest,
    evidence_digest: evidenceValid.evidence_digest,
    authority_digest: decisionValid.decision.web_authority.digest,
    operations,
    ordered_operation_digest: orderedOperationDigest,
    operation_count: operations.length,
    operation_order: operations.map((operation) => operation.issue),
    outside_bytes_preserved: true,
    write_safety: {
      mode: WRITE_SAFETY_MODE,
      provider_cas_available: false,
      provider_cas_claim: false,
      fresh_prewrite_evidence_revision_rebinding: true,
      web_exclusive_single_writer: true,
      postwrite_exact_readback: true,
      residual_external_race_disclosed: true,
    },
    receipt: {
      schema: receipt.SCHEMA_ID,
      operation_kind: 'IDEMPOTENT_SET',
      safety_class: 'IDEMPOTENT',
      operation_binding_truthful: true,
      provider_cas_claim: false,
      source_changed: false,
    },
    self_retirement_fence: {
      source_canonical_digest: SOURCE_CANONICAL_DIGEST,
      target_canonical_digest: parsed.target_digest,
      exact_target_only: true,
      zero_delta_retires_recovery: true,
    },
    readback_required: true,
    duplicate_write: false,
  };
  return response;
}

function isProviderRevision(value) {
  return isSafeRevision(value) && value !== 'OPEN' && value !== 'CLOSED' && value !== 'MERGED';
}
function acceptedCandidate380() {
  return {
    repository: REPOSITORY,
    branch: PR380_BRANCH,
    base_ref: 'main',
    base_sha: PR380_BASE_SHA,
    head: PR380_HEAD,
    tree: PR380_TREE,
    version: PR380_VERSION,
  };
}
function finalisationEvidenceRefs() {
  return [
    {
      id: FINAL_G4_EVIDENCE_REF,
      kind: 'WEB',
      reference: FINAL_G4_EVIDENCE_REFERENCE,
      summary: 'Accepted final G4 Web review for the merged E3 candidate.',
    },
    {
      id: POST_MERGE_TECHNICAL_EVIDENCE_REF,
      kind: 'WEB',
      reference: POST_MERGE_TECHNICAL_EVIDENCE_REFERENCE,
      summary: 'Accepted post-merge technical E3 finality review.',
    },
    {
      id: PR379_NON_CONVERGENCE_EVIDENCE_REF,
      kind: 'WEB',
      reference: PR379_NON_CONVERGENCE_EVIDENCE_REFERENCE,
      summary: 'Retained #379 non-convergence history evidence.',
    },
  ];
}
function retired379RegistryEntry(githubState = 'OPEN') {
  return {
    accepted_evidence_ref: null,
    candidate: retainedCandidate(),
    completes_child: false,
    draft: true,
    epoch_id: 'E3',
    github_state: githubState,
    merged: false,
    pr: 379,
    retention_evidence_ref: RETENTION_EVIDENCE_REF,
    retirement_evidence_ref: POST_MERGE_TECHNICAL_EVIDENCE_REF,
    role: 'INTERMEDIATE',
    status: 'RETIRED',
  };
}
function accepted380RegistryEntry() {
  return {
    accepted_evidence_ref: FINAL_G4_EVIDENCE_REF,
    candidate: acceptedCandidate380(),
    completes_child: false,
    draft: false,
    epoch_id: 'E3',
    github_state: 'MERGED',
    merged: true,
    pr: 380,
    retention_evidence_ref: null,
    retirement_evidence_ref: null,
    role: 'INTERMEDIATE',
    status: 'ACCEPTED',
  };
}
function finalisationPr380Descriptor() {
  return {
    changed_surfaces: [
      'GitHub programme reconciler runtime and v5 source-anchored finalisation contract.',
      'Focused source-bound target and provider-observation tests.',
    ],
    child_issue: CHILD_ISSUE,
    design_constraints: [
      'Role remains INTERMEDIATE and completes_child remains false.',
      'The merged candidate is immutable throughout post-merge finalisation.',
      'No E4 activation or Programme Apply is part of this source-only contract.',
    ],
    eli5: 'The accepted merge is recorded as E3 history while the child stays unmerged and E4 waits.',
    evidence_refs: [FINAL_G4_EVIDENCE_REF, POST_MERGE_TECHNICAL_EVIDENCE_REF],
    number: 380,
    out_of_scope: [
      'E4 activation, Ready, merge or finality mutation.',
      'Programme Apply and provider client or CAS operations.',
    ],
    purpose: 'Record the accepted merged E3 candidate without completing the current child.',
    scope: [
      'Immutable PR #380 acceptance and merge ancestry.',
      'Source-anchored Stage A and Stage B managed projections.',
    ],
    summary: 'PR #380 is accepted and merged as the intermediate E3 candidate; it does not complete #359.',
    validation_requirements: [
      'Exact merge commit and ordered parent ancestry are preserved.',
      'PR #379 remains chronology only until the separately selected close operation.',
    ],
  };
}
function finalisationTransitionCount(state) {
  return state.historical_transitions.filter((item) => item.id === FINALISATION_TRANSITION_ID).length;
}
function finalisationEvidenceCount(state, id) {
  return state.evidence_refs.filter((item) => item.id === id).length;
}
function finalisationDiffPaths(left, right, path = '') {
  if (same(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return [path || '$'];
    return left.flatMap((item, index) => finalisationDiffPaths(item, right[index], path + '[' + String(index) + ']'));
  }
  if (!isRecord(left) || !isRecord(right)) return [path || '$'];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => finalisationDiffPaths(left[key], right[key], path ? path + '.' + key : key));
}
function validateInterEpochShapeV5(value) {
  const required = ['active_lanes', 'children', 'concurrency_authority', 'design_lock', 'evidence_refs', 'extensions', 'historical_transitions', 'parent', 'predecessor_contract_digest', 'prs', 'repository', 'schema'];
  if (!hasOnly(value, required)
    || value.schema !== STATE_SCHEMA
    || value.repository !== REPOSITORY
    || value.design_lock !== FINALISATION_LOCK
    || !validateParent(value.parent)
    || !isDigest(value.predecessor_contract_digest)
    || !Array.isArray(value.children)
    || value.children.length !== 6
    || !value.children.every(validateChild)
    || !Array.isArray(value.prs)
    || !value.prs.every(validatePrDescriptor)
    || !isRecord(value.concurrency_authority)
    || !exactKeys(value.concurrency_authority, ['authority_digest', 'authority_ref', 'max_active_lanes', 'mode', 'permitted_child_issues'])
    || value.concurrency_authority.authority_digest !== null
    || value.concurrency_authority.authority_ref !== null
    || value.concurrency_authority.max_active_lanes !== 1
    || value.concurrency_authority.mode !== 'SINGLE_DEFAULT'
    || !same(value.concurrency_authority.permitted_child_issues, [])
    || !Array.isArray(value.active_lanes)
    || value.active_lanes.length !== 0
    || !Array.isArray(value.evidence_refs)
    || !value.evidence_refs.every(validateEvidenceRef)
    || !Array.isArray(value.historical_transitions)
    || !value.historical_transitions.every(validateTransition)
    || !Array.isArray(value.extensions)
    || value.extensions.some((item) => !isRecord(item))) return failure('V5_INTER_EPOCH_STATE_INVALID');
  const expectedIssues = [358, 359, 360, 361, 362, 363];
  const issues = value.children.map((child) => child.issue);
  if (!same(issues, expectedIssues) || value.children.some((child, index) => child.order !== index + 1)) {
    return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'child_topology' });
  }
  const child = childByIssue(value, CHILD_ISSUE);
  if (!child
    || child.lifecycle !== 'CURRENT'
    || child.finality.state !== 'UNMERGED'
    || child.finality.authority_ref !== null
    || child.holds.length !== 0
    || child.epochs.length !== 4
    || !same(child.epochs.map((epoch) => epoch.id), ['E1', 'E2', 'E3', 'E4'])
    || child.epochs.find((epoch) => epoch.id === 'E1')?.terminal_disposition !== 'ACCEPTED'
    || child.epochs.find((epoch) => epoch.id === 'E2')?.terminal_disposition !== 'ACCEPTED'
    || child.epochs.find((epoch) => epoch.id === 'E3')?.evidence_ref !== FINAL_G4_EVIDENCE_REF
    || child.epochs.find((epoch) => epoch.id === 'E3')?.terminal_disposition !== 'ACCEPTED'
    || child.epochs.find((epoch) => epoch.id === 'E4')?.evidence_ref !== null
    || child.epochs.find((epoch) => epoch.id === 'E4')?.terminal_disposition !== null) {
    return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'epoch_boundary' });
  }
  const byPr = new Map(child.pr_registry.map((entry) => [entry.pr, entry]));
  const pr379 = byPr.get(379);
  if (child.pr_registry.length !== 3
    || !byPr.has(366) || !byPr.has(379) || !byPr.has(380)
    || !validateRegistryEntry(byPr.get(366), true)
    || !validateRegistryEntry(pr379, true)
    || !validateRegistryEntry(byPr.get(380), true)
    || !same(byPr.get(366), retired366RegistryEntry())
    || !same(byPr.get(380), accepted380RegistryEntry())
    || !same(pr379, retired379RegistryEntry(pr379?.github_state))) {
    return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'pr_registry' });
  }
  if ([FINAL_G4_EVIDENCE_REF, POST_MERGE_TECHNICAL_EVIDENCE_REF, PR379_NON_CONVERGENCE_EVIDENCE_REF]
    .some((id) => finalisationEvidenceCount(value, id) !== 1)
    || finalisationTransitionCount(value) !== 1) {
    return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'accepted_evidence_or_history' });
  }
  const acceptedTransition = value.historical_transitions.find((item) => item.id === FINALISATION_TRANSITION_ID);
  if (!acceptedTransition
    || acceptedTransition.child_issue !== CHILD_ISSUE
    || acceptedTransition.disposition !== 'ACCEPTED'
    || acceptedTransition.epoch_id !== 'E3'
    || acceptedTransition.evidence_ref !== FINAL_G4_EVIDENCE_REF
    || acceptedTransition.gate !== 'G4') return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'accepted_transition' });
  if (!value.prs.some((item) => item.number === 380)
    || !value.prs.some((item) => item.number === 366)) return failure('V5_INTER_EPOCH_STATE_INVALID', { reason: 'parent_pr_registry' });
  return success('V5_INTER_EPOCH_SHAPE_VALID', { state: clone(value), canonical_digest: digestValue(value) });
}
function looksLikeInterEpochState(value) {
  return isRecord(value)
    && value.schema === STATE_SCHEMA
    && value.design_lock === FINALISATION_LOCK
    && !Object.prototype.hasOwnProperty.call(value, 'recovery');
}
function validateInterEpochStateV5(value) {
  const shape = validateInterEpochShapeV5(value);
  if (!shape.ok) return shape;
  if (![FINALISATION_STAGE_A_CANONICAL_DIGEST, FINALISATION_STAGE_B_CANONICAL_DIGEST].includes(shape.canonical_digest)) {
    return failure('V5_INTER_EPOCH_TARGET_NOT_EXACT');
  }
  return success('V5_INTER_EPOCH_STATE_VALID', { state: shape.state, canonical_digest: shape.canonical_digest });
}
function validateFinalisationSourceState(value = FINALISATION_SOURCE_STATE) {
  if (!same(value, FINALISATION_SOURCE_STATE)) return failure('FINALISATION_SOURCE_STATE_INVALID', { reason: 'source_not_fixed' });
  const valid = validateCanonicalStateV5(value);
  if (!valid.ok || !Object.prototype.hasOwnProperty.call(value, 'recovery')
    || valid.canonical_digest !== FINALISATION_SOURCE_CANONICAL_DIGEST) {
    return failure('FINALISATION_SOURCE_STATE_INVALID');
  }
  const child = childByIssue(value, CHILD_ISSUE);
  const registry = child?.pr_registry || [];
  const byPr = new Map(registry.map((entry) => [entry.pr, entry]));
  if (registry.length !== 2
    || !same([...byPr.keys()].sort((a, b) => a - b), [366, 379])
    || !same(byPr.get(366), retired366RegistryEntry())
    || !same(byPr.get(379), retainedRegistryEntry())) {
    return failure('FINALISATION_SOURCE_STATE_INVALID', { reason: 'source_registry' });
  }
  return success('FINALISATION_SOURCE_STATE_VALID', { state: FINALISATION_SOURCE_STATE, canonical_digest: valid.canonical_digest });
}
function deriveStageAFromFixedSource() {
  const sourceValid = validateFinalisationSourceState();
  if (!sourceValid.ok) return null;
  const next = clone(FINALISATION_SOURCE_STATE);
  next.design_lock = FINALISATION_LOCK;
  next.active_lanes = [];
  next.concurrency_authority.permitted_child_issues = [];
  delete next.recovery;
  const child = childByIssue(next, CHILD_ISSUE);
  child.summary = 'E1, E2 and E3 are accepted; E4 remains pending while the current child stays unmerged and waits for separate Web E4 authority.';
  child.done_when = [
    'E1, E2 and E3 remain accepted with retained evidence.',
    'E3 merge/finality and #380/#379 chronology are recorded exactly; the current child remains unmerged.',
    'E4 truthful native adapters are complete and Web records S2 finality.',
  ];
  child.scope = [
    'Retained-skill productisation, the v5 GitHub programme reconciler and truthful post-merge epoch finalisation.',
    'A clean inter-epoch boundary with E3 accepted and E4 pending.',
  ];
  child.out_of_scope = [
    'E4 execution, E4 activation and S3 through S6 progression.',
    'Programme Apply or provider state changes not separately authorised by future Web finalisation authority.',
  ];
  child.boundaries = [
    'Web owns E4 authority, Ready, merge, finality and consequential provider operations.',
    'This clean inter-epoch state has no recovery hold, normal lane, active gate or provider CAS claim.',
    'E4 remains pending and no automatic transition is performed.',
  ];
  child.eli5 = 'E3 is accepted and the next epoch is waiting; the current child is still not finished and no work lane is running.';
  child.finality = { authority_ref: null, state: 'UNMERGED' };
  child.holds = [];
  child.epochs = child.epochs.map((epoch) => epoch.id === 'E3'
    ? { ...epoch, evidence_ref: FINAL_G4_EVIDENCE_REF, terminal_disposition: 'ACCEPTED' }
    : epoch.id === 'E4'
      ? { ...epoch, evidence_ref: null, terminal_disposition: null }
      : epoch);
  child.pr_registry = [retired366RegistryEntry(), retired379RegistryEntry('OPEN'), accepted380RegistryEntry()];
  const oldPr = next.prs.find((item) => item.number === 366);
  if (oldPr) oldPr.summary = 'Historical PR #366 is closed and retired; no merged candidate is active.';
  if (!next.prs.some((item) => item.number === 380)) next.prs.push(finalisationPr380Descriptor());
  next.evidence_refs = [
    ...next.evidence_refs,
    ...finalisationEvidenceRefs().filter((item) => !next.evidence_refs.some((existing) => existing.id === item.id)),
  ];
  if (finalisationTransitionCount(next) === 0) {
    next.historical_transitions = [
      ...next.historical_transitions,
      {
        child_issue: CHILD_ISSUE,
        disposition: 'ACCEPTED',
        epoch_id: 'E3',
        evidence_ref: FINAL_G4_EVIDENCE_REF,
        gate: 'G4',
        id: FINALISATION_TRANSITION_ID,
      },
    ];
  }
  const shape = validateInterEpochShapeV5(next);
  return shape.ok ? next : null;
}
function deriveStageBFromStageA(stageA) {
  if (!stageA || !validateInterEpochShapeV5(stageA).ok
    || childByIssue(stageA, CHILD_ISSUE)?.pr_registry.find((entry) => entry.pr === 379)?.github_state !== 'OPEN') return null;
  const next = clone(stageA);
  const child = childByIssue(next, CHILD_ISSUE);
  child.pr_registry = child.pr_registry.map((entry) => entry.pr === 379 ? retired379RegistryEntry('CLOSED') : entry);
  const changed = finalisationDiffPaths(stageA, next);
  return same(changed, ['children[1].pr_registry[1].github_state']) ? next : null;
}
const FINALISATION_STAGE_A_TARGET_STATE = deepFreeze(deriveStageAFromFixedSource());
const FINALISATION_STAGE_B_TARGET_STATE = deepFreeze(deriveStageBFromStageA(FINALISATION_STAGE_A_TARGET_STATE));
if (!FINALISATION_STAGE_A_TARGET_STATE || !FINALISATION_STAGE_B_TARGET_STATE
  || digestValue(FINALISATION_STAGE_A_TARGET_STATE) !== FINALISATION_STAGE_A_CANONICAL_DIGEST
  || digestValue(FINALISATION_STAGE_B_TARGET_STATE) !== FINALISATION_STAGE_B_CANONICAL_DIGEST) {
  throw new Error('FINALISATION_TARGET_DERIVATION_MISMATCH');
}
const FINALISATION_SOURCE_RENDERED = deepFreeze(renderProgrammeV5(FINALISATION_SOURCE_STATE));
const FINALISATION_STAGE_A_RENDERED = deepFreeze(renderProgrammeV5(FINALISATION_STAGE_A_TARGET_STATE));
const FINALISATION_STAGE_B_RENDERED = deepFreeze(renderProgrammeV5(FINALISATION_STAGE_B_TARGET_STATE));
if (!FINALISATION_SOURCE_RENDERED.ok || !FINALISATION_STAGE_A_RENDERED.ok || !FINALISATION_STAGE_B_RENDERED.ok) {
  throw new Error('FINALISATION_TARGET_RENDER_INVALID');
}
if (FINALISATION_SOURCE_RENDERED.canonical_digest !== FINALISATION_SOURCE_CANONICAL_DIGEST
  || FINALISATION_STAGE_A_RENDERED.canonical_digest !== FINALISATION_STAGE_A_CANONICAL_DIGEST
  || FINALISATION_STAGE_B_RENDERED.canonical_digest !== FINALISATION_STAGE_B_CANONICAL_DIGEST) {
  throw new Error('FINALISATION_TARGET_RENDER_DIGEST_MISMATCH');
}
function finalisationRenderedTarget(rendered) {
  return {
    canonical_digest: rendered.canonical_digest,
    parent: rendered.parent,
    child: rendered.child,
    parent_body_digest: sha256Text(rendered.parent),
    child_body_digest: sha256Text(rendered.child),
    projections: {
      parent: rendered.projections.parent,
      child: rendered.projections.child,
    },
  };
}
const FINALISATION_SOURCE_PARENT_BODY_DIGEST = sha256Text(FINALISATION_SOURCE_RENDERED.parent);
const FINALISATION_SOURCE_CHILD_BODY_DIGEST = sha256Text(FINALISATION_SOURCE_RENDERED.child);
const FINALISATION_RENDERED_TARGETS = deepFreeze({
  source: finalisationRenderedTarget(FINALISATION_SOURCE_RENDERED),
  stage_a: finalisationRenderedTarget(FINALISATION_STAGE_A_RENDERED),
  stage_b: finalisationRenderedTarget(FINALISATION_STAGE_B_RENDERED),
});
function finalisationCheckpointTargetRecord(checkpoint, states, rendered) {
  const spec = finalisationCheckpointSpec(checkpoint);
  const parentState = states[spec.parent];
  const childState = states[spec.child];
  const parentRendered = rendered[spec.parent];
  const childRendered = rendered[spec.child];
  return {
    checkpoint,
    parent_stage: spec.parent,
    child_stage: spec.child,
    parent_canonical_digest: digestValue(parentState),
    child_canonical_digest: digestValue(childState),
    parent_body_digest: parentRendered.parent_body_digest,
    child_body_digest: childRendered.child_body_digest,
    parent_projection_digest: parentRendered.projections.parent.projection_digest,
    child_projection_digest: childRendered.projections.child.projection_digest,
    pr_379_github_state: spec.pr_379,
    next_operation_order: spec.next_order,
  };
}
const FINALISATION_CHECKPOINT_TABLE = deepFreeze(Object.fromEntries(
  FINALISATION_CHECKPOINTS.map((checkpoint) => [checkpoint, finalisationCheckpointTargetRecord(
    checkpoint,
    { source: FINALISATION_SOURCE_STATE, stage_a: FINALISATION_STAGE_A_TARGET_STATE, stage_b: FINALISATION_STAGE_B_TARGET_STATE },
    FINALISATION_RENDERED_TARGETS,
  )]),
));
const FINALISATION_TARGET_TABLE = deepFreeze({
  source: FINALISATION_SOURCE_STATE,
  stage_a: FINALISATION_STAGE_A_TARGET_STATE,
  stage_b: FINALISATION_STAGE_B_TARGET_STATE,
  rendered: FINALISATION_RENDERED_TARGETS,
  checkpoints: FINALISATION_CHECKPOINT_TABLE,
});
function finalisationSourceBodyBinding() {
  return {
    kind: 'RECOVERY_HELD_CANONICAL',
    canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
    parent_body_sha256: FINALISATION_SOURCE_PARENT_BODY_DIGEST,
    child_body_sha256: FINALISATION_SOURCE_CHILD_BODY_DIGEST,
    parent_revision: SOURCE_PARENT_REVISION,
    child_revision: SOURCE_CHILD_REVISION,
    pr_379_revision: FINALISATION_PR379_SOURCE_REVISION,
    parent_prefix_digest: EMPTY_DIGEST,
    parent_suffix_digest: EMPTY_DIGEST,
    child_prefix_digest: EMPTY_DIGEST,
    child_suffix_digest: EMPTY_DIGEST,
  };
}
function finalisationPr379DecisionFacts() {
  return {
    pr: 379,
    provider_state: 'OPEN',
    github_state: 'OPEN',
    draft: true,
    merged: false,
    head: FROZEN_HEAD,
    tree: FROZEN_TREE,
    branch: FROZEN_BRANCH,
    base_ref: FROZEN_BASE_REF,
    base_sha: MAIN_SHA,
    version: FROZEN_VERSION,
  };
}
function finalisationPr380DecisionFacts() {
  return {
    pr: 380,
    provider_state: 'MERGED',
    github_state: 'MERGED',
    status: 'ACCEPTED',
    draft: false,
    merged: true,
    merge_method: 'MERGE_COMMIT',
    merge_commit: PR380_MERGE_COMMIT,
    ordered_parents: [PR380_BASE_SHA, PR380_HEAD],
    head: PR380_HEAD,
    tree: PR380_TREE,
    branch: PR380_BRANCH,
    base_ref: 'main',
    base_sha: PR380_BASE_SHA,
    version: PR380_VERSION,
    accepted_evidence_ref: FINAL_G4_EVIDENCE_REF,
  };
}
const FINALISATION_PROHIBITIONS = Object.freeze({
  arbitrary_target: false,
  desired_state_api: false,
  arbitrary_patch: false,
  arbitrary_transition: false,
  provider_current_state_constructor: false,
  provider_client: false,
  provider_cas: false,
  programme_apply: false,
  e4_activation: false,
  pr_body_mutation: false,
});
const FINALISATION_WRITE_SAFETY = Object.freeze({
  mode: FINALISATION_WRITE_SAFETY_MODE,
  provider_client_used: false,
  provider_cas_claim: false,
  fresh_complete_rebind: true,
  exact_readback_required: true,
  one_next_operation_only: true,
});
const FINALISATION_DECISION_KEYS = Object.freeze([
  'schema', 'root', 'lock', 'scope', 'repository', 'parent_issue', 'child_issue',
  'source', 'accepted_authority', 'pr_379', 'pr_380', 'allowed_checkpoints',
  'allowed_operations', 'prohibitions', 'write_safety',
]);
function makeFinalisationDecisionTemplate() {
  return {
    schema: FINALISATION_DECISION_SCHEMA,
    root: FINALISATION_ROOT,
    lock: FINALISATION_LOCK,
    scope: FINALISATION_SCOPE,
    repository: REPOSITORY,
    parent_issue: PARENT_ISSUE,
    child_issue: CHILD_ISSUE,
    source: finalisationSourceBodyBinding(),
    accepted_authority: clone(FINALISATION_AUTHORITY),
    pr_379: finalisationPr379DecisionFacts(),
    pr_380: finalisationPr380DecisionFacts(),
    allowed_checkpoints: [...FINALISATION_CHECKPOINTS],
    allowed_operations: clone(FINALISATION_OPERATION_ORDER),
    prohibitions: clone(FINALISATION_PROHIBITIONS),
    write_safety: clone(FINALISATION_WRITE_SAFETY),
  };
}
const FINALISATION_DECISION_TEMPLATE = deepFreeze(makeFinalisationDecisionTemplate());
function validatePostMergeEpochFinalisationDecision(value) {
  if (!isRecord(value) || !exactKeys(value, FINALISATION_DECISION_KEYS)
    || !same(value, FINALISATION_DECISION_TEMPLATE)
    || Object.prototype.hasOwnProperty.call(value, 'target')
    || Object.prototype.hasOwnProperty.call(value, 'desired')
    || Object.prototype.hasOwnProperty.call(value, 'patch')
    || Object.prototype.hasOwnProperty.call(value, 'transition')
    || Object.prototype.hasOwnProperty.call(value, 'state')) {
    return failure('FINALISATION_DECISION_INVALID');
  }
  return success('FINALISATION_DECISION_VALID', { decision: clone(value), decision_digest: digestValue(value) });
}
function createPostMergeEpochFinalisationDecision() {
  return clone(FINALISATION_DECISION_TEMPLATE);
}
function derivePostMergeEpochFinalisationTargets(decisionInput = FINALISATION_DECISION_TEMPLATE, evidenceInput) {
  if (arguments.length > 1 && evidenceInput !== undefined) return failure('FINALISATION_PROVIDER_TARGET_INPUT_FORBIDDEN');
  const decisionValid = validatePostMergeEpochFinalisationDecision(decisionInput);
  if (!decisionValid.ok) return decisionValid;
  const sourceValid = validateFinalisationSourceState();
  if (!sourceValid.ok
    || digestValue(FINALISATION_STAGE_A_TARGET_STATE) !== FINALISATION_STAGE_A_CANONICAL_DIGEST
    || digestValue(FINALISATION_STAGE_B_TARGET_STATE) !== FINALISATION_STAGE_B_CANONICAL_DIGEST) {
    return failure('FINALISATION_TARGET_DERIVATION_INVALID');
  }
  return success('FINALISATION_TARGETS_DERIVED', {
    targets: FINALISATION_TARGET_TABLE,
    decision_digest: decisionValid.decision_digest,
  });
}
function buildPostMergeEpochFinalisationStageATargetState(input) {
  if (arguments.length > 0 && input !== undefined && !same(input, FINALISATION_SOURCE_STATE)) return null;
  return FINALISATION_STAGE_A_TARGET_STATE;
}
function buildPostMergeEpochFinalisationStageBTargetState(input) {
  if (arguments.length > 0 && input !== undefined && !same(input, FINALISATION_STAGE_A_TARGET_STATE)) return null;
  return FINALISATION_STAGE_B_TARGET_STATE;
}
function finalisationCheckpointSpec(checkpoint) {
  const table = {
    BEFORE_STAGE_A: { parent: 'source', child: 'source', pr_379: 'OPEN', completed: [], previous: null, next_order: 1 },
    CHILD_STAGE_A_OBSERVED: { parent: 'source', child: 'stage_a', pr_379: 'OPEN', completed: [1], previous: 'BEFORE_STAGE_A', next_order: 2 },
    PARENT_STAGE_A_OBSERVED: { parent: 'stage_a', child: 'stage_a', pr_379: 'OPEN', completed: [1, 2], previous: 'CHILD_STAGE_A_OBSERVED', next_order: 3 },
    PR379_CLOSED_STAGE_A: { parent: 'stage_a', child: 'stage_a', pr_379: 'CLOSED', completed: [1, 2, 3], previous: 'PARENT_STAGE_A_OBSERVED', next_order: 4 },
    CHILD_STAGE_B_OBSERVED: { parent: 'stage_a', child: 'stage_b', pr_379: 'CLOSED', completed: [1, 2, 3, 4], previous: 'PR379_CLOSED_STAGE_A', next_order: 5 },
    FINAL_TARGET_OBSERVED: { parent: 'stage_b', child: 'stage_b', pr_379: 'CLOSED', completed: [1, 2, 3, 4, 5], previous: 'CHILD_STAGE_B_OBSERVED', next_order: null },
  };
  return table[checkpoint] || null;
}
function finalisationStateForKind(targets, kind) {
  return kind === 'source' ? targets.source : kind === 'stage_a' ? targets.stage_a : targets.stage_b;
}
function finalisationCheckpointBindingDigest(checkpoint) {
  const spec = finalisationCheckpointSpec(checkpoint);
  if (!spec) return null;
  const target = FINALISATION_CHECKPOINT_TABLE[checkpoint];
  return digestValue({
    checkpoint,
    parent: target.parent_canonical_digest,
    child: target.child_canonical_digest,
    pr_379: spec.pr_379,
    pr_380: digestValue(finalisationPr380DecisionFacts()),
  });
}
function finalisationObservedCheckpoint(parentDigest, childDigest, pr379State) {
  for (const checkpoint of FINALISATION_CHECKPOINTS) {
    const target = FINALISATION_CHECKPOINT_TABLE[checkpoint];
    if (parentDigest === target.parent_canonical_digest
      && childDigest === target.child_canonical_digest
      && pr379State === target.pr_379_github_state) return checkpoint;
  }
  return null;
}
function classifyPostMergeEpochFinalisationCheckpoint(input = {}) {
  if (!isRecord(input)) return failure('FINALISATION_CHECKPOINT_INPUT_INVALID');
  const parentDigest = input.parent_canonical_digest ?? input.parent?.canonical_digest;
  const childDigest = input.child_canonical_digest ?? input.child?.canonical_digest;
  const pr379State = input.pr_379_github_state ?? input.pr_379?.github_state;
  if (!isDigest(parentDigest) || !isDigest(childDigest) || !['OPEN', 'CLOSED'].includes(pr379State)) {
    return failure('FINALISATION_CHECKPOINT_INPUT_INVALID');
  }
  const checkpoint = finalisationObservedCheckpoint(parentDigest, childDigest, pr379State);
  return checkpoint
    ? success('FINALISATION_CHECKPOINT_RECOGNISED', { checkpoint })
    : failure('FINALISATION_UNKNOWN_CHECKPOINT');
}
function finalisationCollectorValid(value) {
  return isRecord(value)
    && exactKeys(value, ['kind', 'identity', 'version', 'authenticated', 'provider_client_used'])
    && value.kind === 'WEB_AUTHENTICATED_GITHUB_COLLECTION'
    && value.identity === 'github-web-readonly-adapter'
    && value.version === 'v1'
    && value.authenticated === true
    && value.provider_client_used === false;
}
function finalisationFreshnessValid(value) {
  return isRecord(value)
    && exactKeys(value, ['authenticated', 'complete', 'observed_at', 'collection_revision'])
    && value.authenticated === true
    && value.complete === true
    && isTimestamp(value.observed_at)
    && isProviderRevision(value.collection_revision);
}
function finalisationPr379FactsForState(githubState) {
  const facts = finalisationPr379DecisionFacts();
  return { ...facts, provider_state: githubState, github_state: githubState };
}
function finalisationPr380Facts() {
  return finalisationPr380DecisionFacts();
}
function validateFinalisationPr379(value) {
  const required = ['pr', 'provider_state', 'github_state', 'draft', 'merged', 'head', 'tree', 'branch', 'base_ref', 'base_sha', 'version', 'revision', 'facts', 'facts_digest', 'complete'];
  if (!isRecord(value) || !exactKeys(value, required)
    || value.pr !== 379
    || !['OPEN', 'CLOSED'].includes(value.provider_state)
    || value.github_state !== value.provider_state
    || value.draft !== true
    || value.merged !== false
    || value.head !== FROZEN_HEAD
    || value.tree !== FROZEN_TREE
    || value.branch !== FROZEN_BRANCH
    || value.base_ref !== FROZEN_BASE_REF
    || value.base_sha !== MAIN_SHA
    || value.version !== FROZEN_VERSION
    || !isProviderRevision(value.revision)
    || !isRecord(value.facts)
    || !isDigest(value.facts_digest)
    || value.facts_digest !== digestValue(value.facts)
    || !same(value.facts, finalisationPr379FactsForState(value.provider_state))
    || value.complete !== true) return false;
  return true;
}
function validateFinalisationPr380(value) {
  const required = ['pr', 'provider_state', 'github_state', 'status', 'draft', 'merged', 'merge_method', 'merge_commit', 'ordered_parents', 'head', 'tree', 'branch', 'base_ref', 'base_sha', 'version', 'accepted_evidence_ref', 'revision', 'facts', 'facts_digest', 'complete'];
  if (!isRecord(value) || !exactKeys(value, required)
    || value.pr !== 380
    || value.provider_state !== 'MERGED'
    || value.github_state !== 'MERGED'
    || value.status !== 'ACCEPTED'
    || value.draft !== false
    || value.merged !== true
    || value.merge_method !== 'MERGE_COMMIT'
    || value.merge_commit !== PR380_MERGE_COMMIT
    || !same(value.ordered_parents, [PR380_BASE_SHA, PR380_HEAD])
    || value.head !== PR380_HEAD
    || value.tree !== PR380_TREE
    || value.branch !== PR380_BRANCH
    || value.base_ref !== 'main'
    || value.base_sha !== PR380_BASE_SHA
    || value.version !== PR380_VERSION
    || value.accepted_evidence_ref !== FINAL_G4_EVIDENCE_REF
    || !isProviderRevision(value.revision)
    || !isRecord(value.facts)
    || !isDigest(value.facts_digest)
    || value.facts_digest !== digestValue(value.facts)
    || !same(value.facts, finalisationPr380Facts())
    || value.complete !== true) return false;
  return true;
}
function finalisationExecutionCurrentMainFixture() {
  const acceptedHead = digestValue({
    fixture: 'post-merge-finalisation-implementation-head',
    root: FINALISATION_ROOT,
    source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
  }).slice(0, 40);
  const acceptedHeadTree = digestValue({
    fixture: 'post-merge-finalisation-implementation-head-tree',
    accepted_head: acceptedHead,
    source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
  }).slice(0, 40);
  const mergeCommit = digestValue({
    fixture: 'post-merge-finalisation-implementation-merge',
    accepted_head: acceptedHead,
    parent: PR380_MERGE_COMMIT,
    source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
  }).slice(0, 40);
  const mergeTree = digestValue({
    fixture: 'post-merge-finalisation-implementation-merge-tree',
    merge_commit: mergeCommit,
    source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
  }).slice(0, 40);
  return {
    ref: 'main',
    sha: mergeCommit,
    tree: mergeTree,
    implementation_merge: {
      accepted_head: acceptedHead,
      accepted_head_tree: acceptedHeadTree,
      merge_commit: mergeCommit,
      merge_tree: mergeTree,
      method: 'MERGE_COMMIT',
      ordered_parents: [PR380_MERGE_COMMIT, acceptedHead],
      source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
      contains_finalisation_implementation: true,
      complete: true,
    },
    fresh: true,
    complete: true,
  };
}
function validateFinalisationImmutableSourceMain(value) {
  const required = ['ref', 'sha', 'tree', 'equals_merge_commit', 'complete'];
  return isRecord(value)
    && exactKeys(value, required)
    && value.ref === 'main'
    && value.sha === PR380_MERGE_COMMIT
    && value.tree === PR380_TREE
    && value.equals_merge_commit === true
    && value.complete === true;
}
function validateFinalisationExecutionCurrentMain(value) {
  const required = ['ref', 'sha', 'tree', 'implementation_merge', 'fresh', 'complete'];
  const mergeRequired = [
    'accepted_head', 'accepted_head_tree', 'merge_commit', 'merge_tree', 'method',
    'ordered_parents', 'source_canonical_digest', 'contains_finalisation_implementation', 'complete',
  ];
  const merge = isRecord(value) ? value.implementation_merge : null;
  return isRecord(value)
    && exactKeys(value, required)
    && value.ref === 'main'
    && isSha(value.sha)
    && value.sha !== PR380_MERGE_COMMIT
    && isSha(value.tree)
    && value.fresh === true
    && value.complete === true
    && isRecord(merge)
    && exactKeys(merge, mergeRequired)
    && isSha(merge.accepted_head)
    && isSha(merge.accepted_head_tree)
    && isSha(merge.merge_commit)
    && merge.merge_commit === value.sha
    && isSha(merge.merge_tree)
    && merge.merge_tree === value.tree
    && merge.method === 'MERGE_COMMIT'
    && Array.isArray(merge.ordered_parents)
    && merge.ordered_parents.length === 2
    && same(merge.ordered_parents, [PR380_MERGE_COMMIT, merge.accepted_head])
    && merge.source_canonical_digest === FINALISATION_SOURCE_CANONICAL_DIGEST
    && merge.contains_finalisation_implementation === true
    && merge.complete === true;
}
function finalisationBindingFromEvidence(value) {
  return {
    parent_canonical_digest: value.parent.canonical_digest,
    child_canonical_digest: value.child.canonical_digest,
    parent_body_digest: value.parent.body_digest,
    child_body_digest: value.child.body_digest,
    parent_projection_digest: value.parent.projection_digest,
    child_projection_digest: value.child.projection_digest,
    parent_prefix_digest: value.parent.prefix_digest,
    parent_suffix_digest: value.parent.suffix_digest,
    child_prefix_digest: value.child.prefix_digest,
    child_suffix_digest: value.child.suffix_digest,
    pr_379_facts_digest: value.pr_379.facts_digest,
    pr_379_github_state: value.pr_379.github_state,
    pr_379_revision: value.pr_379.revision,
    pr_380_facts_digest: value.pr_380.facts_digest,
    immutable_source_main_digest: digestValue(value.immutable_source_main),
    merge_ancestry_digest: digestValue(value.merge_ancestry),
    execution_current_main_digest: digestValue(value.execution_current_main),
  };
}
function validateFinalisationSourceBinding(value, evidence) {
  const expected = finalisationBindingFromEvidence(evidence);
  return isRecord(value)
    && exactKeys(value, [...Object.keys(expected), 'snapshot_digest'])
    && same(without(value, 'snapshot_digest'), expected)
    && value.snapshot_digest === digestValue(expected);
}
function validateFinalisationBodyObservation(value, kind) {
  const required = ['issue', 'raw_body', 'body_digest', 'canonical_digest', 'projection_digest', 'prefix_digest', 'suffix_digest', 'revision', 'complete'];
  const childRequired = kind === 'child' ? ['projection'] : [];
  if (!isRecord(value) || !exactKeys(value, [...required, ...childRequired])
    || value.issue !== (kind === 'parent' ? PARENT_ISSUE : CHILD_ISSUE)
    || typeof value.raw_body !== 'string'
    || !isDigest(value.body_digest)
    || sha256Text(value.raw_body) !== value.body_digest
    || !isDigest(value.canonical_digest)
    || !isDigest(value.projection_digest)
    || !isDigest(value.prefix_digest)
    || !isDigest(value.suffix_digest)
    || !isProviderRevision(value.revision)
    || value.complete !== true) return false;
  if (kind === 'child' && !validateProjectionEnvelope(value.projection, 'child', value.canonical_digest)) return false;
  return true;
}
function validateFinalisationTransaction(value, checkpoint) {
  const spec = finalisationCheckpointSpec(checkpoint);
  if (!spec || !isRecord(value)
    || !exactKeys(value, ['acknowledgement', 'acknowledgement_loss_operation_order', 'complete', 'completed_operation_orders', 'previous_source_binding', 'readback', 'checkpoint'])
    || value.checkpoint !== checkpoint
    || !['CONFIRMED', 'LOST'].includes(value.acknowledgement)
    || !Array.isArray(value.completed_operation_orders)
    || !same(value.completed_operation_orders, spec.completed)
    || value.complete !== true
    || !isRecord(value.readback)
    || !exactKeys(value.readback, ['complete', 'exact', 'fresh_complete_rebind'])
    || value.readback.complete !== true
    || value.readback.exact !== true
    || value.readback.fresh_complete_rebind !== true) return failure('FINALISATION_TRANSACTION_INVALID');
  if (value.acknowledgement === 'CONFIRMED') {
    if (value.acknowledgement_loss_operation_order !== null) return failure('FINALISATION_ACKNOWLEDGEMENT_INVALID');
  } else {
    const last = spec.completed[spec.completed.length - 1] || null;
    if (!last || value.acknowledgement_loss_operation_order !== last) return failure('FINALISATION_ACKNOWLEDGEMENT_INVALID');
  }
  if (spec.previous === null) {
    if (value.previous_source_binding !== null) return failure('FINALISATION_PREVIOUS_SOURCE_BINDING_INVALID');
  } else if (!isRecord(value.previous_source_binding)
    || !exactKeys(value.previous_source_binding, ['checkpoint', 'binding_digest', 'complete'])
    || value.previous_source_binding.checkpoint !== spec.previous
    || value.previous_source_binding.binding_digest !== finalisationCheckpointBindingDigest(spec.previous)
    || value.previous_source_binding.complete !== true) {
    return failure('FINALISATION_PREVIOUS_SOURCE_BINDING_INVALID');
  }
  return success('FINALISATION_TRANSACTION_VALID');
}
const FINALISATION_EVIDENCE_KEYS = Object.freeze([
  'schema', 'root', 'lock', 'decision_digest', 'repository', 'parent_issue', 'child_issue',
  'parent', 'child', 'pr_379', 'pr_380', 'immutable_source_main', 'merge_ancestry', 'execution_current_main',
  'collector', 'freshness', 'source_binding', 'transaction', 'evidence_digest',
]);
function validatePostMergeEpochFinalisationEvidence(value, decisionInput = FINALISATION_DECISION_TEMPLATE) {
  const targetsResult = derivePostMergeEpochFinalisationTargets(decisionInput);
  if (!targetsResult.ok) return targetsResult;
  const decisionValid = validatePostMergeEpochFinalisationDecision(decisionInput);
  if (!isRecord(value) || !exactKeys(value, FINALISATION_EVIDENCE_KEYS)
    || value.schema !== FINALISATION_EVIDENCE_SCHEMA
    || value.root !== FINALISATION_ROOT
    || value.lock !== FINALISATION_LOCK
    || value.decision_digest !== decisionValid.decision_digest
    || value.repository !== REPOSITORY
    || value.parent_issue !== PARENT_ISSUE
    || value.child_issue !== CHILD_ISSUE
    || !validateFinalisationBodyObservation(value.parent, 'parent')
    || !validateFinalisationBodyObservation(value.child, 'child')
    || !validateFinalisationPr379(value.pr_379)
    || !validateFinalisationPr380(value.pr_380)
    || !validateFinalisationImmutableSourceMain(value.immutable_source_main)
    || !isRecord(value.merge_ancestry)
    || !exactKeys(value.merge_ancestry, ['accepted_head', 'accepted_head_tree', 'merge_commit', 'merge_tree', 'method', 'ordered_parents', 'merged'])
    || value.merge_ancestry.accepted_head !== PR380_HEAD
    || value.merge_ancestry.accepted_head_tree !== PR380_TREE
    || value.merge_ancestry.merge_commit !== PR380_MERGE_COMMIT
    || value.merge_ancestry.merge_tree !== PR380_TREE
    || value.merge_ancestry.method !== 'MERGE_COMMIT'
    || !same(value.merge_ancestry.ordered_parents, [PR380_BASE_SHA, PR380_HEAD])
    || value.merge_ancestry.merged !== true
    || !validateFinalisationExecutionCurrentMain(value.execution_current_main)
    || !finalisationCollectorValid(value.collector)
    || !finalisationFreshnessValid(value.freshness)
    || !isDigest(value.evidence_digest)) return failure('FINALISATION_EVIDENCE_INVALID');
  const parentParsed = parseParentV5Body(value.parent.raw_body, { repository: REPOSITORY, parent_issue: PARENT_ISSUE });
  const childParsed = parseChildV5Body(value.child.raw_body, { repository: REPOSITORY, parent_issue: PARENT_ISSUE });
  if (!parentParsed.ok || !childParsed.ok
    || parentParsed.body_digest !== value.parent.body_digest
    || childParsed.body_digest !== value.child.body_digest
    || parentParsed.envelope.canonical_digest !== value.parent.canonical_digest
    || childParsed.envelope.canonical_digest !== value.child.canonical_digest
    || parentParsed.envelope.projection_digest !== value.parent.projection_digest
    || childParsed.envelope.projection_digest !== value.child.projection_digest
    || !same(value.child.projection, childParsed.envelope)
    || parentParsed.prefix_digest !== value.parent.prefix_digest
    || parentParsed.suffix_digest !== value.parent.suffix_digest
    || childParsed.prefix_digest !== value.child.prefix_digest
    || childParsed.suffix_digest !== value.child.suffix_digest
    || value.parent.prefix_digest !== EMPTY_DIGEST
    || value.parent.suffix_digest !== EMPTY_DIGEST
    || value.child.prefix_digest !== EMPTY_DIGEST
    || value.child.suffix_digest !== EMPTY_DIGEST
    || !validateFinalisationSourceBinding(value.source_binding, value)) return failure('FINALISATION_EVIDENCE_RECOMPUTATION_INVALID');
  const checkpoint = finalisationObservedCheckpoint(value.parent.canonical_digest, value.child.canonical_digest, value.pr_379.github_state);
  if (!checkpoint) return failure('FINALISATION_UNKNOWN_CHECKPOINT');
  const spec = finalisationCheckpointSpec(checkpoint);
  const expectedParentState = finalisationStateForKind(targetsResult.targets, spec.parent);
  const expectedChildState = finalisationStateForKind(targetsResult.targets, spec.child);
  if (value.pr_380.facts_digest !== digestValue(finalisationPr380Facts())
    || value.parent.canonical_digest !== digestValue(expectedParentState)
    || value.child.canonical_digest !== digestValue(expectedChildState)) return failure('FINALISATION_CHECKPOINT_BINDING_INVALID');
  const expectedParentBody = spec.parent === 'source' ? targetsResult.targets.rendered.source.parent
    : spec.parent === 'stage_a' ? targetsResult.targets.rendered.stage_a.parent : targetsResult.targets.rendered.stage_b.parent;
  const expectedChildBody = spec.child === 'source' ? targetsResult.targets.rendered.source.child
    : spec.child === 'stage_a' ? targetsResult.targets.rendered.stage_a.child : targetsResult.targets.rendered.stage_b.child;
  if ((expectedParentBody !== null && value.parent.raw_body !== expectedParentBody)
    || (expectedChildBody !== null && value.child.raw_body !== expectedChildBody)
    || (spec.parent === 'source' && value.parent.body_digest !== FINALISATION_SOURCE_PARENT_BODY_DIGEST)
    || (spec.child === 'source' && value.child.body_digest !== FINALISATION_SOURCE_CHILD_BODY_DIGEST)) {
    return failure('FINALISATION_TARGET_BYTES_INVALID');
  }
  const transactionValid = validateFinalisationTransaction(value.transaction, checkpoint);
  if (!transactionValid.ok) return transactionValid;
  const expectedEvidenceDigest = digestValue(without(value, 'evidence_digest'));
  if (value.evidence_digest !== expectedEvidenceDigest) return failure('FINALISATION_EVIDENCE_DIGEST_INVALID');
  return success('FINALISATION_EVIDENCE_VALID', {
    evidence: clone(value),
    checkpoint,
    targets: targetsResult.targets,
    parsed: { parent: parentParsed, child: childParsed },
    evidence_digest: value.evidence_digest,
  });
}
function finalisationBodyObservation(rawBody, kind, revision) {
  const parsed = kind === 'parent'
    ? parseParentV5Body(rawBody, { repository: REPOSITORY, parent_issue: PARENT_ISSUE })
    : parseChildV5Body(rawBody, { repository: REPOSITORY, parent_issue: PARENT_ISSUE });
  if (!parsed.ok) return null;
  return {
    issue: kind === 'parent' ? PARENT_ISSUE : CHILD_ISSUE,
    raw_body: rawBody,
    body_digest: parsed.body_digest,
    canonical_digest: parsed.envelope.canonical_digest,
    projection_digest: parsed.envelope.projection_digest,
    prefix_digest: parsed.prefix_digest,
    suffix_digest: parsed.suffix_digest,
    revision,
    ...(kind === 'child' ? { projection: parsed.envelope } : {}),
    complete: true,
  };
}
function buildPostMergeEpochFinalisationEvidence(input = {}) {
  if (!isRecord(input)
    || !FINALISATION_CHECKPOINTS.includes(input.checkpoint)
    || typeof input.parent_body !== 'string'
    || typeof input.child_body !== 'string'
    || (input.acknowledgement !== undefined && !['CONFIRMED', 'LOST'].includes(input.acknowledgement))) return failure('FINALISATION_EVIDENCE_FIXTURE_INVALID');
  const decision = createPostMergeEpochFinalisationDecision();
  const spec = finalisationCheckpointSpec(input.checkpoint);
  const parentBody = input.parent_body;
  const childBody = input.child_body;
  const parentRevision = input.parent_revision ?? (spec.parent === 'source' ? SOURCE_PARENT_REVISION : '2026-09-09T00:00:01Z');
  const childRevision = input.child_revision ?? (spec.child === 'source' ? SOURCE_CHILD_REVISION : '2026-09-09T00:00:02Z');
  const pr379Revision = input.pr_379_revision ?? (spec.pr_379 === 'OPEN' ? FINALISATION_PR379_SOURCE_REVISION : '2026-09-09T00:00:03Z');
  const evidence = {
    schema: FINALISATION_EVIDENCE_SCHEMA,
    root: FINALISATION_ROOT,
    lock: FINALISATION_LOCK,
    decision_digest: digestValue(decision),
    repository: REPOSITORY,
    parent_issue: PARENT_ISSUE,
    child_issue: CHILD_ISSUE,
    parent: finalisationBodyObservation(parentBody, 'parent', parentRevision),
    child: finalisationBodyObservation(childBody, 'child', childRevision),
    pr_379: {
      ...finalisationPr379FactsForState(spec.pr_379),
      revision: pr379Revision,
      facts: finalisationPr379FactsForState(spec.pr_379),
      facts_digest: digestValue(finalisationPr379FactsForState(spec.pr_379)),
      complete: true,
    },
    pr_380: {
      ...finalisationPr380Facts(),
      revision: input.pr_380_revision || '2026-09-09T00:00:04Z',
      facts: finalisationPr380Facts(),
      facts_digest: digestValue(finalisationPr380Facts()),
      complete: true,
    },
    immutable_source_main: { ref: 'main', sha: PR380_MERGE_COMMIT, tree: PR380_TREE, equals_merge_commit: true, complete: true },
    merge_ancestry: {
      accepted_head: PR380_HEAD,
      accepted_head_tree: PR380_TREE,
      merge_commit: PR380_MERGE_COMMIT,
      merge_tree: PR380_TREE,
      method: 'MERGE_COMMIT',
      ordered_parents: [PR380_BASE_SHA, PR380_HEAD],
      merged: true,
    },
    execution_current_main: input.execution_current_main === undefined
      ? finalisationExecutionCurrentMainFixture()
      : clone(input.execution_current_main),
    collector: {
      kind: 'WEB_AUTHENTICATED_GITHUB_COLLECTION',
      identity: 'github-web-readonly-adapter',
      version: 'v1',
      authenticated: true,
      provider_client_used: false,
    },
    freshness: {
      authenticated: true,
      complete: true,
      observed_at: input.observed_at || '2026-09-09T00:00:05Z',
      collection_revision: input.collection_revision || '2026-09-09T00:00:06Z',
    },
    source_binding: null,
    transaction: {
      acknowledgement: input.acknowledgement || 'CONFIRMED',
      acknowledgement_loss_operation_order: input.acknowledgement === 'LOST' ? spec.completed[spec.completed.length - 1] || null : null,
      complete: true,
      completed_operation_orders: spec.completed,
      previous_source_binding: spec.previous === null ? null : {
        checkpoint: spec.previous,
        binding_digest: finalisationCheckpointBindingDigest(spec.previous),
        complete: true,
      },
      readback: { complete: true, exact: true, fresh_complete_rebind: true },
      checkpoint: input.checkpoint,
    },
    evidence_digest: null,
  };
  if (!evidence.parent || !evidence.child) return failure('FINALISATION_EVIDENCE_FIXTURE_INVALID');
  evidence.source_binding = finalisationBindingFromEvidence(evidence);
  evidence.source_binding.snapshot_digest = digestValue(without(evidence.source_binding, 'snapshot_digest'));
  evidence.evidence_digest = digestValue(without(evidence, 'evidence_digest'));
  return evidence;
}
function finalisationOperationTarget(spec, targets) {
  if (spec.operation_kind === 'IDEMPOTENT_CLOSE') {
    return {
      target_github_state: 'CLOSED',
      target_pr_facts_digest: digestValue(finalisationPr379FactsForState('CLOSED')),
    };
  }
  const state = spec.target_stage === 'STAGE_A' ? targets.stage_a : targets.stage_b;
  const kind = spec.issue === CHILD_ISSUE ? 'child' : 'parent';
  const rendered = spec.target_stage === 'STAGE_A' ? targets.rendered.stage_a : targets.rendered.stage_b;
  const targetBytes = rendered[kind];
  return {
    target_canonical_digest: digestValue(state),
    target_body_digest: sha256Text(targetBytes),
    target_projection_digest: rendered.projections[kind].projection_digest,
    target_bytes: targetBytes,
  };
}
function buildPostMergeEpochFinalisationOperation(evidence, parsed) {
  const spec = finalisationCheckpointSpec(parsed.checkpoint);
  if (!spec || spec.next_order === null) return null;
  const order = FINALISATION_OPERATION_ORDER[spec.next_order - 1];
  const resourceRevision = order.issue === CHILD_ISSUE
    ? evidence.child.revision
    : order.issue === PARENT_ISSUE
      ? evidence.parent.revision
      : evidence.pr_379.revision;
  return {
    schema: FINALISATION_OPERATION_SCHEMA,
    order: order.order,
    operation_id: order.operation_id,
    issue: order.issue,
    target_kind: order.target_kind,
    operation_kind: order.operation_kind,
    derived_from_checkpoint: parsed.checkpoint,
    ...finalisationOperationTarget(order, FINALISATION_TARGET_TABLE),
    precondition: {
      complete: true,
      resource_revision: resourceRevision,
      source_binding_digest: evidence.source_binding.snapshot_digest,
    },
    provider_client_used: false,
    provider_cas_claim: false,
    write_safety_mode: FINALISATION_WRITE_SAFETY_MODE,
    operation_digest: digestValue({
      schema: FINALISATION_OPERATION_SCHEMA,
      order: order.order,
      operation_id: order.operation_id,
      issue: order.issue,
      target_kind: order.target_kind,
      operation_kind: order.operation_kind,
      derived_from_checkpoint: parsed.checkpoint,
      target_canonical_digest: order.target_stage ? digestValue(finalisationStateForKind(FINALISATION_TARGET_TABLE, order.target_stage === 'STAGE_A' ? 'stage_a' : 'stage_b')) : null,
      target_github_state: order.operation_kind === 'IDEMPOTENT_CLOSE' ? 'CLOSED' : null,
    }),
  };
}
function previewPostMergeEpochFinalisation(input = {}) {
  if (!isRecord(input) || !exactKeys(input, ['decision', 'evidence'])) return failure('FINALISATION_PREVIEW_INPUT_INVALID');
  const decisionValid = validatePostMergeEpochFinalisationDecision(input.decision);
  if (!decisionValid.ok) return decisionValid;
  const evidenceValid = validatePostMergeEpochFinalisationEvidence(input.evidence, input.decision);
  if (!evidenceValid.ok) return evidenceValid;
  const operations = [];
  const nextOperation = buildPostMergeEpochFinalisationOperation(input.evidence, evidenceValid);
  if (nextOperation) operations.push(nextOperation);
  const zeroDelta = evidenceValid.checkpoint === 'FINAL_TARGET_OBSERVED';
  return success(zeroDelta ? 'FINALISATION_ZERO_DELTA' : 'FINALISATION_NEXT_OPERATION_READY', {
    schema: FINALISATION_OPERATION_SCHEMA,
    root: FINALISATION_ROOT,
    lock: FINALISATION_LOCK,
    checkpoint: evidenceValid.checkpoint,
    status: zeroDelta ? 'FINAL_TARGET_OBSERVED' : 'NEXT_OPERATION_ONLY',
    source_canonical_digest: FINALISATION_SOURCE_CANONICAL_DIGEST,
    stage_a_canonical_digest: FINALISATION_STAGE_A_CANONICAL_DIGEST,
    stage_b_canonical_digest: FINALISATION_STAGE_B_CANONICAL_DIGEST,
    acknowledgement_loss_rebind: input.evidence.transaction.acknowledgement === 'LOST',
    operations,
    operation_count: operations.length,
    operation_order: operations.map((operation) => operation.order),
    next_operation: nextOperation,
    provider_client_used: false,
    provider_cas_claim: false,
    programme_apply_performed: false,
    e4_started: false,
    readback_required: true,
  });
}

function validateControllerBootstrap(value) {
  const keys = ['schema', 'profile', 'repository', 'parent_issue', 'programme_state_schema', 'surface_contract_schema', 'toolkit_package_version', 'toolkit_contract', 'conformance', 'compatibility'];
  if (!isRecord(value) || !exactKeys(value, keys)
    || value.schema !== BOOTSTRAP_SCHEMA
    || value.profile !== 'github-managed-programme'
    || value.repository !== REPOSITORY
    || value.parent_issue !== PARENT_ISSUE
    || value.programme_state_schema !== STATE_SCHEMA
    || value.surface_contract_schema !== SURFACE_SCHEMA
    || value.toolkit_package_version !== '2.10.9'
    || !isRecord(value.toolkit_contract)
    || !exactKeys(value.toolkit_contract, ['repository', 'revision', 'path', 'sha256'])
    || value.toolkit_contract.repository !== REPOSITORY
    || !isSha(value.toolkit_contract.revision)
    || value.toolkit_contract.path !== 'repo/contracts/github-program-reconciler/programme-surface-contract-v5.json'
    || !isDigest(value.toolkit_contract.sha256)
    || !isRecord(value.conformance)
    || !exactKeys(value.conformance, ['actual_workspace_bytes', 'canonical_json', 'historical_git_object_required', 'resolver', 'source_revision_pinned'])
    || value.conformance.actual_workspace_bytes !== true
    || value.conformance.canonical_json !== true
    || value.conformance.historical_git_object_required !== false
    || value.conformance.resolver !== 'unchanged'
    || value.conformance.source_revision_pinned !== true
    || !isRecord(value.compatibility)
    || !exactKeys(value.compatibility, ['fail_closed_on_unknown_major', 'provider_cas_claim', 'receipt_source_changed'])
    || value.compatibility.fail_closed_on_unknown_major !== true
    || value.compatibility.provider_cas_claim !== false
    || value.compatibility.receipt_source_changed !== false) return failure('BOOTSTRAP_INVALID');
  return success('BOOTSTRAP_VALID', { bootstrap: clone(value) });
}
function verifyBootstrapWorkspaceProof(input = {}) {
  if (!isRecord(input) || !exactKeys(input, ['bootstrap', 'contract_bytes', 'workspace_revision'])) return failure('BOOTSTRAP_PROOF_INVALID');
  const valid = validateControllerBootstrap(input.bootstrap);
  if (!valid.ok) return valid;
  if (input.workspace_revision !== input.bootstrap.toolkit_contract.revision
    || typeof input.contract_bytes !== 'string'
    || input.contract_bytes.length === 0) return failure('BOOTSTRAP_WORKSPACE_BINDING_INVALID');
  let contract;
  try { contract = JSON.parse(input.contract_bytes); } catch (_error) { return failure('BOOTSTRAP_CONTRACT_JSON_INVALID'); }
  if (!isRecord(contract)
    || contract.schema !== SURFACE_SCHEMA
    || digestValue(contract) !== input.bootstrap.toolkit_contract.sha256) return failure('BOOTSTRAP_CONTRACT_DIGEST_INVALID');
  return success('BOOTSTRAP_WORKSPACE_PROOF_VALID', {
    actual_workspace_bytes: true,
    canonical_json: true,
    canonical_contract_digest: digestValue(contract),
    source_revision: input.workspace_revision,
    historical_git_object_required: false,
    resolver: 'unchanged',
  });
}

/*
 * Human-v2 is a source-bound projection layer.  It is intentionally kept
 * beside, rather than inside, the historical v5 renderer: the latter owns
 * the exact E3 byte contract and must not acquire a second interpretation.
 */
const HUMAN_V2_VERSION = 'human-v2';
const HUMAN_V2_PRESENTATION_SCHEMA = 'github.program.presentation.v2';
const HUMAN_V2_PR_PRESENTATION_SCHEMA = 'github.program.pr-presentation.v2';
const HUMAN_V2_PARENT_CARRIER_SCHEMA = 'github.program.human-parent-carrier.v2';
const HUMAN_V2_CHILD_CARRIER_SCHEMA = 'github.program.human-child-carrier.v2';
const HUMAN_V2_PR_CARRIER_SCHEMA = 'github.program.human-pr-carrier.v2';
const HUMAN_V2_PARENT_PROJECTION_SCHEMA = 'github.program.parent-projection.v2';
const HUMAN_V2_CHILD_PROJECTION_SCHEMA = 'github.program.child-projection.v2';
const HUMAN_V2_PR_PROJECTION_SCHEMA = 'github.program.pr-projection.v2';
const HUMAN_V2_PR_DESCRIPTOR_SCHEMA = 'github.program.pr-descriptor.v2';
const HUMAN_V2_CANONICAL_CLASS = 'canonical-programme-state';
const HUMAN_V2_GENERIC_ADAPTER_ID = 'generic-programme-adapter';
const HUMAN_V2_TOOLKIT_ADAPTER_ID = 'toolkit-v5-adapter';
const HUMAN_V2_ADAPTER_VERSION = HUMAN_V2_VERSION;
const HUMAN_V2_RENDERER_ID = 'github.program.markdown';
const HUMAN_V2_STAGE_B_DIGEST = FINALISATION_STAGE_B_CANONICAL_DIGEST;
const HUMAN_V2_HISTORY_DECISION_SCHEMA = 'toolkit.github-program.human-surface-conformance-decision.v1';
const HUMAN_V2_HISTORY_EVIDENCE_SCHEMA = 'toolkit.github-program.human-surface-conformance-evidence.v1';
const HUMAN_V2_HISTORY_ALLOWED_PATHS = Object.freeze([
  'prs',
  'children[*].pr_registry',
  'evidence_refs',
  'historical_transitions',
]);
const HUMAN_V2_NEXT_ACTIONS = Object.freeze([
  'BLOCKING_HOLD',
  'ACTIVE_GATE',
  'AMEND_REQUIRED',
  'REPLACEMENT_OR_AUTHORITY_REQUIRED',
  'AWAIT_EPOCH_AUTHORITY',
  'AWAIT_CHILD_FINALITY',
  'QUEUED_CHILD',
  'WAIT_DEPENDENCIES',
  'AWAIT_PROGRAMME_FINALITY',
  'PROGRAMME_COMPLETE',
]);
const HUMAN_V2_MARKERS = Object.freeze({
  parent: Object.freeze({
    begin: '<!-- MANAGED-PROGRAM-PARENT:BEGIN human-v2 -->',
    carrier: '<!-- MANAGED-PROGRAM-PARENT-CARRIER human-v2 ',
    end: '<!-- MANAGED-PROGRAM-PARENT:END human-v2 -->',
  }),
  child: Object.freeze({
    begin: '<!-- MANAGED-PROGRAM-CHILD:BEGIN human-v2 -->',
    carrier: '<!-- MANAGED-PROGRAM-CHILD-CARRIER human-v2 ',
    end: '<!-- MANAGED-PROGRAM-CHILD:END human-v2 -->',
  }),
  pr: Object.freeze({
    begin: '<!-- MANAGED-PROGRAM-PR:BEGIN human-v2 -->',
    carrier: '<!-- MANAGED-PROGRAM-PR-CARRIER human-v2 ',
    end: '<!-- MANAGED-PROGRAM-PR:END human-v2 -->',
  }),
});
const HUMAN_V2_TOOLKIT_MARKERS = Object.freeze({
  parent: Object.freeze({
    begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN human-v2 -->',
    carrier: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT-CARRIER human-v2 ',
    end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END human-v2 -->',
  }),
  child: Object.freeze({
    begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN human-v2 -->',
    carrier: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD-CARRIER human-v2 ',
    end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END human-v2 -->',
  }),
  pr: Object.freeze({
    begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN human-v2 -->',
    carrier: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR-CARRIER human-v2 ',
    end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END human-v2 -->',
  }),
});

function humanOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function humanSuccess(code, extra = {}) { return { ...extra, ok: true, code, safe_for_mutation: false }; }
function humanFailure(code, extra = {}) { return { ...extra, ok: false, code, safe_for_mutation: false }; }
function humanError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
function humanIsRepository(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 512 && /^[^/\s]+\/[^/\s]+$/.test(value);
}
function humanIsSafeLine(value, max = 8192) {
  return typeof value === 'string' && value.length <= max && !/[\r\n\t]/.test(value);
}
function humanHasMalformedUnicode(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
const HUMAN_SECRET_PATTERN = /(?:\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|tokens|bearer|password|passwd|secret|private[_ -]?key|client[_ -]?secret|authorization|credential)\s*[:=]\s*[^\s,;)}\]]+|\bbearer\s+[A-Za-z0-9._~+/=-]{1,}|\b(?:ghp|gho|ghu|ghs|ghr)[_-][A-Za-z0-9_-]{8,}\b|\bgithub_pat_[A-Za-z0-9_-]{8,}\b|\bsk-[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{12,}\b)/i;
const HUMAN_SENSITIVE_KEY_PATTERN = /^(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|password|passwd|secret|private[_ -]?key|client[_ -]?secret|authorization|credential|credentials|token|tokens|secret[_ -]?value|private[_ -]?value)$/i;
const HUMAN_PRIVATE_PATH_PATTERN = /(?:file:\/\/|data:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|(?:^|[\s(])\/(?:Users|home|root|private|etc|var|tmp|opt|srv)(?:[\\/]|$))/i;
function humanUnsafeString(value) {
  return humanHasMalformedUnicode(value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || HUMAN_SECRET_PATTERN.test(value)
    || /-----BEGIN [^-]*PRIVATE KEY-----/i.test(value)
    || HUMAN_PRIVATE_PATH_PATTERN.test(value);
}
function humanAuditValue(value, path = '$', seen = new Set()) {
  if (typeof value === 'string') return humanUnsafeString(value) ? humanFailure('HUMAN_PUBLIC_DATA_UNSAFE', { path }) : null;
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : humanFailure('HUMAN_CANONICAL_VALUE_INVALID', { path });
  if (typeof value !== 'object') return humanFailure('HUMAN_CANONICAL_VALUE_INVALID', { path });
  if (seen.has(value)) return humanFailure('HUMAN_CANONICAL_VALUE_INVALID', { path, reason: 'cycle' });
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = humanAuditValue(value[index], path + '[' + String(index) + ']', seen);
      if (result) return result;
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (HUMAN_SENSITIVE_KEY_PATTERN.test(key) || humanUnsafeString(key)) return humanFailure('HUMAN_PUBLIC_DATA_UNSAFE', { path: path + '.' + key });
      const result = humanAuditValue(item, path + '.' + key, seen);
      if (result) return result;
    }
  }
  seen.delete(value);
  return null;
}
function humanCheckedCanonicalJson(value, label = 'value') {
  const audited = humanAuditValue(value, label);
  if (audited) return audited;
  try {
    const serialized = canonicalSerialize(value);
    if (typeof serialized !== 'string' || humanHasMalformedUnicode(serialized)) return humanFailure('HUMAN_CANONICAL_VALUE_INVALID', { path: label });
    return humanSuccess('HUMAN_CANONICAL_JSON_READY', { serialized });
  } catch (_error) {
    return humanFailure('HUMAN_CANONICAL_VALUE_INVALID', { path: label });
  }
}
function humanDigestValue(value, label = 'value') {
  const checked = humanCheckedCanonicalJson(value, label);
  if (!checked.ok) return checked;
  return humanSuccess('HUMAN_DIGEST_READY', {
    digest: crypto.createHash('sha256').update(checked.serialized, 'utf8').digest('hex'),
  });
}
function humanDigestText(value, label = 'text') {
  if (typeof value !== 'string' || humanHasMalformedUnicode(value)) return humanFailure('HUMAN_PUBLIC_DATA_UNSAFE', { path: label });
  return humanSuccess('HUMAN_TEXT_DIGEST_READY', { digest: crypto.createHash('sha256').update(value, 'utf8').digest('hex') });
}
function humanCandidate(value, field = 'candidate', nullable = true) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw humanError('HUMAN_CANDIDATE_INVALID', field + ' is required');
  }
  const keys = ['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version'];
  if (!isRecord(value) || !exactKeys(value, keys) || !humanIsRepository(value.repository)
    || !humanIsSafeLine(value.branch, 512) || !humanIsSafeLine(value.base_ref, 512)
    || !isSha(value.base_sha) || !isSha(value.head) || !isSha(value.tree)
    || !humanIsSafeLine(value.version, 512)) throw humanError('HUMAN_CANDIDATE_INVALID', field + ' is not a complete lineage identity');
  return clone(value);
}
function humanText(value, field, required = true) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw humanError('HUMAN_PUBLIC_TEXT_INVALID', field + ' is required');
  }
  if (!humanIsSafeLine(value) || humanUnsafeString(value)) throw humanError('HUMAN_PUBLIC_DATA_UNSAFE', field + ' is not safe public text');
  return value;
}
function humanTextArray(value, field, required = false) {
  if (value === undefined || value === null) {
    if (!required) return [];
    throw humanError('HUMAN_PUBLIC_ARRAY_INVALID', field + ' is required');
  }
  if (!Array.isArray(value)) throw humanError('HUMAN_PUBLIC_ARRAY_INVALID', field + ' must be an array');
  return value.map((item, index) => humanText(item, field + '[' + String(index) + ']'));
}
function humanIssue(value, field, nullable = false) {
  if ((value === null || value === undefined) && nullable) return null;
  if (!isIssue(value)) throw humanError('HUMAN_ISSUE_INVALID', field + ' must be a positive issue number');
  return value;
}
function humanStateName(value, field, fallback = 'PENDING') {
  const result = value === undefined || value === null || value === '' ? fallback : String(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9 _./:-]{0,127}$/.test(result) || humanUnsafeString(result)) throw humanError('HUMAN_STATE_INVALID', field + ' is not safe');
  return result;
}
function humanDigest(value, field, nullable = false) {
  if ((value === null || value === undefined) && nullable) return null;
  if (!isDigest(value)) throw humanError('HUMAN_DIGEST_INVALID', field + ' must be a lowercase SHA-256 digest');
  return value;
}
function humanValidateGenericDescriptor(value, field = 'prs[]', allowPreNumber = false) {
  const required = ['changed_surfaces', 'child_issue', 'design_constraints', 'eli5', 'evidence_refs', 'number', 'out_of_scope', 'purpose', 'scope', 'summary', 'validation_requirements'];
  const optional = ['schema', 'repository', 'candidate', 'number_authority', 'position', 'next_action', 'applicability', 'optional', 'repair_history', 'before_after', 'repair_budget', 'hosted_qualification', 'recovery_evidence'];
  if (!isRecord(value) || !hasOnly(value, required, optional)) return false;
  if (!Array.isArray(value.changed_surfaces) || !value.changed_surfaces.every((item) => humanIsSafeLine(item))) return false;
  if (!isIssue(value.child_issue) || !Array.isArray(value.design_constraints) || !value.design_constraints.every((item) => humanIsSafeLine(item))) return false;
  if (!humanIsSafeLine(value.eli5) || !Array.isArray(value.evidence_refs) || !value.evidence_refs.every((item) => isSafeId(item, 512))) return false;
  if (allowPreNumber ? (value.number !== null && !isIssue(value.number)) : !isIssue(value.number)) return false;
  if (!Array.isArray(value.out_of_scope) || !value.out_of_scope.every((item) => humanIsSafeLine(item))
    || !humanIsSafeLine(value.purpose) || !Array.isArray(value.scope) || !value.scope.every((item) => humanIsSafeLine(item))
    || !humanIsSafeLine(value.summary) || !Array.isArray(value.validation_requirements) || !value.validation_requirements.every((item) => humanIsSafeLine(item))) return false;
  if (humanUnsafeString(JSON.stringify(value))) return false;
  if (humanOwn(value, 'candidate') && value.candidate !== null) {
    try { humanCandidate(value.candidate, field + '.candidate', false); } catch (_error) { return false; }
  }
  if (humanOwn(value, 'number_authority') && value.number_authority !== null && !isRecord(value.number_authority)) return false;
  if (humanOwn(value, 'schema') && value.schema !== HUMAN_V2_PR_DESCRIPTOR_SCHEMA) return false;
  if (humanOwn(value, 'repository') && !humanIsRepository(value.repository)) return false;
  return true;
}
function humanValidateGenericRegistry(value, field = 'pr_registry[]') {
  if (!isRecord(value)) return false;
  const required = ['accepted_evidence_ref', 'completes_child', 'epoch_id', 'pr', 'retirement_evidence_ref', 'role', 'status'];
  const optional = ['candidate', 'draft', 'github_state', 'merged', 'retention_evidence_ref'];
  if (!hasOnly(value, required, optional) || !isIssue(value.pr) || !isSafeId(value.epoch_id, 512)
    || typeof value.completes_child !== 'boolean' || !isSafeId(value.role, 128) || !isSafeId(value.status, 128)) return false;
  for (const key of ['accepted_evidence_ref', 'retirement_evidence_ref', 'retention_evidence_ref']) {
    if (humanOwn(value, key) && value[key] !== null && !isSafeId(value[key], 512)) return false;
  }
  for (const key of ['draft', 'merged']) if (humanOwn(value, key) && typeof value[key] !== 'boolean') return false;
  if (humanOwn(value, 'github_state') && !humanIsSafeLine(value.github_state, 128)) return false;
  if (humanOwn(value, 'candidate') && value.candidate !== null) {
    try { humanCandidate(value.candidate, field + '.candidate', false); } catch (_error) { return false; }
  }
  return true;
}
function humanValidateGenericEpoch(value, field = 'epochs[]') {
  return isRecord(value) && hasOnly(value, ['id', 'name', 'purpose', 'terminal_disposition', 'evidence_ref'], ['gates', 'lock', 'state', 'status'])
    && isSafeId(value.id, 512) && humanIsSafeLine(value.name) && humanIsSafeLine(value.purpose)
    && (value.terminal_disposition === null || ['ACCEPTED', 'REJECTED', 'AMEND'].includes(value.terminal_disposition))
    && (value.evidence_ref === null || isSafeId(value.evidence_ref, 512))
    && (!humanOwn(value, 'gates') || (Array.isArray(value.gates) && value.gates.every((item) => humanIsSafeLine(item, 256))))
    && (!humanOwn(value, 'lock') || isSafeId(value.lock, 512))
    && (!humanOwn(value, 'state') || humanIsSafeLine(value.state, 128))
    && (!humanOwn(value, 'status') || humanIsSafeLine(value.status, 128));
}
function humanValidateGenericEvidence(value, field = 'evidence_refs[]') {
  return isRecord(value) && hasOnly(value, ['id', 'kind', 'reference', 'summary'])
    && isSafeId(value.id, 512) && humanIsSafeLine(value.kind, 128) && humanIsSafeLine(value.reference, 1024) && humanIsSafeLine(value.summary);
}
function humanValidateGenericCanonicalState(value) {
  if (!isRecord(value) || !humanIsSafeLine(value.schema, 512) || !humanIsRepository(value.repository)
    || !isRecord(value.parent) || !isIssue(value.parent.issue) || !humanIsSafeLine(value.parent.title) || !humanIsSafeLine(value.parent.goal)) return false;
  if (humanOwn(value, 'source') || humanOwn(value, 'next_action') || humanOwn(value, 'current_child') || humanOwn(value, 'status')) return false;
  if (!Array.isArray(value.children) || value.children.length === 0 || !Array.isArray(value.prs)
    || !Array.isArray(value.evidence_refs) || !Array.isArray(value.historical_transitions) || !Array.isArray(value.active_lanes)) return false;
  const issueSet = new Set();
  const orderSet = new Set();
  let currentCount = 0;
  for (const [index, child] of value.children.entries()) {
    if (!isRecord(child) || !isIssue(child.issue) || issueSet.has(child.issue) || !Number.isSafeInteger(child.order) || orderSet.has(child.order)
      || !humanIsSafeLine(child.title) || !humanIsSafeLine(child.summary) || !humanIsSafeLine(child.objective) || !humanIsSafeLine(child.eli5)
      || !Array.isArray(child.scope) || !child.scope.every((item) => humanIsSafeLine(item)) || !Array.isArray(child.boundaries) || !child.boundaries.every((item) => humanIsSafeLine(item))
      || !Array.isArray(child.out_of_scope) || !child.out_of_scope.every((item) => humanIsSafeLine(item)) || !Array.isArray(child.done_when) || !child.done_when.every((item) => humanIsSafeLine(item))
      || !Array.isArray(child.epochs) || !child.epochs.every((item) => humanValidateGenericEpoch(item, 'children[' + String(index) + '].epochs'))
      || !isRecord(child.finality) || !['HELD', 'MERGED', 'UNMERGED'].includes(child.finality.state)
      || !Array.isArray(child.pr_registry) || !child.pr_registry.every((item) => humanValidateGenericRegistry(item))) return false;
    if (humanOwn(child, 'dependencies') && (!Array.isArray(child.dependencies) || !child.dependencies.every(isIssue))) return false;
    if (humanOwn(child, 'holds') && !Array.isArray(child.holds)) return false;
    if (!['COMPLETED', 'CURRENT', 'QUEUED'].includes(child.lifecycle)) return false;
    if (child.lifecycle === 'CURRENT') currentCount += 1;
    issueSet.add(child.issue); orderSet.add(child.order);
  }
  if (currentCount !== 1) return false;
  if (!value.prs.every((item) => humanValidateGenericDescriptor(item, 'prs[]'))) return false;
  if (!value.evidence_refs.every((item) => humanValidateGenericEvidence(item))) return false;
  if (!value.historical_transitions.every((item) => isRecord(item))) return false;
  for (const lane of value.active_lanes) {
    if (!isRecord(lane) || !isIssue(lane.child_issue ?? lane.child)) return false;
    const child = value.children.find((item) => item.issue === (lane.child_issue ?? lane.child));
    if (!child || child.lifecycle !== 'CURRENT') return false;
  }
  if (humanOwn(value, 'extensions') && (!Array.isArray(value.extensions) || !value.extensions.every(isRecord))) return false;
  return true;
}
function validateHumanCanonicalState(value) {
  if (!isRecord(value)) return humanFailure('HUMAN_CANONICAL_STATE_INVALID');
  const audited = humanAuditValue(value);
  if (audited) return audited;
  const toolkitIdentity = value.schema === STATE_SCHEMA;
  const valid = validateCanonicalStateV5(value);
  if (toolkitIdentity && !valid.ok) {
    const historyExtended = typeof humanValidateHistoryExtendedToolkitState === 'function' ? humanValidateHistoryExtendedToolkitState(value) : humanFailure('HUMAN_CANONICAL_STATE_INVALID');
    if (!historyExtended.ok) return humanFailure(valid.code === 'V5_STATE_INVALID' ? 'HUMAN_CANONICAL_STATE_INVALID' : valid.code, { reason: valid.reason });
  }
  if (!toolkitIdentity && !humanValidateGenericCanonicalState(value)) return humanFailure('HUMAN_CANONICAL_STATE_INVALID');
  const digest = humanDigestValue(value, 'canonical_state');
  if (!digest.ok) return digest;
  return humanSuccess('HUMAN_CANONICAL_STATE_VALID', {
    state: clone(value),
    canonical_digest: digest.digest,
    adapter_id: toolkitIdentity ? HUMAN_V2_TOOLKIT_ADAPTER_ID : HUMAN_V2_GENERIC_ADAPTER_ID,
    adapter_version: HUMAN_V2_ADAPTER_VERSION,
  });
}

function humanMarkerStyle(options = {}) {
  const markers = options.markers;
  if (options.toolkit === true || markers === HUMAN_V2_TOOLKIT_MARKERS) return { namespace: 'toolkit', markers: HUMAN_V2_TOOLKIT_MARKERS, toolkit: true };
  if (markers === HUMAN_V2_MARKERS || markers === undefined || markers === null) return { namespace: 'generic', markers: HUMAN_V2_MARKERS, toolkit: false };
  if (isRecord(markers) && markers.parent && markers.child && markers.pr
    && markers.parent.begin === HUMAN_V2_MARKERS.parent.begin && markers.child.begin === HUMAN_V2_MARKERS.child.begin && markers.pr.begin === HUMAN_V2_MARKERS.pr.begin) return { namespace: 'generic', markers: HUMAN_V2_MARKERS, toolkit: false };
  if (isRecord(markers) && markers.parent && markers.child && markers.pr
    && markers.parent.begin === HUMAN_V2_TOOLKIT_MARKERS.parent.begin && markers.child.begin === HUMAN_V2_TOOLKIT_MARKERS.child.begin && markers.pr.begin === HUMAN_V2_TOOLKIT_MARKERS.pr.begin) return { namespace: 'toolkit', markers: HUMAN_V2_TOOLKIT_MARKERS, toolkit: true };
  throw humanError('MARKER_MIXED_NAMESPACE', 'unsupported marker family');
}
function humanPrefixSuffix(options = {}) {
  const prefix = options.prefix === undefined ? '' : options.prefix;
  const suffix = options.suffix === undefined ? '' : options.suffix;
  if (typeof prefix !== 'string' || typeof suffix !== 'string' || humanHasMalformedUnicode(prefix) || humanHasMalformedUnicode(suffix)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prefix + suffix)) throw humanError('HUMAN_PREFIX_SUFFIX_INVALID', 'prefix and suffix are not byte-safe strings');
  if (prefix.includes('MANAGED-PROGRAM-') || prefix.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-')
    || suffix.includes('MANAGED-PROGRAM-') || suffix.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-')) throw humanError('RESERVED_RESIDUE_OUTSIDE_BLOCK', 'reserved marker residue is outside the managed block');
  return { prefix, suffix };
}
function humanCarrierEncoding(value) {
  const checked = humanCheckedCanonicalJson(value, 'carrier');
  if (!checked.ok) throw humanError(checked.code, 'carrier is not canonical');
  return Buffer.from(checked.serialized, 'utf8').toString('base64url');
}
function humanCarrierDecoding(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return humanFailure('CARRIER_DECODE_INVALID');
  let decoded;
  try { decoded = Buffer.from(value, 'base64url').toString('utf8'); } catch (_error) { return humanFailure('CARRIER_DECODE_INVALID'); }
  if (humanHasMalformedUnicode(decoded) || Buffer.from(decoded, 'utf8').toString('base64url') !== value) return humanFailure('CARRIER_DECODE_INVALID');
  let parsed;
  try { parsed = JSON.parse(decoded); } catch (_error) { return humanFailure('CARRIER_DECODE_INVALID'); }
  const checked = humanCheckedCanonicalJson(parsed, 'carrier');
  if (!checked.ok || checked.serialized !== decoded) return humanFailure('CARRIER_DECODE_INVALID');
  return humanSuccess('CARRIER_DECODED', { carrier: parsed, encoded: value });
}

function humanCodecEncode(value, context = 'paragraph') {
  if (typeof value !== 'string' || !humanIsSafeLine(value) || humanUnsafeString(value)) throw humanError('HUMAN_PUBLIC_DATA_UNSAFE', context + ' contains unsafe text');
  let encoded = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  encoded = encoded.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  encoded = encoded.replace(/[\*_\[\]\(\){}#+!>]/g, '\\$&');
  if (context === 'table-cell') encoded = encoded.replace(/\|/g, '\\|');
  if ((context === 'bullet' && /^\s*[-+*]>?\s/.test(value)) || (context === 'heading' && /^\s*#{1,6}\s/.test(value))) {
    encoded = '\\' + encoded;
  }
  return encoded;
}
function humanCodecUrl(value) {
  if (typeof value !== 'string' || humanHasMalformedUnicode(value) || /[\r\n\t]/.test(value)) throw humanError('HUMAN_PUBLIC_URL_INVALID', 'URL is not a safe public URL');
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw humanError('HUMAN_PUBLIC_URL_INVALID', 'URL is not valid'); }
  const hostname = parsed.hostname.toLowerCase();
  const privateHost = hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')
    || /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    || !hostname.includes('.');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || privateHost
    || /(?:token|secret|password|passwd|api[_-]?key|authorization|private[_-]?key|credential)/i.test(parsed.search + parsed.hash)
    || humanUnsafeString(value)) throw humanError('HUMAN_PUBLIC_URL_INVALID', 'URL is not a safe public HTTPS URL');
  return '<' + value.replace(/&/g, '&amp;') + '>';
}
const PublicSurfaceCodec = Object.freeze({
  paragraph: (value) => humanCodecEncode(value, 'paragraph'),
  heading: (value) => humanCodecEncode(value, 'heading'),
  bullet: (value) => humanCodecEncode(value, 'bullet'),
  tableCell: (value) => humanCodecEncode(value, 'table-cell'),
  identifier: (value) => humanCodecEncode(value, 'identifier'),
  lineage: (value) => humanCodecEncode(value, 'lineage'),
  url: humanCodecUrl,
});
function humanBoundaryCategory(value) {
  const textValue = String(value).toUpperCase();
  if (/SAFETY|HOLD|SECURITY|PRIVATE/.test(textValue)) return 'SAFETY';
  if (/NOT[_ -]?AUTHORI[ZS]ED|UNAUTHORI[ZS]ED|PROHIBIT|DENY|CANNOT/.test(textValue)) return 'NOT_AUTHORISED';
  if (/OUT[_ -]?OF[_ -]?SCOPE|OUTSIDE/.test(textValue)) return 'OUT_OF_SCOPE';
  if (/READY|MERGE|FINALITY|TRANSITION|WEB OWNS|AUTHORITY/.test(textValue)) return 'OWNERSHIP_AUTHORITY';
  if (/LIFECYCLE|CURRENT CHILD|COMPLETION|FINAL/.test(textValue)) return 'LIFECYCLE_FINALITY_RESTRICTION';
  return 'SCOPE';
}
function humanBoundaryProjection(state, child) {
  const values = [];
  const append = (items, fallbackCategory) => {
    if (!Array.isArray(items)) return;
    for (const item of items) values.push({ category: fallbackCategory || humanBoundaryCategory(item), text: item });
  };
  append(state.boundaries, null);
  append(child?.boundaries, null);
  append(child?.out_of_scope, 'OUT_OF_SCOPE');
  append(state.out_of_scope, 'OUT_OF_SCOPE');
  const holds = Array.isArray(child?.holds) ? child.holds.filter((item) => item && item.active === true && item.blocks_normal_lanes === true) : [];
  if (holds.length) append(holds.map((item) => item.summary), 'SAFETY');
  const unique = new Set();
  return values.filter((item) => {
    const key = item.category + '\u0000' + item.text;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
}
function humanEvidenceMap(state) {
  const result = new Map();
  for (const item of state.evidence_refs || []) {
    if (result.has(item.id)) throw humanError('HUMAN_EVIDENCE_DUPLICATE', item.id);
    result.set(item.id, item);
  }
  return result;
}
function humanLanesFor(state, childIssue) {
  return (state.active_lanes || []).filter((lane) => (lane.child_issue ?? lane.child) === childIssue);
}
function humanEpochProjection(child, evidence, state) {
  const lanes = humanLanesFor(state, child.issue);
  return child.epochs.map((epoch) => {
    const lane = lanes.find((item) => (item.epoch_id ?? item.epoch) === epoch.id) || null;
    const disposition = epoch.terminal_disposition;
    const stateName = disposition || (lane ? 'ACTIVE' : 'PENDING');
    const evidenceItem = epoch.evidence_ref ? evidence.get(epoch.evidence_ref) : null;
    const outcome = disposition
      ? (evidenceItem?.summary || disposition)
      : lane
        ? 'Active gate: ' + String(lane.gate_result ?? lane.gate ?? 'in progress') + '.'
        : 'Pending authority or completion for ' + epoch.name + '.';
    return {
      id: epoch.id,
      name: epoch.name,
      purpose: epoch.purpose,
      state: stateName,
      outcome,
      evidence_ref: epoch.evidence_ref ?? null,
      why: evidenceItem?.summary || epoch.purpose,
    };
  });
}
function humanDescriptorMap(state) {
  const map = new Map();
  for (const descriptor of state.prs || []) {
    if (map.has(descriptor.number)) throw humanError('HUMAN_PR_DESCRIPTOR_DUPLICATE', '#' + String(descriptor.number));
    map.set(descriptor.number, descriptor);
  }
  return map;
}
function humanPrOutcome(entry) {
  const status = String(entry.status || 'RECORDED').toUpperCase();
  const github = entry.github_state ? String(entry.github_state).toUpperCase() : null;
  if (status === 'ACCEPTED' && github === 'MERGED') return 'ACCEPTED / MERGED';
  if (status === 'RETIRED' && github === 'CLOSED') return 'RETIRED / CLOSED';
  return github ? status + ' / ' + github : status;
}
function humanPrHistory(child, state, descriptors, evidence) {
  return (child.pr_registry || []).map((entry) => {
    const descriptor = descriptors.get(entry.pr);
    const evidenceRef = entry.accepted_evidence_ref || entry.retirement_evidence_ref || entry.retention_evidence_ref || null;
    return {
      pr: entry.pr,
      child_issue: child.issue,
      epoch_id: entry.epoch_id,
      what_it_was_for: descriptor?.purpose || entry.purpose || 'Canonical registry chronology for this child.',
      outcome: humanPrOutcome(entry),
      why: evidence.get(evidenceRef)?.summary || descriptor?.summary || entry.summary || 'The canonical registry records this disposition.',
    };
  });
}
function humanBlockingHolds(state, child) {
  const values = [];
  const append = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) if (isRecord(item) && item.active === true && item.blocks_normal_lanes === true) values.push(item);
  };
  append(state.holds);
  append(child?.holds);
  if (state.recovery?.active_blocking_recovery_hold === true) values.push({ id: state.recovery.root || 'recovery-hold', summary: state.recovery.summary || 'An authority-defined recovery hold is active.' });
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item.id || item.root || 'hold');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => ({ id: String(item.id || item.root || 'hold'), summary: String(item.summary || 'An authority-defined blocking hold is active.') }));
}
function humanContradiction(state) {
  for (const child of state.children) {
    if (child.lifecycle === 'COMPLETED' && child.finality.state !== 'MERGED') return 'completed child is not merged';
    for (const epoch of child.epochs) {
      if (epoch.terminal_disposition !== null && epoch.terminal_disposition !== undefined && !epoch.evidence_ref) return 'terminal epoch lacks evidence';
    }
    for (const entry of child.pr_registry || []) {
      if (entry.completes_child === true && child.lifecycle !== 'COMPLETED') return 'registry claims child completion before lifecycle completion';
      if (entry.merged === true && entry.github_state && entry.github_state !== 'MERGED') return 'merged registry entry has non-merged provider state';
    }
  }
  return null;
}
function humanProgrammeFinality(state) {
  const candidates = [state.programme_finality, state.finality, state.parent?.finality].filter(isRecord);
  return candidates.find((item) => item.state === 'MERGED' && (item.authority_ref || item.authority || item.evidence_ref)) || null;
}
function humanAction(kind, source, text) { return { kind, source: source === undefined ? null : source, text }; }
function humanGlobalNextAction(state, currentChild) {
  const contradiction = humanContradiction(state);
  if (contradiction) throw humanError('CANONICAL_STATE_CONTRADICTORY', contradiction);
  const holds = humanBlockingHolds(state, currentChild);
  if (holds.length) return humanAction('BLOCKING_HOLD', holds[0].id, 'Maintain the active blocking hold and wait for the authority-defined next window.');
  const lanes = state.active_lanes || [];
  if (lanes.length) {
    const lane = lanes[0];
    return humanAction('ACTIVE_GATE', lane.epoch_id || lane.epoch || 'active-gate', 'Continue the active gate for child #' + String(lane.child_issue ?? lane.child) + '.');
  }
  const currentEpochs = currentChild ? currentChild.epochs : [];
  const amend = currentEpochs.find((epoch) => epoch.terminal_disposition === 'AMEND');
  if (amend) return humanAction('AMEND_REQUIRED', amend.id, 'Amend ' + amend.name + ' under fresh authority before continuing.');
  const rejected = currentEpochs.find((epoch) => epoch.terminal_disposition === 'REJECTED');
  if (rejected) return humanAction('REPLACEMENT_OR_AUTHORITY_REQUIRED', rejected.id, 'Obtain an authorised replacement or disposition for ' + rejected.name + '.');
  const replacement = (currentChild?.pr_registry || []).find((entry) => ['REJECTED', 'SUPERSEDED', 'NON_CONVERGENT'].includes(String(entry.status).toUpperCase()));
  if (replacement) return humanAction('REPLACEMENT_OR_AUTHORITY_REQUIRED', replacement.pr, 'Obtain an authorised replacement or disposition for PR #' + String(replacement.pr) + '.');
  const pending = currentEpochs.find((epoch) => epoch.terminal_disposition === null || epoch.terminal_disposition === undefined);
  if (pending) return humanAction('AWAIT_EPOCH_AUTHORITY', pending.id, 'Complete or obtain authority for ' + pending.name + '.');
  if (currentChild && (currentChild.lifecycle === 'CURRENT' || currentChild.finality.state !== 'MERGED')) {
    return humanAction('AWAIT_CHILD_FINALITY', currentChild.issue, 'Await authoritative child finality for #' + String(currentChild.issue) + '.');
  }
  const queued = state.children.filter((child) => child.lifecycle === 'QUEUED');
  const readyQueued = queued.find((child) => (child.dependencies || []).every((dependency) => {
    const dependencyChild = state.children.find((item) => item.issue === dependency);
    return dependencyChild && dependencyChild.lifecycle === 'COMPLETED' && dependencyChild.finality.state === 'MERGED';
  }));
  if (readyQueued) return humanAction('QUEUED_CHILD', readyQueued.issue, 'Begin queued child #' + String(readyQueued.issue) + ' when its authority window opens.');
  const blockedQueued = queued.find((child) => (child.dependencies || []).some((dependency) => {
    const dependencyChild = state.children.find((item) => item.issue === dependency);
    return !dependencyChild || dependencyChild.lifecycle !== 'COMPLETED' || dependencyChild.finality.state !== 'MERGED';
  }));
  if (blockedQueued) return humanAction('WAIT_DEPENDENCIES', blockedQueued.issue, 'Wait for dependencies before starting child #' + String(blockedQueued.issue) + '.');
  if (queued.length) return humanAction('QUEUED_CHILD', queued[0].issue, 'Begin queued child #' + String(queued[0].issue) + ' when its authority window opens.');
  const allCompleted = state.children.every((child) => child.lifecycle === 'COMPLETED' && child.finality.state === 'MERGED');
  if (!allCompleted) return humanAction('AWAIT_CHILD_FINALITY', currentChild?.issue || null, 'Await authoritative finality for the remaining child work.');
  if (!humanProgrammeFinality(state)) return humanAction('AWAIT_PROGRAMME_FINALITY', state.parent.issue, 'Await authoritative programme finality.');
  return humanAction('PROGRAMME_COMPLETE', state.parent.issue, 'The programme is complete; no child or phase remains pending.');
}
function humanChildNextAction(state, child) {
  const holds = humanBlockingHolds(state, child);
  if (holds.length) return humanAction('BLOCKING_HOLD', holds[0].id, 'Maintain the active blocking hold and wait for the authority-defined next window.');
  const lane = humanLanesFor(state, child.issue)[0];
  if (lane) return humanAction('ACTIVE_GATE', lane.epoch_id || lane.epoch || 'active-gate', 'Continue the active gate for this child.');
  const amend = child.epochs.find((epoch) => epoch.terminal_disposition === 'AMEND');
  if (amend) return humanAction('AMEND_REQUIRED', amend.id, 'Amend ' + amend.name + ' under fresh authority.');
  const rejected = child.epochs.find((epoch) => epoch.terminal_disposition === 'REJECTED');
  if (rejected) return humanAction('REPLACEMENT_OR_AUTHORITY_REQUIRED', rejected.id, 'Obtain an authorised replacement or disposition for ' + rejected.name + '.');
  const replacement = (child.pr_registry || []).find((entry) => ['REJECTED', 'SUPERSEDED', 'NON_CONVERGENT'].includes(String(entry.status).toUpperCase()));
  if (replacement) return humanAction('REPLACEMENT_OR_AUTHORITY_REQUIRED', replacement.pr, 'Obtain an authorised replacement or disposition for PR #' + String(replacement.pr) + '.');
  const pending = child.epochs.find((epoch) => epoch.terminal_disposition === null || epoch.terminal_disposition === undefined);
  if (pending) return humanAction('AWAIT_EPOCH_AUTHORITY', pending.id, 'Complete or obtain authority for ' + pending.name + '.');
  if (child.lifecycle === 'QUEUED') {
    const dependenciesReady = (child.dependencies || []).every((dependency) => {
      const item = state.children.find((candidate) => candidate.issue === dependency);
      return item && item.lifecycle === 'COMPLETED' && item.finality.state === 'MERGED';
    });
    return dependenciesReady ? humanAction('QUEUED_CHILD', child.issue, 'Begin this queued child when its authority window opens.') : humanAction('WAIT_DEPENDENCIES', child.issue, 'Wait for this child\'s dependencies to become terminal.');
  }
  if (child.lifecycle === 'COMPLETED' && child.finality.state === 'MERGED') return humanAction('CHILD_COMPLETE', child.issue, 'This child is complete and receives no current-child instruction.');
  return humanAction('AWAIT_CHILD_FINALITY', child.issue, 'Await authoritative finality for this child.');
}
function humanSelectChildFromState(state, optionalChildIssue) {
  const children = state.children || [];
  if (optionalChildIssue !== undefined && optionalChildIssue !== null) {
    const matches = children.filter((child) => child.issue === optionalChildIssue);
    if (matches.length !== 1) throw humanError('CHILD_NOT_FOUND', 'requested child does not resolve exactly once');
    return matches[0];
  }
  const current = children.filter((child) => child.lifecycle === 'CURRENT');
  if (current.length !== 1) throw humanError('CHILD_SELECTION_AMBIGUOUS', 'exactly one CURRENT child is required when child_issue is omitted');
  return current[0];
}
function humanChildSelectionGuard(state, optionalChildIssue) {
  if (optionalChildIssue !== undefined && optionalChildIssue !== null) return null;
  if (!isRecord(state) || !Array.isArray(state.children)) return null;
  const currentCount = state.children.filter((child) => isRecord(child) && child.lifecycle === 'CURRENT').length;
  return currentCount === 1 ? null : humanFailure('CHILD_SELECTION_AMBIGUOUS');
}
function humanBuildProjection(state, kind, options = {}) {
  const valid = validateHumanCanonicalState(state);
  if (!valid.ok) return valid;
  try {
    const value = valid.state;
    const child = humanSelectChildFromState(value, kind === 'child' ? options.child_issue : undefined);
    const evidence = humanEvidenceMap(value);
    const descriptors = humanDescriptorMap(value);
    const globalAction = humanGlobalNextAction(value, humanSelectChildFromState(value));
    const boundaries = humanBoundaryProjection(value, child);
    if (kind === 'parent') {
      const projection = {
        schema: HUMAN_V2_PARENT_PROJECTION_SCHEMA,
        version: HUMAN_V2_VERSION,
        kind: 'parent',
        repository: value.repository,
        parent_issue: value.parent.issue,
        title: value.parent.title,
        lifecycle: value.parent.lifecycle || (value.children.some((item) => item.lifecycle === 'CURRENT') ? 'ACTIVE' : 'COMPLETED'),
        finality: value.parent.finality?.state || value.programme_finality?.state || (child.finality.state === 'MERGED' ? 'PENDING' : child.finality.state),
        current_child: { issue: child.issue, title: child.title, lifecycle: child.lifecycle, finality: child.finality.state, summary: child.summary },
        current_phase: child.epochs.find((epoch) => epoch.terminal_disposition === null || epoch.terminal_disposition === undefined)?.id || null,
        next_action: globalAction,
        work_packages: value.children.slice().sort((left, right) => left.order - right.order).map((item) => ({ issue: item.issue, order: item.order, title: item.title, purpose: item.objective, lifecycle: item.lifecycle, finality: item.finality.state })),
        completed_work: value.children.filter((item) => item.lifecycle === 'COMPLETED').map((item) => ({ issue: item.issue, title: item.title, summary: item.summary })),
        boundaries,
      };
      return humanSuccess('HUMAN_PROJECTION_READY', { projection, projection_digest: digestValue(projection), state: value, canonical_digest: valid.canonical_digest });
    }
    const projection = {
      schema: HUMAN_V2_CHILD_PROJECTION_SCHEMA,
      version: HUMAN_V2_VERSION,
      kind: 'child',
      repository: value.repository,
      parent_issue: value.parent.issue,
      child_issue: child.issue,
      title: child.title,
      lifecycle: child.lifecycle,
      summary: child.summary,
      objective: child.objective,
      scope: child.scope,
      boundaries,
      out_of_scope: child.out_of_scope,
      done_when: child.done_when,
      eli5: child.eli5,
      finality: child.finality.state,
      epochs: humanEpochProjection(child, evidence, value),
      pr_history: humanPrHistory(child, value, descriptors, evidence),
      next_action: humanChildNextAction(value, child),
    };
    return humanSuccess('HUMAN_PROJECTION_READY', { projection, projection_digest: digestValue(projection), state: value, canonical_digest: valid.canonical_digest, child_issue: child.issue });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_PROJECTION_INVALID', { reason: error.message });
  }
}

function humanFindTokens(body, markerText) {
  const result = [];
  if (typeof body !== 'string' || !markerText) return result;
  let offset = 0;
  while (true) {
    const index = body.indexOf(markerText, offset);
    if (index < 0) break;
    result.push(index);
    offset = index + markerText.length;
  }
  return result;
}
function humanLineBoundary(body, index, afterLength = 0) {
  return (index === 0 || body[index - 1] === '\n')
    && (index + afterLength === body.length || body[index + afterLength] === '\n');
}
function humanContainsLegacyMarker(body) {
  return typeof body === 'string' && /AI-AGENT-TOOLKIT:GITHUB-PROGRAM-(?:PARENT|CHILD):(?:BEGIN v5|END)/.test(body);
}
function humanReservedClassification(body, expectedKind) {
  if (typeof body !== 'string') return humanFailure('BODY_NOT_STRING');
  const hasHumanV1 = /(?:MANAGED-PROGRAM-[^>\r\n]*|AI-AGENT-TOOLKIT:GITHUB-PROGRAM-[^>\r\n]*)human-v1/i.test(body);
  if (hasHumanV1) return humanFailure('HUMAN_V1_UNSUPPORTED');
  const unknownVersion = /(?:MANAGED-PROGRAM-[^>\r\n]*|AI-AGENT-TOOLKIT:GITHUB-PROGRAM-[^>\r\n]*)human-(?!v2(?:\s|-->|$))[A-Za-z0-9_-]+/i.test(body);
  if (unknownVersion) return humanFailure('HUMAN_VERSION_UNSUPPORTED');
  const genericHits = [];
  const toolkitHits = [];
  for (const kind of ['parent', 'child', 'pr']) {
    for (const part of ['begin', 'carrier', 'end']) {
      if (humanFindTokens(body, HUMAN_V2_MARKERS[kind][part]).length) genericHits.push(kind + ':' + part);
      if (humanFindTokens(body, HUMAN_V2_TOOLKIT_MARKERS[kind][part]).length) toolkitHits.push(kind + ':' + part);
    }
  }
  const hasHumanV2 = genericHits.length > 0 || toolkitHits.length > 0;
  const hasReserved = body.includes('MANAGED-PROGRAM-') || body.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-');
  if (hasHumanV2) {
    if (genericHits.length && toolkitHits.length) return humanFailure('MARKER_MIXED_NAMESPACE');
    const hits = genericHits.length ? genericHits : toolkitHits;
    if (hits.every((item) => item.endsWith(':carrier'))) return humanFailure('CARRIER_OUTSIDE_BLOCK');
    const kinds = [...new Set(hits.map((item) => item.split(':')[0]))];
    if (kinds.length !== 1) return humanFailure('MARKER_MIXED_FORMAT');
    const kind = kinds[0];
    if (expectedKind && expectedKind !== kind) return humanFailure('MARKER_WRONG_KIND');
    return humanSuccess('HUMAN_V2_BODY_CLASSIFIED', { kind, toolkit: toolkitHits.length > 0 });
  }
  if (hasReserved && !humanContainsLegacyMarker(body)) return humanFailure('RESERVED_NAMESPACE_MALFORMED');
  if (humanContainsLegacyMarker(body) && expectedKind && expectedKind === 'pr') return humanFailure('MARKER_WRONG_KIND');
  return humanSuccess('NON_HUMAN_V2_BODY', { legacy: humanContainsLegacyMarker(body) });
}
function humanSplitV2Block(body, kind, toolkit) {
  const markers = (toolkit ? HUMAN_V2_TOOLKIT_MARKERS : HUMAN_V2_MARKERS)[kind];
  const begins = humanFindTokens(body, markers.begin);
  const ends = humanFindTokens(body, markers.end);
  const carriers = humanFindTokens(body, markers.carrier);
  if (begins.length > 1 || ends.length > 1 || carriers.length > 1) {
    return humanFailure(begins.length > 1 && ends.length === 1 ? 'MARKER_NESTED' : 'MARKER_DUPLICATE');
  }
  if (begins.length !== 1 || ends.length !== 1) return humanFailure('MARKER_PARTIAL');
  const start = begins[0];
  const end = ends[0];
  if (!humanLineBoundary(body, start, markers.begin.length) || !humanLineBoundary(body, end, markers.end.length) || end < start) return humanFailure('MARKER_PARTIAL');
  if (carriers.length !== 1 || carriers[0] < start || carriers[0] > end) return humanFailure(carriers.length ? 'CARRIER_OUTSIDE_BLOCK' : 'MARKER_PARTIAL');
  const managedEnd = end + markers.end.length;
  const managed = body.slice(start, managedEnd);
  const lines = managed.split('\n');
  if (lines[0] !== markers.begin || lines[lines.length - 1] !== markers.end) return humanFailure('MARKER_PARTIAL');
  const carrierLinePattern = new RegExp('^' + markers.carrier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([A-Za-z0-9_-]+) -->$');
  const carrierIndexes = lines.map((line, index) => carrierLinePattern.test(line) ? index : -1).filter((index) => index >= 0);
  if (carrierIndexes.length !== 1) return humanFailure('CARRIER_DECODE_INVALID');
  const carrierIndex = carrierIndexes[0];
  const beginLineIndex = 0;
  const endLineIndex = lines.length - 1;
  if (carrierIndex <= beginLineIndex || carrierIndex >= endLineIndex) return humanFailure('MARKER_PARTIAL');
  const malformedCarrier = lines.some((line, index) => index !== carrierIndex && line.includes(markers.carrier));
  if (malformedCarrier) return humanFailure('CARRIER_DECODE_INVALID');
  const prefix = body.slice(0, start);
  const suffix = body.slice(managedEnd);
  if (prefix.includes('MANAGED-PROGRAM-') || prefix.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-')
    || suffix.includes('MANAGED-PROGRAM-') || suffix.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-')) return humanFailure('RESERVED_RESIDUE_OUTSIDE_BLOCK');
  return humanSuccess('HUMAN_V2_BLOCK_SPLIT', {
    kind,
    toolkit,
    markers,
    prefix,
    suffix,
    managed,
    lines,
    carrierIndex,
    encoded: lines[carrierIndex].slice(markers.carrier.length, -4),
    proseLines: lines.slice(1, carrierIndex),
    body,
  });
}
function humanValidateCarrier(value, kind, toolkit) {
  const common = kind === 'parent'
    ? ['schema', 'version', 'kind', 'repository', 'parent_issue', 'canonical', 'adapter', 'renderer', 'projection', 'public_prose_digest']
    : kind === 'child'
      ? ['schema', 'version', 'kind', 'repository', 'parent_issue', 'child_issue', 'canonical', 'adapter', 'renderer', 'projection', 'public_prose_digest']
      : ['schema', 'version', 'kind', 'repository', 'pr_number', 'number_state', 'descriptor', 'candidate', 'number_authority_digest', 'renderer', 'projection', 'public_prose_digest'];
  if (!isRecord(value) || !exactKeys(value, common) || value.version !== HUMAN_V2_VERSION || value.kind !== kind
    || !humanIsRepository(value.repository) || !humanDigest(value.public_prose_digest, 'carrier.public_prose_digest')
    || !isRecord(value.renderer) || !exactKeys(value.renderer, ['id', 'version']) || value.renderer.id !== HUMAN_V2_RENDERER_ID || value.renderer.version !== HUMAN_V2_VERSION
    || !isRecord(value.projection) || !exactKeys(value.projection, ['schema', 'digest']) || !humanDigest(value.projection.digest, 'carrier.projection.digest')) return false;
  if (kind !== 'pr' && (!isRecord(value.adapter) || !exactKeys(value.adapter, ['id', 'version']) || value.adapter.version !== HUMAN_V2_ADAPTER_VERSION
    || value.adapter.id !== (toolkit ? HUMAN_V2_TOOLKIT_ADAPTER_ID : HUMAN_V2_GENERIC_ADAPTER_ID))) return false;
  const expectedSchema = kind === 'parent' ? HUMAN_V2_PARENT_CARRIER_SCHEMA : kind === 'child' ? HUMAN_V2_CHILD_CARRIER_SCHEMA : HUMAN_V2_PR_CARRIER_SCHEMA;
  if (value.schema !== expectedSchema) return false;
  if (kind === 'parent') {
    if (!isIssue(value.parent_issue) || !isRecord(value.canonical) || !exactKeys(value.canonical, ['schema', 'class', 'digest', 'state'])
      || !humanIsSafeLine(value.canonical.schema, 512) || value.canonical.class !== HUMAN_V2_CANONICAL_CLASS || !humanDigest(value.canonical.digest, 'carrier.canonical.digest')
      || !isRecord(value.canonical.state) || value.projection.schema !== HUMAN_V2_PARENT_PROJECTION_SCHEMA) return false;
  } else if (kind === 'child') {
    if (!isIssue(value.parent_issue) || !isIssue(value.child_issue) || !isRecord(value.canonical) || !exactKeys(value.canonical, ['schema', 'class', 'digest'])
      || !humanIsSafeLine(value.canonical.schema, 512) || value.canonical.class !== HUMAN_V2_CANONICAL_CLASS || !humanDigest(value.canonical.digest, 'carrier.canonical.digest')
      || value.projection.schema !== HUMAN_V2_CHILD_PROJECTION_SCHEMA) return false;
  } else {
    if (value.pr_number !== null && !isIssue(value.pr_number)) return false;
    if (!['PRE_NUMBER', 'BOUND'].includes(value.number_state) || !isRecord(value.descriptor)
      || !exactKeys(value.descriptor, ['schema', 'digest']) || value.descriptor.schema !== HUMAN_V2_PR_DESCRIPTOR_SCHEMA
      || !humanDigest(value.descriptor.digest, 'carrier.descriptor.digest') || !isRecord(value.candidate)
      || !exactKeys(value.candidate, ['present', 'digest']) || typeof value.candidate.present !== 'boolean'
      || (value.candidate.present ? !humanDigest(value.candidate.digest, 'carrier.candidate.digest') : value.candidate.digest !== null)
      || (value.number_authority_digest !== null && !humanDigest(value.number_authority_digest, 'carrier.number_authority_digest'))
      || value.projection.schema !== HUMAN_V2_PR_PROJECTION_SCHEMA) return false;
  }
  return true;
}
function humanProseDigest(proseLines) {
  const prose = proseLines.join('\n');
  if (proseLines.length === 0 || proseLines[0] === '' || proseLines[proseLines.length - 1] === '') return humanFailure('PUBLIC_PROSE_DIGEST_MISMATCH');
  return humanDigestText(prose, 'public_prose');
}
function humanManagedResult(split, carrier, projection, state, kind) {
  const proseDigest = humanProseDigest(split.proseLines);
  if (!proseDigest.ok || carrier.public_prose_digest !== proseDigest.digest) return humanFailure('PUBLIC_PROSE_DIGEST_MISMATCH');
  return humanSuccess('HUMAN_V2_READBACK', {
    kind,
    state: state ? clone(state) : undefined,
    carrier: clone(carrier),
    carrier_digest: digestValue(carrier),
    projection: projection ? clone(projection) : undefined,
    projection_digest: projection ? digestValue(projection) : carrier.projection.digest,
    prefix: split.prefix,
    suffix: split.suffix,
    managed: split.managed,
    managed_block_bytes_digest: sha256Text(split.managed),
    complete_body_bytes_digest: sha256Text(split.body),
    public_prose_bytes_digest: proseDigest.digest,
    complete_body: split.body,
  });
}
function humanBuildManaged(kind, style, proseLines, carrier, prefix, suffix) {
  const proseDigest = humanProseDigest(proseLines);
  if (!proseDigest.ok) throw humanError(proseDigest.code, 'human prose is empty or has boundary whitespace');
  const finalCarrier = { ...carrier, public_prose_digest: proseDigest.digest };
  const encoded = humanCarrierEncoding(finalCarrier);
  const managed = [style.markers[kind].begin, ...proseLines, style.markers[kind].carrier + encoded + ' -->', style.markers[kind].end].join('\n');
  const body = prefix + managed + suffix;
  return {
    body,
    managed,
    carrier: finalCarrier,
    carrier_digest: digestValue(finalCarrier),
    public_prose_bytes_digest: proseDigest.digest,
    managed_block_bytes_digest: sha256Text(managed),
    complete_body_bytes_digest: sha256Text(body),
    prefix,
    suffix,
  };
}
function humanCell(value) { return PublicSurfaceCodec.tableCell(String(value)); }
function humanParagraph(value) { return PublicSurfaceCodec.paragraph(String(value)); }
function humanHeading(value) { return PublicSurfaceCodec.heading(String(value)); }
function humanBullet(value) { return '- ' + PublicSurfaceCodec.bullet(String(value)); }
function humanBulletList(values, empty = 'None recorded.') {
  return Array.isArray(values) && values.length ? values.map((item) => humanBullet(item)) : [empty];
}
function humanParentProse(projection) {
  const lines = [
    '# ' + humanHeading(projection.title),
    '',
    '## Current programme',
    '| Field | Value |',
    '| --- | --- |',
    '| Repository | ' + humanCell(projection.repository) + ' |',
    '| Lifecycle | ' + humanCell(projection.lifecycle) + ' |',
    '| Finality | ' + humanCell(projection.finality) + ' |',
    '| Current phase | ' + humanCell(projection.current_phase || 'None recorded') + ' |',
    '',
    '## Current child',
    '#'+String(projection.current_child.issue)+' - '+humanParagraph(projection.current_child.title),
    '',
    humanParagraph(projection.current_child.summary),
    '',
    '## Immediate next',
    humanBullet(projection.next_action.text),
    '',
    '## Work packages',
    '| Order | Status | Issue | Title | Purpose |',
    '| --- | --- | --- | --- | --- |',
    ...projection.work_packages.map((item) => '| ' + humanCell(item.order) + ' | ' + humanCell(item.lifecycle) + ' | #' + humanCell(item.issue) + ' | ' + humanCell(item.title) + ' | ' + humanCell(item.purpose) + ' |'),
    '',
    '## Completed work',
    ...humanBulletList(projection.completed_work.map((item) => '#' + String(item.issue) + ' - ' + item.summary)),
    '',
    '## Boundaries',
    ...humanBulletList(projection.boundaries.map((item) => '[' + item.category + '] ' + item.text)),
  ];
  return lines;
}
function humanChildProse(projection, includeEli5 = true) {
  const lines = [
    '# ' + humanHeading(projection.title),
    '',
    '## Status / Summary',
    '| Field | Value |',
    '| --- | --- |',
    '| Parent | #' + humanCell(projection.parent_issue) + ' |',
    '| Child | #' + humanCell(projection.child_issue) + ' |',
    '| Lifecycle | ' + humanCell(projection.lifecycle) + ' |',
    '| Finality | ' + humanCell(projection.finality) + ' |',
    '',
    humanParagraph(projection.summary),
    '',
    '## Objective',
    humanParagraph(projection.objective),
    '',
    '## Scope / Boundaries / Completion',
    '### In scope',
    ...humanBulletList(projection.scope),
    '### Boundaries',
    ...humanBulletList(projection.boundaries.map((item) => '[' + item.category + '] ' + item.text)),
    '### Completion shape',
    ...humanBulletList(projection.done_when),
    '### Out of scope',
    ...humanBulletList(projection.out_of_scope),
    '',
    '## Epochs / phases',
    '| Epoch | Name | State | Purpose | Outcome |',
    '| --- | --- | --- | --- | --- |',
    ...projection.epochs.map((epoch) => '| ' + humanCell(epoch.id) + ' | ' + humanCell(epoch.name) + ' | ' + humanCell(epoch.state) + ' | ' + humanCell(epoch.purpose) + ' | ' + humanCell(epoch.outcome) + ' |'),
    '',
    '## PR history',
    '| PR | Epoch | Outcome | What it was for | Why |',
    '| --- | --- | --- | --- | --- |',
    ...(projection.pr_history.length ? projection.pr_history.map((entry) => '| #' + humanCell(entry.pr) + ' | ' + humanCell(entry.epoch_id) + ' | ' + humanCell(entry.outcome) + ' | ' + humanCell(entry.what_it_was_for) + ' | ' + humanCell(entry.why) + ' |') : ['| None | - | None recorded | - | - |']),
    '',
    '## Immediate next',
    humanBullet(projection.next_action.text),
  ];
  if (includeEli5) lines.push('', '## ELI5', humanParagraph(projection.eli5));
  return lines;
}
function humanRenderFromManaged(result, projection, state, kind) {
  return humanSuccess('HUMAN_V2_RENDER_READY', {
    kind,
    body: result.body,
    state: clone(state),
    canonical_digest: digestValue(state),
    projection: clone(projection),
    projection_digest: digestValue(projection),
    carrier: clone(result.carrier),
    carrier_digest: result.carrier_digest,
    prefix: result.prefix,
    suffix: result.suffix,
    managed: result.managed,
    managed_block_bytes_digest: result.managed_block_bytes_digest,
    complete_body_bytes_digest: result.complete_body_bytes_digest,
    public_prose_bytes_digest: result.public_prose_bytes_digest,
  });
}
function renderHumanV2Parent(canonicalState, options = {}) {
  const valid = validateHumanCanonicalState(canonicalState);
  if (!valid.ok) return valid;
  try {
    const style = humanMarkerStyle({ ...options, toolkit: options.toolkit === undefined && valid.adapter_id === HUMAN_V2_TOOLKIT_ADAPTER_ID ? true : options.toolkit });
    const projectionResult = humanBuildProjection(valid.state, 'parent', options);
    if (!projectionResult.ok) return projectionResult;
    const outside = humanPrefixSuffix(options);
    const lines = humanParentProse(projectionResult.projection);
    const carrier = {
      schema: HUMAN_V2_PARENT_CARRIER_SCHEMA,
      version: HUMAN_V2_VERSION,
      kind: 'parent',
      repository: valid.state.repository,
      parent_issue: valid.state.parent.issue,
      canonical: { schema: valid.state.schema, class: HUMAN_V2_CANONICAL_CLASS, digest: valid.canonical_digest, state: clone(valid.state) },
      adapter: { id: style.toolkit ? HUMAN_V2_TOOLKIT_ADAPTER_ID : HUMAN_V2_GENERIC_ADAPTER_ID, version: HUMAN_V2_ADAPTER_VERSION },
      renderer: { id: HUMAN_V2_RENDERER_ID, version: HUMAN_V2_VERSION },
      projection: { schema: HUMAN_V2_PARENT_PROJECTION_SCHEMA, digest: projectionResult.projection_digest },
      public_prose_digest: null,
    };
    const result = humanBuildManaged('parent', style, lines, carrier, outside.prefix, outside.suffix);
    return humanRenderFromManaged(result, projectionResult.projection, valid.state, 'parent');
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_V2_RENDER_INVALID', { reason: error.message });
  }
}
function renderHumanV2Child(canonicalState, childIssue, options = {}) {
  const selectionGuard = humanChildSelectionGuard(canonicalState, childIssue);
  if (selectionGuard) return selectionGuard;
  const valid = validateHumanCanonicalState(canonicalState);
  if (!valid.ok) return valid;
  try {
    const selected = humanSelectChildFromState(valid.state, childIssue);
    const effectiveOptions = { ...options, child_issue: selected.issue };
    const style = humanMarkerStyle({ ...effectiveOptions, toolkit: options.toolkit === undefined && valid.adapter_id === HUMAN_V2_TOOLKIT_ADAPTER_ID ? true : options.toolkit });
    const projectionResult = humanBuildProjection(valid.state, 'child', effectiveOptions);
    if (!projectionResult.ok) return projectionResult;
    const outside = humanPrefixSuffix(options);
    const lines = humanChildProse(projectionResult.projection, options.include_eli5 !== false);
    const carrier = {
      schema: HUMAN_V2_CHILD_CARRIER_SCHEMA,
      version: HUMAN_V2_VERSION,
      kind: 'child',
      repository: valid.state.repository,
      parent_issue: valid.state.parent.issue,
      child_issue: selected.issue,
      canonical: { schema: valid.state.schema, class: HUMAN_V2_CANONICAL_CLASS, digest: valid.canonical_digest },
      adapter: { id: style.toolkit ? HUMAN_V2_TOOLKIT_ADAPTER_ID : HUMAN_V2_GENERIC_ADAPTER_ID, version: HUMAN_V2_ADAPTER_VERSION },
      renderer: { id: HUMAN_V2_RENDERER_ID, version: HUMAN_V2_VERSION },
      projection: { schema: HUMAN_V2_CHILD_PROJECTION_SCHEMA, digest: projectionResult.projection_digest },
      public_prose_digest: null,
    };
    const result = humanBuildManaged('child', style, lines, carrier, outside.prefix, outside.suffix);
    return humanRenderFromManaged(result, projectionResult.projection, valid.state, 'child');
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_V2_RENDER_INVALID', { reason: error.message });
  }
}
function humanAuthorityComplete(value) {
  return isRecord(value) && value.complete === true
    && (!humanOwn(value, 'pr_number') || isIssue(value.pr_number))
    && (!humanOwn(value, 'authority_digest') || isDigest(value.authority_digest))
    && (!humanOwn(value, 'source') || humanIsSafeLine(value.source, 1024));
}
function humanNormalizePrDescriptor(value, allowPreNumber = true) {
  if (!isRecord(value) || !humanValidateGenericDescriptor(value, 'descriptor', allowPreNumber)) throw humanError('HUMAN_PR_DESCRIPTOR_INVALID', 'descriptor is not complete');
  const result = clone(value);
  if (humanOwn(result, 'schema') && result.schema !== HUMAN_V2_PR_DESCRIPTOR_SCHEMA) throw humanError('HUMAN_PR_DESCRIPTOR_INVALID', 'descriptor schema is not human-v2');
  if (result.number === null && !allowPreNumber) throw humanError('HUMAN_PR_DESCRIPTOR_INVALID', 'descriptor number is required');
  if (result.candidate !== undefined && result.candidate !== null) result.candidate = humanCandidate(result.candidate, 'descriptor.candidate', false);
  if (result.number_authority !== undefined && result.number_authority !== null) {
    if (!humanAuthorityComplete(result.number_authority)) throw humanError('HUMAN_PR_NUMBER_AUTHORITY_INVALID', 'number authority is incomplete');
    result.number_authority = clone(result.number_authority);
  }
  return result;
}
function humanDescriptorDigest(descriptor, authority) {
  const value = clone(descriptor);
  value.number_authority = authority === undefined ? (value.number_authority ?? null) : authority;
  const result = humanDigestValue(value, 'pr_descriptor');
  if (!result.ok) throw humanError(result.code, 'descriptor digest cannot be computed');
  return result.digest;
}
function humanCandidateDigest(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const result = humanDigestValue(candidate, 'candidate');
  if (!result.ok) throw humanError(result.code, 'candidate digest cannot be computed');
  return result.digest;
}
function humanPrNumberBinding(descriptor, options = {}) {
  const requestedState = options.number_state || options.phase || (descriptor.number === null ? 'PRE_NUMBER' : 'BOUND');
  const numberState = String(requestedState).toUpperCase().replace('-', '_');
  const authority = options.number_authority !== undefined ? options.number_authority : (descriptor.number_authority ?? null);
  if (numberState === 'PRE_NUMBER') {
    if (descriptor.number !== null || (authority !== null && authority !== undefined)) throw humanError('HUMAN_PR_NUMBER_STATE_INVALID', 'PRE_NUMBER requires a null descriptor number and null number authority');
    return { number_state: 'PRE_NUMBER', pr_number: null, authority: null, authority_digest: null };
  }
  if (numberState !== 'BOUND' || !isIssue(descriptor.number) || !humanAuthorityComplete(authority)
    || authority.pr_number !== descriptor.number) throw humanError('PR_NUMBER_AUTHORITY_REQUIRED', 'BOUND requires complete controller authority for the exact number');
  if (descriptor.number_authority !== undefined && descriptor.number_authority !== null && !same(descriptor.number_authority, authority)) throw humanError('PR_NUMBER_AUTHORITY_REQUIRED', 'descriptor authority and bound authority must match');
  const authorityDigest = humanDigestValue(authority, 'number_authority');
  if (!authorityDigest.ok) throw humanError(authorityDigest.code, 'number authority digest cannot be computed');
  return { number_state: 'BOUND', pr_number: descriptor.number, authority: clone(authority), authority_digest: authorityDigest.digest };
}
function humanPrProjection(descriptor, numberBinding, candidate) {
  return {
    schema: HUMAN_V2_PR_PROJECTION_SCHEMA,
    version: HUMAN_V2_VERSION,
    kind: 'pr',
    repository: descriptor.repository || null,
    pr_number: numberBinding.pr_number,
    number_state: numberBinding.number_state,
    child_issue: descriptor.child_issue,
    summary: descriptor.summary,
    purpose: descriptor.purpose,
    position: descriptor.position || null,
    candidate_digest: humanCandidateDigest(candidate),
    optional_sections: Object.fromEntries(['repair_history', 'before_after', 'repair_budget', 'hosted_qualification', 'recovery_evidence'].map((key) => [key, Boolean(descriptor.applicability?.[key] || descriptor.optional?.[key])])),
  };
}
function humanOptionalLines(descriptor, key, heading) {
  const enabled = Boolean(descriptor.applicability?.[key] || descriptor.optional?.[key]);
  if (!enabled || !Array.isArray(descriptor[key]) || descriptor[key].length === 0) return [];
  return ['', '## ' + heading, ...humanBulletList(descriptor[key])];
}
function humanPrProse(descriptor, numberBinding, candidate) {
  const position = isRecord(descriptor.position) ? descriptor.position : {};
  const next = numberBinding.number_state === 'BOUND'
    ? 'Continue only under the bound controller authority.'
    : (descriptor.next_action || 'Return the exact PRE_NUMBER body for controller adjudication.');
  const candidateLines = candidate
    ? [
      '| Repository | ' + humanCell(candidate.repository) + ' |',
      '| Branch | ' + humanCell(candidate.branch) + ' |',
      '| Base ref | ' + humanCell(candidate.base_ref) + ' |',
      '| Base SHA | ' + humanCell(candidate.base_sha) + ' |',
      '| Head | ' + humanCell(candidate.head) + ' |',
      '| Tree | ' + humanCell(candidate.tree) + ' |',
      '| Version | ' + humanCell(candidate.version) + ' |',
    ]
    : ['None recorded.'];
  const lines = [
    '## Summary',
    humanParagraph(descriptor.summary),
    '',
    '## Programme position',
    '| Field | Value |',
    '| --- | --- |',
    '| Parent | ' + humanCell(position.parent ?? 'Not supplied') + ' |',
    '| Child | #' + humanCell(descriptor.child_issue) + ' |',
    '| Epoch | ' + humanCell(position.epoch ?? 'Not supplied') + ' |',
    '| Gate | ' + humanCell(position.gate ?? 'Not supplied') + ' |',
    '| Role | ' + humanCell(position.role ?? 'INTERMEDIATE') + ' |',
    '| Completes child | ' + humanCell(position.completes_child ?? false) + ' |',
    '| PR number | ' + (numberBinding.pr_number === null ? 'pending provider assignment' : '#' + humanCell(numberBinding.pr_number)) + ' |',
    '',
    '## What changed',
    ...humanBulletList(descriptor.changed_surfaces),
    '',
    '## Why',
    humanParagraph(descriptor.purpose),
    '',
    '## Scope',
    ...humanBulletList(descriptor.scope),
    '',
    '## Out of scope',
    ...humanBulletList(descriptor.out_of_scope),
    '',
    '## Validation',
    ...humanBulletList(descriptor.validation_requirements),
    '',
    '## Candidate / lineage',
    '| Field | Value |',
    '| --- | --- |',
    '| Candidate present | ' + humanCell(Boolean(candidate)) + ' |',
    ...candidateLines,
    '',
    '## Final status / what happens next',
    humanBullet('Number state: ' + numberBinding.number_state + '.'),
    humanBullet(next),
  ];
  lines.push(...humanOptionalLines(descriptor, 'repair_history', 'Repair history'));
  lines.push(...humanOptionalLines(descriptor, 'before_after', 'Before / after'));
  lines.push(...humanOptionalLines(descriptor, 'repair_budget', 'Repair budget'));
  lines.push(...humanOptionalLines(descriptor, 'hosted_qualification', 'Hosted qualification'));
  lines.push(...humanOptionalLines(descriptor, 'recovery_evidence', 'Recovery-specific evidence'));
  if (descriptor.eli5) lines.push('', '## ELI5', humanParagraph(descriptor.eli5));
  return lines;
}
function renderHumanV2Pr(descriptor, options = {}) {
  try {
    const normalized = humanNormalizePrDescriptor(descriptor, true);
    const numberBinding = humanPrNumberBinding(normalized, options);
    const candidate = normalized.candidate === undefined ? null : normalized.candidate;
    const style = humanMarkerStyle(options);
    const outside = humanPrefixSuffix(options);
    const descriptorDigest = humanDescriptorDigest(normalized, numberBinding.authority);
    const projection = humanPrProjection(normalized, numberBinding, candidate);
    const projectionDigest = digestValue(projection);
    const lines = humanPrProse(normalized, numberBinding, candidate);
    const carrier = {
      schema: HUMAN_V2_PR_CARRIER_SCHEMA,
      version: HUMAN_V2_VERSION,
      kind: 'pr',
      repository: normalized.repository || options.repository || null,
      pr_number: numberBinding.pr_number,
      number_state: numberBinding.number_state,
      descriptor: { schema: HUMAN_V2_PR_DESCRIPTOR_SCHEMA, digest: descriptorDigest },
      candidate: { present: candidate !== null, digest: humanCandidateDigest(candidate) },
      number_authority_digest: numberBinding.authority_digest,
      renderer: { id: HUMAN_V2_RENDERER_ID, version: HUMAN_V2_VERSION },
      projection: { schema: HUMAN_V2_PR_PROJECTION_SCHEMA, digest: projectionDigest },
      public_prose_digest: null,
    };
    if (!humanIsRepository(carrier.repository)) throw humanError('HUMAN_PR_DESCRIPTOR_INVALID', 'repository is required for PR presentation');
    const result = humanBuildManaged('pr', style, lines, carrier, outside.prefix, outside.suffix);
    return humanSuccess('HUMAN_V2_PR_RENDER_READY', {
      kind: 'pr',
      body: result.body,
      descriptor: clone(normalized),
      descriptor_digest: descriptorDigest,
      number_state: numberBinding.number_state,
      pr_number: numberBinding.pr_number,
      number_authority: numberBinding.authority,
      number_authority_digest: numberBinding.authority_digest,
      candidate: candidate ? clone(candidate) : null,
      candidate_digest: humanCandidateDigest(candidate),
      projection: clone(projection),
      projection_digest: projectionDigest,
      carrier: clone(result.carrier),
      carrier_digest: result.carrier_digest,
      prefix: result.prefix,
      suffix: result.suffix,
      managed: result.managed,
      managed_block_bytes_digest: result.managed_block_bytes_digest,
      complete_body_bytes_digest: result.complete_body_bytes_digest,
      public_prose_bytes_digest: result.public_prose_bytes_digest,
    });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_V2_PR_RENDER_INVALID', { reason: error.message });
  }
}
function humanCompleteRead(input) {
  if (typeof input === 'string') return humanSuccess('BODY_READ_COMPLETE', { body: input });
  if (!isRecord(input)) return humanFailure('BODY_NOT_STRING');
  const body = input.body === undefined ? input.raw_body : input.body;
  if (typeof body !== 'string') return humanFailure('BODY_NOT_STRING');
  if (humanOwn(input, 'complete') && input.complete !== true) return humanFailure('BODY_READ_INCOMPLETE');
  if (humanOwn(input, 'read_complete') && input.read_complete !== true) return humanFailure('BODY_READ_INCOMPLETE');
  if (humanHasMalformedUnicode(body)) return humanFailure('BODY_BYTES_INVALID');
  return humanSuccess('BODY_READ_COMPLETE', { body });
}
function humanParseBlockCarrier(completeRead, kind, expectedIdentity) {
  const complete = humanCompleteRead(completeRead);
  if (!complete.ok) return complete;
  const classification = humanReservedClassification(complete.body, kind);
  if (!classification.ok) return classification;
  if (classification.code !== 'HUMAN_V2_BODY_CLASSIFIED') return humanFailure('MARKER_PARTIAL');
  const split = humanSplitV2Block(complete.body, kind, classification.toolkit);
  if (!split.ok) return split;
  const decoded = humanCarrierDecoding(split.encoded);
  if (!decoded.ok) return decoded;
  const carrier = decoded.carrier;
  if (!humanValidateCarrier(carrier, kind, classification.toolkit)) return humanFailure('CARRIER_SCHEMA_INVALID');
  if (expectedIdentity && isRecord(expectedIdentity)) {
    const identity = {
      repository: carrier.repository,
      parent_issue: carrier.parent_issue,
      child_issue: carrier.child_issue,
      schema: kind === 'parent' ? carrier.canonical.schema : carrier.canonical?.schema,
      class: carrier.canonical?.class,
      canonical_digest: carrier.canonical?.digest,
    };
    for (const key of ['repository', 'parent_issue', 'child_issue', 'schema', 'class', 'canonical_digest']) {
      if (expectedIdentity[key] !== undefined && expectedIdentity[key] !== identity[key]) return humanFailure('HUMAN_IDENTITY_MISMATCH', { field: key });
    }
    if (expectedIdentity.canonical_state && !same(expectedIdentity.canonical_state, carrier.canonical?.state)) return humanFailure('CANONICAL_DIGEST_MISMATCH');
  }
  return humanSuccess('HUMAN_V2_CARRIER_READ', { complete: complete.body, split, carrier, style: classification.toolkit ? 'toolkit' : 'generic' });
}
function humanDeterministicCompare(readback, rendered) {
  if (rendered.body !== readback.complete) return humanFailure('DETERMINISTIC_BYTES_MISMATCH');
  if (!same(rendered.carrier, readback.carrier)) return humanFailure('CARRIER_DIGEST_MISMATCH');
  return humanSuccess('DETERMINISTIC_BYTES_EQUAL');
}
function parseHumanV2Parent(completeRead, expectedIdentity = {}) {
  const parsed = humanParseBlockCarrier(completeRead, 'parent', expectedIdentity);
  if (!parsed.ok) return parsed;
  const carrier = parsed.carrier;
  const stateValid = validateHumanCanonicalState(carrier.canonical.state);
  if (!stateValid.ok) return humanFailure('CANONICAL_STATE_INVALID', { reason: stateValid.code });
  if (carrier.canonical.schema !== stateValid.state.schema || carrier.canonical.digest !== stateValid.canonical_digest
    || carrier.parent_issue !== stateValid.state.parent.issue) return humanFailure('CANONICAL_DIGEST_MISMATCH');
  const projectionResult = humanBuildProjection(stateValid.state, 'parent', {});
  if (!projectionResult.ok) return projectionResult;
  if (carrier.projection.digest !== projectionResult.projection_digest) return humanFailure('PROJECTION_DIGEST_MISMATCH');
  const verified = humanManagedResult(parsed.split, carrier, projectionResult.projection, stateValid.state, 'parent');
  if (!verified.ok) return verified;
  const rendered = renderHumanV2Parent(stateValid.state, {
    markers: parsed.style === 'toolkit' ? HUMAN_V2_TOOLKIT_MARKERS : HUMAN_V2_MARKERS,
    toolkit: parsed.style === 'toolkit',
    prefix: parsed.split.prefix,
    suffix: parsed.split.suffix,
  });
  if (!rendered.ok) return rendered;
  const deterministic = humanDeterministicCompare(parsed, rendered);
  if (!deterministic.ok) return deterministic;
  return humanSuccess('HUMAN_V2_PARENT_VALID', {
    ...verified,
    canonical_digest: stateValid.canonical_digest,
    state: clone(stateValid.state),
    projection: clone(projectionResult.projection),
    projection_digest: projectionResult.projection_digest,
  });
}
function parseHumanV2Child(completeRead, expectedIdentity = {}) {
  const parsed = humanParseBlockCarrier(completeRead, 'child', expectedIdentity);
  if (!parsed.ok) return parsed;
  const carrier = parsed.carrier;
  if (expectedIdentity.canonical_digest !== undefined && carrier.canonical.digest !== expectedIdentity.canonical_digest) return humanFailure('CANONICAL_DIGEST_MISMATCH');
  const verified = humanManagedResult(parsed.split, carrier, null, null, 'child');
  if (!verified.ok) return verified;
  return humanSuccess('HUMAN_V2_CHILD_CARRIER_VALID', { ...verified, child_issue: carrier.child_issue, canonical_digest: carrier.canonical.digest });
}
function verifyHumanV2Child(completeRead, canonicalState, childIssue, options = {}) {
  const selectionGuard = humanChildSelectionGuard(canonicalState, childIssue);
  if (selectionGuard) return selectionGuard;
  const valid = validateHumanCanonicalState(canonicalState);
  if (!valid.ok) return valid;
  let selected;
  try { selected = humanSelectChildFromState(valid.state, childIssue); } catch (error) { return humanFailure(error.code || 'CHILD_NOT_FOUND', { reason: error.message }); }
  const parsed = humanParseBlockCarrier(completeRead, 'child', {
    repository: valid.state.repository,
    parent_issue: valid.state.parent.issue,
    child_issue: selected.issue,
    schema: valid.state.schema,
    class: HUMAN_V2_CANONICAL_CLASS,
    canonical_digest: valid.canonical_digest,
  });
  if (!parsed.ok) return parsed;
  const carrier = parsed.carrier;
  if (carrier.canonical.digest !== valid.canonical_digest) return humanFailure('CANONICAL_DIGEST_MISMATCH');
  const projectionResult = humanBuildProjection(valid.state, 'child', { child_issue: selected.issue });
  if (!projectionResult.ok) return projectionResult;
  if (carrier.projection.digest !== projectionResult.projection_digest) return humanFailure('PROJECTION_DIGEST_MISMATCH');
  const verified = humanManagedResult(parsed.split, carrier, projectionResult.projection, valid.state, 'child');
  if (!verified.ok) return verified;
  const rendered = renderHumanV2Child(valid.state, selected.issue, {
    ...options,
    markers: parsed.style === 'toolkit' ? HUMAN_V2_TOOLKIT_MARKERS : HUMAN_V2_MARKERS,
    toolkit: parsed.style === 'toolkit',
    prefix: parsed.split.prefix,
    suffix: parsed.split.suffix,
  });
  if (!rendered.ok) return rendered;
  const deterministic = humanDeterministicCompare(parsed, rendered);
  if (!deterministic.ok) return deterministic;
  return humanSuccess('HUMAN_V2_CHILD_VALID', {
    ...verified,
    state: clone(valid.state),
    canonical_digest: valid.canonical_digest,
    projection: clone(projectionResult.projection),
    projection_digest: projectionResult.projection_digest,
    child_issue: selected.issue,
  });
}
function humanParsePrCarrier(completeRead, expectedIdentity = {}) {
  const parsed = humanParseBlockCarrier(completeRead, 'pr', expectedIdentity);
  if (!parsed.ok) return parsed;
  const carrier = parsed.carrier;
  const verified = humanManagedResult(parsed.split, carrier, null, null, 'pr');
  if (!verified.ok) return verified;
  return humanSuccess('HUMAN_V2_PR_CARRIER_READ', { ...verified, complete: parsed.complete, split: parsed.split, style: parsed.style, number_state: carrier.number_state, pr_number: carrier.pr_number });
}
function verifyHumanV2Pr(completeRead, descriptor, options = {}) {
  try {
    const normalized = humanNormalizePrDescriptor(descriptor, true);
    const binding = humanPrNumberBinding(normalized, options);
    const expectedRepository = normalized.repository || options.repository;
    const parsed = humanParsePrCarrier(completeRead, expectedRepository ? { repository: expectedRepository } : {});
    if (!parsed.ok) return parsed;
    const carrier = parsed.carrier;
    if (carrier.number_state !== binding.number_state || carrier.pr_number !== binding.pr_number) return humanFailure('PR_NUMBER_BINDING_MISMATCH');
    const descriptorDigest = humanDescriptorDigest(normalized, binding.authority);
    if (carrier.descriptor.digest !== descriptorDigest) return humanFailure('DESCRIPTOR_DIGEST_MISMATCH');
    const candidate = normalized.candidate === undefined ? null : normalized.candidate;
    if (carrier.candidate.present !== (candidate !== null) || carrier.candidate.digest !== humanCandidateDigest(candidate)) return humanFailure('CANDIDATE_DIGEST_MISMATCH');
    if (carrier.number_authority_digest !== binding.authority_digest) return humanFailure('PR_NUMBER_AUTHORITY_MISMATCH');
    const projection = humanPrProjection(normalized, binding, candidate);
    const projectionDigest = digestValue(projection);
    if (carrier.projection.digest !== projectionDigest) return humanFailure('PROJECTION_DIGEST_MISMATCH');
    const verified = humanManagedResult(parsed.split, carrier, projection, null, 'pr');
    if (!verified.ok) return verified;
    const rendered = renderHumanV2Pr(normalized, {
      ...options,
      number_state: binding.number_state,
      number_authority: binding.authority,
      markers: parsed.style === 'toolkit' ? HUMAN_V2_TOOLKIT_MARKERS : HUMAN_V2_MARKERS,
      toolkit: parsed.style === 'toolkit',
      prefix: parsed.split.prefix,
      suffix: parsed.split.suffix,
    });
    if (!rendered.ok) return rendered;
    const deterministic = humanDeterministicCompare(parsed, rendered);
    if (!deterministic.ok) return deterministic;
    return humanSuccess('HUMAN_V2_PR_VALID', {
      ...verified,
      descriptor: clone(normalized),
      descriptor_digest: descriptorDigest,
      number_state: binding.number_state,
      pr_number: binding.pr_number,
      candidate: candidate ? clone(candidate) : null,
      projection: clone(projection),
      projection_digest: projectionDigest,
    });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_V2_PR_INVALID', { reason: error.message });
  }
}
function parseProgrammeBodyComplete(completeRead, context = {}) {
  const complete = humanCompleteRead(completeRead);
  if (!complete.ok) return complete;
  const classification = humanReservedClassification(complete.body, context.kind);
  if (!classification.ok) return classification;
  if (classification.code === 'HUMAN_V2_BODY_CLASSIFIED') {
    if (classification.kind === 'parent') return parseHumanV2Parent(complete, context.expectedIdentity || context);
    if (classification.kind === 'child') {
      if (context.canonical_state || context.state) return verifyHumanV2Child(complete, context.canonical_state || context.state, context.child_issue, context);
      return parseHumanV2Child(complete, context.expectedIdentity || context);
    }
    if (!context.descriptor && !context.pr_descriptor) return humanFailure('PR_DESCRIPTOR_REQUIRED');
    return verifyHumanV2Pr(complete, context.descriptor || context.pr_descriptor, context);
  }
  if (!classification.legacy) return humanFailure('MARKER_PARTIAL');
  const kind = context.kind || (complete.body.includes(MANAGED_MARKERS.parent.begin) ? 'parent' : complete.body.includes(MANAGED_MARKERS.child.begin) ? 'child' : null);
  if (kind === 'parent') return parseParentV5Body(complete.body, { ...context, complete: true });
  if (kind === 'child') return parseChildV5Body(complete.body, { ...context, complete: true });
  return humanFailure('MARKER_WRONG_KIND');
}
function selectChildIssue(canonicalState, optionalChildIssue) {
  const selectionGuard = humanChildSelectionGuard(canonicalState, optionalChildIssue);
  if (selectionGuard) return selectionGuard;
  const valid = validateHumanCanonicalState(canonicalState);
  if (!valid.ok) return valid;
  try {
    const child = humanSelectChildFromState(valid.state, optionalChildIssue);
    return humanSuccess('CHILD_SELECTED', { child_issue: child.issue, child: clone(child), canonical_digest: valid.canonical_digest });
  } catch (error) {
    return humanFailure(error.code || 'CHILD_SELECTION_AMBIGUOUS', { reason: error.message });
  }
}
function humanHistoryImmutableDigest(state) {
  const copy = clone(state);
  copy.prs = [];
  copy.evidence_refs = [];
  copy.historical_transitions = [];
  copy.children = (copy.children || []).map((child) => ({ ...child, pr_registry: [] }));
  const result = humanDigestValue(copy, 'history_immutable_state');
  if (!result.ok) throw humanError(result.code, 'immutable history digest cannot be computed');
  return result.digest;
}
function humanHistoryDescriptor(value, field = 'history_additions.prs[]') {
  const normalized = humanNormalizePrDescriptor(value, false);
  if (!humanIsSafeLine(normalized.purpose) || !humanIsSafeLine(normalized.summary)) throw humanError('HUMAN_HISTORY_DESCRIPTOR_INVALID', field);
  return normalized;
}
function humanHistoryEvidenceRef(value, field = 'history_additions.evidence_refs[]') {
  if (!humanValidateGenericEvidence(value, field)) throw humanError('HUMAN_HISTORY_EVIDENCE_REF_INVALID', field);
  return clone(value);
}
function humanHistoryTransition(value, field = 'history_additions.historical_transitions[]') {
  if (!isRecord(value) || !exactKeys(value, ['child_issue', 'disposition', 'epoch_id', 'evidence_ref', 'gate', 'id'])
    || !isIssue(value.child_issue) || !isSafeId(value.disposition, 256) || !isSafeId(value.epoch_id, 512)
    || !isSafeId(value.evidence_ref, 512) || !isSafeId(value.gate, 256) || !isSafeId(value.id, 512)) throw humanError('HUMAN_HISTORY_TRANSITION_INVALID', field);
  return clone(value);
}
function humanHistoryRegistry(value, field = 'history_additions.registry[].entry') {
  if (!humanValidateGenericRegistry(value, field)) throw humanError('HUMAN_HISTORY_REGISTRY_INVALID', field);
  return clone(value);
}
function humanHistoryCandidateIdentity(value, field = 'accepted_candidate_identities[]') {
  if (!isRecord(value) || !hasOnly(value, ['pr_number', 'candidate'], ['child_issue', 'epoch_id']) || !isIssue(value.pr_number)) throw humanError('HUMAN_HISTORY_CANDIDATE_INVALID', field);
  const candidate = humanCandidate(value.candidate, field + '.candidate', false);
  const result = { pr_number: value.pr_number, candidate };
  if (humanOwn(value, 'child_issue')) result.child_issue = humanIssue(value.child_issue, field + '.child_issue');
  if (humanOwn(value, 'epoch_id')) {
    if (!isSafeId(value.epoch_id, 512)) throw humanError('HUMAN_HISTORY_CANDIDATE_INVALID', field + '.epoch_id');
    result.epoch_id = value.epoch_id;
  }
  return result;
}
function humanHistoryCandidateBindings(additions, accepted, repository = null) {
  const descriptors = new Map();
  const registries = new Map();
  for (const descriptor of additions.prs) {
    if (descriptors.has(descriptor.number)) throw humanError('HUMAN_HISTORY_DUPLICATE_PR', '#' + String(descriptor.number));
    descriptors.set(descriptor.number, descriptor);
    if (descriptor.candidate !== undefined && descriptor.candidate !== null) descriptors.get(descriptor.number).candidate = humanCandidate(descriptor.candidate, 'descriptor.candidate', false);
  }
  for (const item of additions.registry) {
    const key = String(item.child_issue) + ':' + String(item.entry.pr);
    if (registries.has(key)) throw humanError('HUMAN_HISTORY_DUPLICATE_REGISTRY', key);
    registries.set(key, item);
  }
  const expected = new Map();
  const record = (pr, candidate, childIssue, epochId) => {
    if (expected.has(pr) && (!same(expected.get(pr).candidate, candidate) || expected.get(pr).child_issue !== childIssue || expected.get(pr).epoch_id !== epochId)) throw humanError('HUMAN_HISTORY_CANDIDATE_MISMATCH', '#' + String(pr));
    expected.set(pr, { pr_number: pr, candidate: clone(candidate), child_issue: childIssue, epoch_id: epochId });
  };
  for (const descriptor of descriptors.values()) {
    if (descriptor.candidate !== undefined && descriptor.candidate !== null) {
      const registry = [...registries.values()].find((item) => item.entry.pr === descriptor.number);
      if (!registry || registry.child_issue !== descriptor.child_issue || registry.entry.candidate === undefined || registry.entry.candidate === null) throw humanError('HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH', '#' + String(descriptor.number));
      record(descriptor.number, descriptor.candidate, descriptor.child_issue, registry.entry.epoch_id);
    }
  }
  for (const item of registries.values()) {
    if (item.entry.candidate !== undefined && item.entry.candidate !== null) {
      const descriptor = descriptors.get(item.entry.pr);
      if (!descriptor || descriptor.candidate === undefined || descriptor.candidate === null || descriptor.child_issue !== item.child_issue) throw humanError('HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH', '#' + String(item.entry.pr));
      record(item.entry.pr, item.entry.candidate, item.child_issue, item.entry.epoch_id);
    }
  }
  const identities = new Map();
  for (const value of accepted) {
    const identity = humanHistoryCandidateIdentity(value);
    if (identities.has(identity.pr_number)) throw humanError('HUMAN_HISTORY_CANDIDATE_INVALID', '#' + String(identity.pr_number));
    identities.set(identity.pr_number, identity);
  }
  if (identities.size !== expected.size || [...expected.keys()].some((pr) => !identities.has(pr))) throw humanError('HUMAN_HISTORY_CANDIDATE_SET_MISMATCH', 'candidate identity set is not exact');
  for (const [pr, expectedIdentity] of expected) {
    const identity = identities.get(pr);
    if ((repository !== null && expectedIdentity.candidate.repository !== repository)
      || !same(identity.candidate, expectedIdentity.candidate)
      || identity.child_issue !== expectedIdentity.child_issue
      || identity.epoch_id !== expectedIdentity.epoch_id) throw humanError('HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH', '#' + String(pr));
  }
  return { descriptors, registries, expected, identities };
}
function humanHistoryAdditions(value, acceptedCandidateIdentities = [], repository = null) {
  if (!isRecord(value) || !exactKeys(value, ['prs', 'registry', 'evidence_refs', 'historical_transitions'])
    || !Array.isArray(value.prs) || !Array.isArray(value.registry) || !Array.isArray(value.evidence_refs) || !Array.isArray(value.historical_transitions)) throw humanError('HUMAN_HISTORY_ADDITIONS_INVALID', 'history additions must be complete');
  const result = {
    prs: value.prs.map((item, index) => humanHistoryDescriptor(item, 'history_additions.prs[' + String(index) + ']')),
    registry: value.registry.map((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ['child_issue', 'entry']) || !isIssue(item.child_issue)) throw humanError('HUMAN_HISTORY_REGISTRY_INVALID', 'registry[' + String(index) + ']');
      return { child_issue: item.child_issue, entry: humanHistoryRegistry(item.entry, 'history_additions.registry[' + String(index) + '].entry') };
    }),
    evidence_refs: value.evidence_refs.map((item, index) => humanHistoryEvidenceRef(item, 'history_additions.evidence_refs[' + String(index) + ']')),
    historical_transitions: value.historical_transitions.map((item, index) => humanHistoryTransition(item, 'history_additions.historical_transitions[' + String(index) + ']')),
  };
  humanHistoryCandidateBindings(result, acceptedCandidateIdentities, repository);
  return result;
}
function validateHumanSurfaceConformanceDecision(value, context = {}) {
  const keys = ['schema', 'root', 'lock', 'repository', 'source', 'authority', 'history_additions', 'accepted_candidate_identities', 'invariants'];
  try {
    if (!isRecord(value) || !exactKeys(value, keys) || value.schema !== HUMAN_V2_HISTORY_DECISION_SCHEMA
      || !isSafeId(value.root, 512) || !isSafeId(value.lock, 512) || !humanIsRepository(value.repository)
      || !isRecord(value.source) || !exactKeys(value.source, ['schema', 'canonical_digest', 'immutable_digest', 'state'])
      || !humanIsSafeLine(value.source.schema, 512) || !isDigest(value.source.canonical_digest) || !isDigest(value.source.immutable_digest)
      || !isRecord(value.authority) || !exactKeys(value.authority, ['kind', 'repository', 'issue', 'comment_id', 'body_digest'])
      || value.authority.kind !== 'USER_WEB_CONTROLLER' || value.authority.repository !== value.repository || !isIssue(value.authority.issue)
      || !Number.isSafeInteger(value.authority.comment_id) || value.authority.comment_id < 1 || !isDigest(value.authority.body_digest)
      || !isRecord(value.invariants) || !exactKeys(value.invariants, ['allowed_paths', 'immutable_digest', 'no_provider_target_rebase', 'no_state_movement', 'provider_evidence_observational_only'])
      || !same(value.invariants.allowed_paths, HUMAN_V2_HISTORY_ALLOWED_PATHS) || value.invariants.immutable_digest !== value.source.immutable_digest
      || value.invariants.no_provider_target_rebase !== true || value.invariants.no_state_movement !== true || value.invariants.provider_evidence_observational_only !== true
      || !Array.isArray(value.accepted_candidate_identities)) return humanFailure('HUMAN_HISTORY_DECISION_INVALID');
    const sourceValid = validateHumanCanonicalState(value.source.state);
    if (!sourceValid.ok || sourceValid.state.repository !== value.repository || sourceValid.state.schema !== value.source.schema
      || sourceValid.canonical_digest !== value.source.canonical_digest || humanHistoryImmutableDigest(sourceValid.state) !== value.source.immutable_digest) return humanFailure('HUMAN_HISTORY_DECISION_INVALID');
    const accepted = value.accepted_candidate_identities.map((item, index) => humanHistoryCandidateIdentity(item, 'accepted_candidate_identities[' + String(index) + ']'));
    const additions = humanHistoryAdditions(value.history_additions, accepted);
    humanHistoryCandidateBindings(additions, accepted, value.repository);
    const audited = humanAuditValue(value);
    if (audited) return audited;
    return humanSuccess('HUMAN_HISTORY_DECISION_VALID', { decision: clone(value), decision_digest: digestValue(value), source: sourceValid.state });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_HISTORY_DECISION_INVALID', { reason: error.message });
  }
}
function createHumanSurfaceConformanceDecision(input = {}) {
  try {
    if (!isRecord(input)) throw humanError('HUMAN_HISTORY_DECISION_INVALID', 'decision input must be an object');
    for (const key of ['target', 'desired', 'patch', 'transition', 'provider_target', 'provider_rebase']) if (humanOwn(input, key)) throw humanError('HUMAN_HISTORY_TARGET_FORBIDDEN', key + ' is not a controller decision field');
    const sourceInput = input.source || input.source_state;
    const sourceState = isRecord(sourceInput?.state) ? sourceInput.state : sourceInput;
    const sourceValid = validateHumanCanonicalState(sourceState);
    if (!sourceValid.ok) throw humanError(sourceValid.code, 'source state is not canonical');
    const additionsInput = input.history_additions || { prs: [], registry: [], evidence_refs: [], historical_transitions: [] };
    const acceptedInput = input.accepted_candidate_identities || [];
    const accepted = acceptedInput.map((item, index) => humanHistoryCandidateIdentity(item, 'accepted_candidate_identities[' + String(index) + ']'));
    const normalizedAdditions = humanHistoryAdditions(additionsInput, accepted, input.repository || sourceValid.state.repository);
    humanHistoryCandidateBindings(normalizedAdditions, accepted);
    const authority = input.authority || input.web_authority;
    if (!isRecord(authority)) throw humanError('HUMAN_HISTORY_AUTHORITY_INVALID', 'complete Web authority is required');
    const immutableDigest = input.source?.immutable_digest || humanHistoryImmutableDigest(sourceValid.state);
    const decision = {
      schema: HUMAN_V2_HISTORY_DECISION_SCHEMA,
      root: input.root || 'HUMAN-SURFACE-CONFORMANCE',
      lock: input.lock || input.design_lock || 'HUMAN-SURFACE-CONFORMANCE',
      repository: input.repository || sourceValid.state.repository,
      source: {
        schema: input.source?.schema || sourceValid.state.schema,
        canonical_digest: sourceValid.canonical_digest,
        immutable_digest: immutableDigest,
        state: clone(sourceValid.state),
      },
      authority: clone(authority),
      history_additions: normalizedAdditions,
      accepted_candidate_identities: accepted,
      invariants: {
        allowed_paths: input.invariants?.allowed_paths || [...HUMAN_V2_HISTORY_ALLOWED_PATHS],
        immutable_digest: input.invariants?.immutable_digest || immutableDigest,
        no_provider_target_rebase: input.invariants?.no_provider_target_rebase ?? true,
        no_state_movement: input.invariants?.no_state_movement ?? true,
        provider_evidence_observational_only: input.invariants?.provider_evidence_observational_only ?? true,
      },
    };
    const valid = validateHumanSurfaceConformanceDecision(decision);
    if (!valid.ok) throw humanError(valid.code, valid.reason || valid.code);
    return deepFreeze(decision);
  } catch (error) {
    throw humanError(error.code || 'HUMAN_HISTORY_DECISION_INVALID', error.message);
  }
}
function prepareHumanSurfaceConformanceDecision(input = {}) {
  try {
    const decision = createHumanSurfaceConformanceDecision(input);
    return humanSuccess('HUMAN_HISTORY_DECISION_READY', { decision: clone(decision), decision_digest: digestValue(decision) });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_HISTORY_DECISION_INVALID', { reason: error.message });
  }
}
function humanEvidenceObservation(value, field) {
  if (!isRecord(value) || !exactKeys(value, ['pr_number', 'state', 'merged', 'head', 'tree', 'base', 'revision']) || !isIssue(value.pr_number)
    || !humanIsSafeLine(value.state, 512) || (value.merged !== null && typeof value.merged !== 'boolean')) throw humanError('HUMAN_HISTORY_EVIDENCE_INVALID', field);
  for (const key of ['head', 'tree', 'base', 'revision']) if (value[key] !== null && !humanIsSafeLine(value[key], 1024)) throw humanError('HUMAN_HISTORY_EVIDENCE_INVALID', field + '.' + key);
  return clone(value);
}
function validateHumanSurfaceConformanceEvidence(value, decision) {
  try {
    if (!isRecord(value) || !exactKeys(value, ['schema', 'repository', 'decision_digest', 'source_canonical_digest', 'observations', 'readback', 'provider_evidence_observational_only', 'target_rebase', 'evidence_digest'])
      || value.schema !== HUMAN_V2_HISTORY_EVIDENCE_SCHEMA || !humanIsRepository(value.repository) || !isDigest(value.decision_digest) || !isDigest(value.source_canonical_digest)
      || !Array.isArray(value.observations) || !isRecord(value.readback) || !exactKeys(value.readback, ['complete', 'exact'])
      || typeof value.readback.complete !== 'boolean' || typeof value.readback.exact !== 'boolean' || value.provider_evidence_observational_only !== true
      || value.target_rebase !== false || !isDigest(value.evidence_digest)) return humanFailure('HUMAN_HISTORY_EVIDENCE_INVALID');
    value.observations.forEach((item, index) => humanEvidenceObservation(item, 'observations[' + String(index) + ']'));
    const unsigned = clone(value);
    delete unsigned.evidence_digest;
    const evidenceDigest = humanDigestValue(unsigned, 'human_history_evidence');
    if (!evidenceDigest.ok || evidenceDigest.digest !== value.evidence_digest) return humanFailure('HUMAN_HISTORY_EVIDENCE_DIGEST_INVALID');
    if (decision) {
      const decisionValid = validateHumanSurfaceConformanceDecision(decision);
      if (!decisionValid.ok || value.decision_digest !== decisionValid.decision_digest || value.source_canonical_digest !== decision.source.canonical_digest || value.repository !== decision.repository) return humanFailure('HUMAN_HISTORY_EVIDENCE_BINDING_INVALID');
    }
    const audited = humanAuditValue(value);
    if (audited) return audited;
    return humanSuccess('HUMAN_HISTORY_EVIDENCE_VALID', { evidence: clone(value), evidence_digest: value.evidence_digest });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_HISTORY_EVIDENCE_INVALID', { reason: error.message });
  }
}
function createHumanSurfaceConformanceEvidence(input = {}) {
  try {
    const value = {
      schema: HUMAN_V2_HISTORY_EVIDENCE_SCHEMA,
      repository: input.repository,
      decision_digest: input.decision_digest,
      source_canonical_digest: input.source_canonical_digest,
      observations: (input.observations || []).map((item, index) => humanEvidenceObservation(item, 'observations[' + String(index) + ']')),
      readback: clone(input.readback || { complete: false, exact: false }),
      provider_evidence_observational_only: input.provider_evidence_observational_only,
      target_rebase: input.target_rebase,
      evidence_digest: null,
    };
    const unsigned = clone(value);
    delete unsigned.evidence_digest;
    const digest = humanDigestValue(unsigned, 'human_history_evidence');
    if (!digest.ok) throw humanError(digest.code, 'evidence digest cannot be computed');
    value.evidence_digest = digest.digest;
    const valid = validateHumanSurfaceConformanceEvidence(value, input.decision);
    if (!valid.ok) throw humanError(valid.code, valid.reason || valid.code);
    return deepFreeze(value);
  } catch (error) {
    throw humanError(error.code || 'HUMAN_HISTORY_EVIDENCE_INVALID', error.message);
  }
}
function buildHumanSurfaceConformanceEvidence(input = {}, decision) {
  try {
    const value = createHumanSurfaceConformanceEvidence({
      ...input,
      decision,
      decision_digest: input.decision_digest || (decision ? digestValue(decision) : undefined),
      source_canonical_digest: input.source_canonical_digest || decision?.source.canonical_digest,
      repository: input.repository || decision?.repository,
    });
    return humanSuccess('HUMAN_HISTORY_EVIDENCE_READY', { evidence: clone(value), evidence_digest: value.evidence_digest });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_HISTORY_EVIDENCE_INVALID', { reason: error.message });
  }
}
function humanHistoryCore(state) {
  const copy = clone(state);
  copy.prs = [];
  copy.evidence_refs = [];
  copy.historical_transitions = [];
  copy.children = (copy.children || []).map((child) => ({ ...child, pr_registry: [] }));
  return copy;
}
function humanArrayPrefix(actual, expected) {
  return Array.isArray(actual) && actual.length >= expected.length && expected.every((item, index) => same(actual[index], item));
}
function humanValidateHistoryExtendedToolkitState(value) {
  if (!isRecord(value) || value.schema !== STATE_SCHEMA || value.repository !== REPOSITORY) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID');
  const base = FINALISATION_STAGE_B_TARGET_STATE;
  if (!base || !same(humanHistoryCore(value), humanHistoryCore(base)) || !humanArrayPrefix(value.prs, base.prs)
    || !humanArrayPrefix(value.evidence_refs, base.evidence_refs) || !humanArrayPrefix(value.historical_transitions, base.historical_transitions)) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID');
  const baseChild = childByIssue(base, CHILD_ISSUE);
  const child = childByIssue(value, CHILD_ISSUE);
  if (!child || !humanArrayPrefix(child.pr_registry, baseChild.pr_registry)) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID');
  if (!value.prs.every((item) => validatePrDescriptor(item)) || !value.evidence_refs.every((item) => validateEvidenceRef(item))
    || !value.historical_transitions.every((item) => validateTransition(item)) || !child.pr_registry.every((item) => validateRegistryEntry(item))) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID');
  const digest = humanDigestValue(value, 'history_extended_state');
  if (!digest.ok) return digest;
  return humanSuccess('HISTORY_EXTENDED_PRE_E4_VALID', { state: clone(value), canonical_digest: digest.digest });
}
function humanHistorySourceAdmitted(state, digest, context = {}) {
  if (digest === HUMAN_V2_STAGE_B_DIGEST) return true;
  const marked = Array.isArray(state.extensions) && state.extensions.some((item) => isRecord(item)
    && (item.kind === 'HISTORY_EXTENDED_PRE_E4' || item.status === 'HISTORY_EXTENDED_PRE_E4' || item.history_status === 'HISTORY_EXTENDED_PRE_E4'));
  return marked && context.validated_history_state === true;
}
function humanHistoryAppend(baseItems, additions, keyFn, conflictCode) {
  const result = clone(baseItems || []);
  const byKey = new Map();
  for (const item of result) {
    const key = keyFn(item);
    if (byKey.has(key)) throw humanError(conflictCode, 'duplicate source history entry');
    byKey.set(key, item);
  }
  for (const item of additions) {
    const key = keyFn(item);
    if (byKey.has(key)) {
      if (!same(byKey.get(key), item)) throw humanError('HUMAN_HISTORY_CONFLICT', String(key) + ' conflicts with source history');
    } else {
      const copy = clone(item);
      result.push(copy);
      byKey.set(key, copy);
    }
  }
  return result;
}
function humanApplyHistoryAdditions(source, decision) {
  const next = clone(source);
  const additions = decision.history_additions;
  next.prs = humanHistoryAppend(next.prs, additions.prs, (item) => String(item.number), 'HUMAN_HISTORY_DUPLICATE_PR');
  next.evidence_refs = humanHistoryAppend(next.evidence_refs, additions.evidence_refs, (item) => item.id, 'HUMAN_HISTORY_DUPLICATE_EVIDENCE');
  next.historical_transitions = humanHistoryAppend(next.historical_transitions, additions.historical_transitions, (item) => item.id, 'HUMAN_HISTORY_DUPLICATE_TRANSITION');
  for (const item of additions.registry) {
    const child = next.children.find((candidate) => candidate.issue === item.child_issue);
    if (!child) throw humanError('HUMAN_HISTORY_CHILD_NOT_FOUND', '#' + String(item.child_issue));
    child.pr_registry = humanHistoryAppend(child.pr_registry, [item.entry], (entry) => String(entry.pr), 'HUMAN_HISTORY_DUPLICATE_REGISTRY');
  }
  return next;
}
function humanHistoryDeltaAllowed(source, target) {
  if (!isRecord(source) || !isRecord(target) || !same(humanHistoryCore(source), humanHistoryCore(target))) return false;
  if (!humanArrayPrefix(target.prs, source.prs) || !humanArrayPrefix(target.evidence_refs, source.evidence_refs) || !humanArrayPrefix(target.historical_transitions, source.historical_transitions)) return false;
  return source.children.every((child, index) => humanArrayPrefix(target.children[index]?.pr_registry, child.pr_registry));
}
function validateHistoryOnlyDelta(sourceState, targetState, decision) {
  const decisionValid = validateHumanSurfaceConformanceDecision(decision);
  if (!decisionValid.ok) return decisionValid;
  const sourceValid = validateHumanCanonicalState(sourceState);
  if (!sourceValid.ok || sourceValid.canonical_digest !== decision.source.canonical_digest) return humanFailure('HUMAN_HISTORY_SOURCE_DIGEST_MISMATCH');
  const targetValid = validateHumanCanonicalState(targetState);
  if (!targetValid.ok) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID', { reason: targetValid.code });
  try {
    const applied = humanApplyHistoryAdditions(sourceValid.state, decision);
    if (!same(applied, targetState) || !humanHistoryDeltaAllowed(sourceValid.state, targetState)
      || humanHistoryImmutableDigest(targetState) !== decision.source.immutable_digest) return humanFailure('HUMAN_HISTORY_STATE_MOVEMENT');
    return humanSuccess('HUMAN_HISTORY_DELTA_VALID', { source_digest: sourceValid.canonical_digest, target_digest: digestValue(targetState) });
  } catch (error) {
    return humanFailure(error.code || 'HUMAN_HISTORY_DELTA_INVALID', { reason: error.message });
  }
}
function deriveHumanSurfaceHistoryTarget(sourceOrInput = {}, decisionInput, contextInput = {}) {
  const input = decisionInput === undefined
    ? sourceOrInput
    : { ...(isRecord(contextInput) ? contextInput : {}), source: sourceOrInput, decision: decisionInput };
  if (!isRecord(input) || !isRecord(input.source) || !isRecord(input.decision)) return humanFailure('HUMAN_HISTORY_TARGET_INPUT_INVALID');
  if (input.source_complete === false || input.complete === false) return humanFailure('BODY_READ_INCOMPLETE');
  let sourceValid = validateHumanCanonicalState(input.source);
  if (!sourceValid.ok && input.validated_history_state === true) {
    sourceValid = humanValidateHistoryExtendedToolkitState(input.source);
  }
  if (!sourceValid.ok) return sourceValid;
  const sourceDigest = sourceValid.canonical_digest;
  if (input.source.canonical_digest && input.source.canonical_digest !== sourceDigest) return humanFailure('HISTORY_SOURCE_DIGEST_MISMATCH');
  if (!humanHistorySourceAdmitted(sourceValid.state, sourceDigest, input)) return humanFailure('HISTORY_SOURCE_NOT_ADMITTED');
  const decisionValid = validateHumanSurfaceConformanceDecision(input.decision);
  if (!decisionValid.ok) return decisionValid;
  if (input.decision.repository !== sourceValid.state.repository || input.decision.source.canonical_digest !== sourceDigest) return humanFailure('HUMAN_HISTORY_SOURCE_DIGEST_MISMATCH');
  if (humanHistoryImmutableDigest(sourceValid.state) !== input.decision.source.immutable_digest) return humanFailure('HUMAN_HISTORY_STATE_MOVEMENT');
  if (input.provider_evidence !== undefined && input.provider_evidence !== null) {
    const evidenceValid = validateHumanSurfaceConformanceEvidence(input.provider_evidence, input.decision);
    if (!evidenceValid.ok) return evidenceValid;
  }
  let target;
  try { target = humanApplyHistoryAdditions(sourceValid.state, input.decision); } catch (error) { return humanFailure(error.code || 'HUMAN_HISTORY_APPLY_INVALID', { reason: error.message }); }
  if (!humanHistoryDeltaAllowed(sourceValid.state, target)) return humanFailure('HUMAN_HISTORY_STATE_MOVEMENT');
  if (input.target_state !== undefined && !same(input.target_state, target)) {
    const suppliedTargetValid = validateHumanCanonicalState(input.target_state);
    if (!suppliedTargetValid.ok) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID', { reason: suppliedTargetValid.code });
    return humanFailure('HUMAN_HISTORY_TARGET_DIGEST_MISMATCH');
  }
  if (input.target_canonical_digest !== undefined && input.target_canonical_digest !== digestValue(target)) return humanFailure('HUMAN_HISTORY_TARGET_DIGEST_MISMATCH');
  let targetValid = validateCanonicalStateV5(target);
  if (!targetValid.ok && sourceValid.state.schema === STATE_SCHEMA) targetValid = humanValidateHistoryExtendedToolkitState(target);
  if (!targetValid.ok) return humanFailure('HISTORY_TARGET_CANONICAL_INVALID', { reason: targetValid.code });
  return humanSuccess('HISTORY_EXTENDED_PRE_E4_TARGET_READY', {
    state: clone(targetValid.state || target),
    target_state: clone(targetValid.state || target),
    source_state: clone(sourceValid.state),
    source_canonical_digest: sourceDigest,
    target_canonical_digest: targetValid.canonical_digest || digestValue(target),
    decision: clone(input.decision),
    decision_digest: decisionValid.decision_digest,
    provider_evidence: input.provider_evidence ? clone(input.provider_evidence) : null,
    provider_evidence_observational_only: true,
    target_rebase: false,
    history_status: 'HISTORY_EXTENDED_PRE_E4',
    render_eligible: true,
  });
}
const HUMAN_V2_MIGRATION_STALE_CHILD_STATE = 'PARENT_HUMAN_V2_COMMITTED_CHILD_LEGACY_STALE';
function classifyHumanV2MigrationState(input = {}) {
  const state = typeof input === 'string' ? input : input.transaction_state || input.state;
  if (state === HUMAN_V2_MIGRATION_STALE_CHILD_STATE) return humanSuccess('MIGRATION_STATE_RECOVERABLE', { transaction_state: state, recoverable: true, parent_owner_committed: true, child_owner_stale: true });
  if (state === 'HUMAN_V2_RECONCILED') return humanSuccess('MIGRATION_STATE_RECONCILED', { transaction_state: state, recoverable: false });
  if (state === 'HUMAN_V2_PREPARED') return humanSuccess('MIGRATION_STATE_PREPARED', { transaction_state: state, recoverable: true });
  return humanFailure('MIGRATION_STATE_UNKNOWN');
}
function prepareHumanV2Migration(input = {}) {
  try {
    if (!isRecord(input)) return humanFailure('MIGRATION_INPUT_INVALID');
    const parentRead = input.parent_complete_read || input.parent;
    const childRead = input.child_complete_read || input.child;
    const parentParsed = parseProgrammeBodyComplete(parentRead, { kind: 'parent' });
    if (!parentParsed.ok) return parentParsed;
    const source = input.source_state || parentParsed.state;
    const sourceDigest = digestValue(source);
    const childParsed = childRead ? parseProgrammeBodyComplete(childRead, {
      kind: 'child',
      canonical_state: source,
      canonical_digest: sourceDigest,
      child_issue: input.child_issue,
    }) : null;
    if (childParsed && !childParsed.ok) return childParsed;
    const targetResult = input.decision
      ? deriveHumanSurfaceHistoryTarget({ source, decision: input.decision, provider_evidence: input.provider_evidence, validated_history_state: input.validated_history_state })
      : humanSuccess('HUMAN_V2_MIGRATION_SOURCE_READY', { state: clone(source), target_state: clone(source), target_canonical_digest: digestValue(source), history_status: null });
    if (!targetResult.ok) return targetResult;
    const parent = renderHumanV2Parent(targetResult.target_state, input.render_options || {});
    if (!parent.ok) return parent;
    const childIssue = input.child_issue === undefined ? humanSelectChildFromState(targetResult.target_state).issue : input.child_issue;
    const child = renderHumanV2Child(targetResult.target_state, childIssue, input.render_options || {});
    if (!child.ok) return child;
    return humanSuccess('HUMAN_V2_MIGRATION_PREPARED', {
      transaction_state: 'HUMAN_V2_PREPARED',
      source_state: clone(source),
      target_state: clone(targetResult.target_state),
      target_canonical_digest: targetResult.target_canonical_digest,
      parent: { body: parent.body, canonical_digest: parent.canonical_digest, body_digest: parent.complete_body_bytes_digest },
      child: { body: child.body, canonical_digest: child.canonical_digest, body_digest: child.complete_body_bytes_digest, child_issue: childIssue },
      writes: ['parent', 'child'],
      provider_cas_claim: false,
      automatic_rollback: false,
    });
  } catch (error) {
    return humanFailure(error.code || 'MIGRATION_INPUT_INVALID', { reason: error.message });
  }
}
function recoverHumanV2Migration(input = {}) {
  try {
    if (!isRecord(input) || input.transaction_state !== HUMAN_V2_MIGRATION_STALE_CHILD_STATE) return humanFailure('MIGRATION_STATE_UNKNOWN');
    const parent = parseHumanV2Parent(input.parent_complete_read || input.parent, input.expected_identity || {});
    if (!parent.ok) return humanFailure('MIGRATION_PARENT_DRIFT', { reason: parent.code });
    const state = parent.state;
    if (!input.child_complete_read && !input.child) return humanSuccess('MIGRATION_PARENT_RECOVERED', {
      transaction_state: HUMAN_V2_MIGRATION_STALE_CHILD_STATE,
      recovered_parent_state: clone(state),
      child_write_required: true,
      provider_cas_claim: false,
      automatic_rollback: false,
    });
    const child = verifyHumanV2Child(input.child_complete_read || input.child, state, input.child_issue, input.child_options || {});
    if (!child.ok) return humanFailure(child.code === 'CHILD_WRITE_FAILED_RECOVERABLE' ? child.code : 'MIGRATION_CHILD_DRIFT', { reason: child.code });
    return humanSuccess('HUMAN_V2_MIGRATION_RECOVERED', {
      transaction_state: 'HUMAN_V2_RECONCILED',
      recovered_parent_state: clone(state),
      child_issue: child.child_issue,
      provider_cas_claim: false,
      automatic_rollback: false,
    });
  } catch (error) {
    return humanFailure('MIGRATION_PARENT_DRIFT', { reason: error.message });
  }
}

const projectionBootstrapRecovery = Object.freeze({
  schema: DECISION_SCHEMA,
  evidenceSchema: EVIDENCE_SCHEMA,
  createDecision: createRecoveryDecision,
  validateDecision,
  validateEvidence,
  classifyPartialState,
  parseParentV5Body,
  parseChildV5Body,
  parse: parseProgrammeV5Body,
  render: renderProgrammeV5,
  preview: previewRecovery,
  buildTargetState: buildRecoveryTargetState,
  buildReceiptOperationDescriptor,
  validateControllerBootstrap,
  verifyBootstrapWorkspaceProof,
  renderHumanV2Parent,
  renderHumanV2Child,
  renderHumanV2Pr,
  parseHumanV2Parent,
  parseHumanV2Child,
  verifyHumanV2Child,
  verifyHumanV2Pr,
  parseProgrammeBodyComplete,
  selectChildIssue,
  classifyHumanV2MigrationState,
  prepareHumanV2Migration,
  recoverHumanV2Migration,
});
const postMergeEpochFinalisation = Object.freeze({
  schema: FINALISATION_DECISION_SCHEMA,
  evidenceSchema: FINALISATION_EVIDENCE_SCHEMA,
  operationSchema: FINALISATION_OPERATION_SCHEMA,
  createDecision: createPostMergeEpochFinalisationDecision,
  validateDecision: validatePostMergeEpochFinalisationDecision,
  deriveTargets: derivePostMergeEpochFinalisationTargets,
  buildStageATargetState: buildPostMergeEpochFinalisationStageATargetState,
  buildStageBTargetState: buildPostMergeEpochFinalisationStageBTargetState,
  validateEvidence: validatePostMergeEpochFinalisationEvidence,
  buildEvidence: buildPostMergeEpochFinalisationEvidence,
  classifyCheckpoint: classifyPostMergeEpochFinalisationCheckpoint,
  preview: previewPostMergeEpochFinalisation,
});
const programmeV5 = Object.freeze({
  schema: STATE_SCHEMA,
  HUMAN_V2_VERSION,
  HUMAN_V2_MARKERS,
  HUMAN_V2_TOOLKIT_MARKERS,
  PublicSurfaceCodec,
  validateCanonicalStateV5,
  deriveProjectionV5: (state, kind) => {
    const valid = validateCanonicalStateV5(state);
    return valid.ok ? success('V5_PROJECTION_READY', { projection: projectionPayload(state, kind), projection_digest: digestValue(projectionPayload(state, kind)) }) : valid;
  },
  renderProgrammeV5,
  parseProgrammeV5Body,
  renderHumanV2Parent,
  renderHumanV2Child,
  renderHumanV2Pr,
  parseHumanV2Parent,
  parseHumanV2Child,
  verifyHumanV2Child,
  verifyHumanV2Pr,
  parseProgrammeBodyComplete,
  selectChildIssue,
  validateHumanCanonicalState,
  validateHumanSurfaceConformanceDecision,
  validateHumanSurfaceConformanceEvidence,
  createHumanSurfaceConformanceDecision,
  prepareHumanSurfaceConformanceDecision,
  createHumanSurfaceConformanceEvidence,
  buildHumanSurfaceConformanceEvidence,
  deriveHumanSurfaceHistoryTarget,
  validateHistoryOnlyDelta,
  humanHistoryImmutableDigest,
  HUMAN_V2_MIGRATION_STALE_CHILD_STATE,
  classifyHumanV2MigrationState,
  prepareHumanV2Migration,
  recoverHumanV2Migration,
  projectionBootstrapRecovery,
  postMergeEpochFinalisation,
});

module.exports = Object.freeze({
  REPOSITORY,
  PARENT_ISSUE,
  CHILD_ISSUE,
  MAIN_SHA,
  RECOVERY_ROOT,
  LOCK,
  OLD_ROOT,
  PARKED_ROOT,
  WRITE_SAFETY_MODE,
  STATE_SCHEMA,
  PROJECTION_SCHEMA,
  SURFACE_SCHEMA,
  DECISION_SCHEMA,
  EVIDENCE_SCHEMA,
  BOOTSTRAP_SCHEMA,
  SOURCE_CANONICAL_DIGEST,
  SOURCE_PARENT_BODY_DIGEST,
  SOURCE_CHILD_BODY_DIGEST,
  SOURCE_PARENT_REVISION,
  SOURCE_CHILD_REVISION,
  TARGET_CANONICAL_DIGEST,
  FINALISATION_ROOT,
  FINALISATION_LOCK,
  FINALISATION_SCOPE,
  FINALISATION_WRITE_SAFETY_MODE,
  FINALISATION_DECISION_SCHEMA,
  FINALISATION_EVIDENCE_SCHEMA,
  FINALISATION_OPERATION_SCHEMA,
  FINALISATION_SOURCE_CANONICAL_DIGEST,
  FINALISATION_STAGE_A_CANONICAL_DIGEST,
  FINALISATION_STAGE_B_CANONICAL_DIGEST,
  PR380_HEAD,
  PR380_TREE,
  PR380_BRANCH,
  PR380_BASE_SHA,
  PR380_VERSION,
  PR380_MERGE_COMMIT,
  FINAL_G4_EVIDENCE_REF,
  POST_MERGE_TECHNICAL_EVIDENCE_REF,
  PR379_NON_CONVERGENCE_EVIDENCE_REF,
  FINALISATION_AUTHORITY,
  FINALISATION_CHECKPOINTS,
  FINALISATION_OPERATION_ORDER,
  FINALISATION_TRANSITION_ID,
  FINALISATION_PR379_SOURCE_REVISION,
  FINALISATION_SOURCE_STATE,
  FINALISATION_SOURCE_RENDERED,
  FINALISATION_SOURCE_PARENT_BODY_DIGEST,
  FINALISATION_SOURCE_CHILD_BODY_DIGEST,
  FINALISATION_STAGE_A_TARGET_STATE,
  FINALISATION_STAGE_B_TARGET_STATE,
  FINALISATION_RENDERED_TARGETS,
  FINALISATION_CHECKPOINT_TABLE,
  FINALISATION_TARGET_TABLE,
  RECOVERY_EVIDENCE_REF,
  HOLD_EVIDENCE_REF,
  RETENTION_EVIDENCE_REF,
  PAGINATION_COLLECTIONS,
  PAGINATION_KEYS,
  CHECK_RUNS_TOTAL_FIELD,
  FROZEN_HEAD,
  FROZEN_TREE,
  FROZEN_BRANCH,
  PR366_HEAD,
  PR366_TREE,
  PR366_BASE_SHA,
  AUTHORITY_CONTROLLING,
  AUTHORITY_PREDECESSOR,
  PR379_REVIEW_FACTS,
  PR379_COMMENT_FACTS,
  PR379_CHECK_FACTS,
  MANAGED_MARKERS,
  canonicalSerialize,
  digestValue,
  sha256Text,
  createRecoveryDecision,
  validateDecision,
  validateCanonicalStateV5,
  buildRecoveryTargetState,
  validateInterEpochStateV5,
  validateFinalisationSourceState,
  createPostMergeEpochFinalisationDecision,
  validatePostMergeEpochFinalisationDecision,
  derivePostMergeEpochFinalisationTargets,
  buildPostMergeEpochFinalisationStageATargetState,
  buildPostMergeEpochFinalisationStageBTargetState,
  validatePostMergeEpochFinalisationEvidence,
  buildPostMergeEpochFinalisationEvidence,
  classifyPostMergeEpochFinalisationCheckpoint,
  previewPostMergeEpochFinalisation,
  deriveProjectionV5: programmeV5.deriveProjectionV5,
  renderProgrammeV5,
  parseParentV5Body,
  parseChildV5Body,
  parseProgrammeV5Body,
  HUMAN_V2_VERSION,
  HUMAN_V2_PRESENTATION_SCHEMA,
  HUMAN_V2_PR_PRESENTATION_SCHEMA,
  HUMAN_V2_PARENT_CARRIER_SCHEMA,
  HUMAN_V2_CHILD_CARRIER_SCHEMA,
  HUMAN_V2_PR_CARRIER_SCHEMA,
  HUMAN_V2_PARENT_PROJECTION_SCHEMA,
  HUMAN_V2_CHILD_PROJECTION_SCHEMA,
  HUMAN_V2_PR_PROJECTION_SCHEMA,
  HUMAN_V2_PR_DESCRIPTOR_SCHEMA,
  HUMAN_V2_CANONICAL_CLASS,
  HUMAN_V2_HISTORY_DECISION_SCHEMA,
  HUMAN_V2_HISTORY_EVIDENCE_SCHEMA,
  HUMAN_V2_HISTORY_ALLOWED_PATHS,
  HUMAN_V2_NEXT_ACTIONS,
  HUMAN_V2_MARKERS,
  HUMAN_V2_TOOLKIT_MARKERS,
  PublicSurfaceCodec,
  validateHumanCanonicalState,
  renderHumanV2Parent,
  renderHumanV2Child,
  renderHumanV2Pr,
  parseHumanV2Parent,
  parseHumanV2Child,
  verifyHumanV2Child,
  verifyHumanV2Pr,
  parseProgrammeBodyComplete,
  selectChildIssue,
  validateHumanSurfaceConformanceDecision,
  createHumanSurfaceConformanceDecision,
  prepareHumanSurfaceConformanceDecision,
  validateHumanSurfaceConformanceEvidence,
  createHumanSurfaceConformanceEvidence,
  buildHumanSurfaceConformanceEvidence,
  deriveHumanSurfaceHistoryTarget,
  validateHistoryOnlyDelta,
  humanHistoryImmutableDigest,
  HUMAN_V2_MIGRATION_STALE_CHILD_STATE,
  classifyHumanV2MigrationState,
  prepareHumanV2Migration,
  recoverHumanV2Migration,
  validateEvidence,
  validateProviderEvidence,
  buildPaginationEvidence,
  classifyPartialState,
  buildReceiptOperationDescriptor,
  verifyBootstrapWorkspaceProof,
  validateControllerBootstrap,
  projectionBootstrapRecovery,
  postMergeEpochFinalisation,
  programmeV5,
});
