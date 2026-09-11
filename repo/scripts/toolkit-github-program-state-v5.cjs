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
  if (Object.prototype.hasOwnProperty.call(value, 'candidate') && value.candidate !== null && !validateCandidate(value.candidate)) return false;
  if (target && !exactKeys(value, ['accepted_evidence_ref', 'candidate', 'completes_child', 'draft', 'epoch_id', 'github_state', 'merged', 'pr', 'retention_evidence_ref', 'retirement_evidence_ref', 'role', 'status'])) return false;
  return true;
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
    && exactKeys(value, keys)
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
    && isStringArray(value.validation_requirements);
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

const H2_ROOT = 'S2-PRE-E4-HUMAN-SURFACE-PHASE-TRUTH-004';
const H2_LOCK = 'DL-S2-PRE-E4-HUMAN-SURFACE-PHASE-TRUTH-004';
const H2_PACKAGE_VERSION = '2.10.9';
const H2_VERSION = 'human-v2';
const H2_CANONICAL_CLASS = 'canonical-programme-state';
const H2_DESCRIPTOR_SCHEMA = 'github.program.pr-descriptor.v2';
const H2_BIND_AUTHORITY_SCHEMA = 'github.program.bind-pr-number.v1';
const H2_HISTORY_SCHEMA = 'toolkit.github.program.human-history.v2';
const H2_HISTORY_DECISION_SCHEMA = 'toolkit.github.program.human-history-decision.v2';
const H2_PROVIDER_OBSERVATION_SCHEMA = 'toolkit.github.program.provider-observation.v1';
const H2_PARENT_CARRIER_SCHEMA = 'github.program.human-parent-carrier.v2';
const H2_CHILD_CARRIER_SCHEMA = 'github.program.human-child-carrier.v2';
const H2_PR_CARRIER_SCHEMA = 'github.program.human-pr-carrier.v2';
const H2_PARENT_PROJECTION_SCHEMA = 'github.program.parent-projection.v2';
const H2_CHILD_PROJECTION_SCHEMA = 'github.program.child-projection.v2';
const H2_PR_PHASE_PROJECTION_SCHEMA = 'github.program.pr-phase-projection.v1';
const H2_HISTORY_KEY = 'human_surface_v2_history';
const H2_STAGES = Object.freeze([
  'INPUT', 'COMPLETE_READ', 'CLASSIFY', 'PARSE', 'AUTHORITY', 'CANONICAL',
  'RELATIONSHIP', 'HISTORY', 'PROVIDER_ASSERTION', 'MIGRATION', 'LIFECYCLE',
  'PUBLIC_AUDIT', 'SERIALIZE', 'READBACK',
]);
const H2_CHILD_ACTIONS = Object.freeze([
  'CHILD_COMPLETE', 'BLOCKING_HOLD', 'WAIT_DEPENDENCIES',
  'AWAIT_CHILD_AUTHORITY', 'CONTINUE_ACTIVE_GATE', 'AMEND_REQUIRED',
  'REPLACEMENT_REQUIRED', 'AWAIT_EPOCH_AUTHORITY', 'BEGIN_OR_CONTINUE_EPOCH',
  'AWAIT_CHILD_FINALITY',
]);
const H2_PROGRAMME_ACTIONS = Object.freeze([
  'CONTINUE_CURRENT_CHILD', 'AWAIT_PROGRAMME_FINALITY', 'PROGRAMME_COMPLETE',
]);
const H2_RESERVED_STEMS = Object.freeze([
  'AI-AGENT-TOOLKIT:GITHUB-PROGRAM-',
  'MANAGED-PROGRAM-',
]);
const H2_TEXT_PUNCTUATION = (code) => (
  code >= 0x21 && code <= 0x2f
  || code >= 0x3a && code <= 0x40
  || code >= 0x5b && code <= 0x60
  || code >= 0x7b && code <= 0x7e
);
const H2_SENSITIVE_KEY = /^(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|password|passwd|secret|private[_ -]?key|client[_ -]?secret|authorization|credential|credentials|token|tokens|private[_ -]?value|secret[_ -]?value)$/i;
const H2_SECRET_VALUE = /(?:\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|tokens|password|passwd|secret|private[_ -]?key|client[_ -]?secret|authorization|credential)\s*[:=]\s*[^\s,;)}\]]+|\bbearer\s+[A-Za-z0-9._~+/=-]{6,}|\b(?:ghp|gho|ghu|ghs|ghr)[_-][A-Za-z0-9_-]{8,}\b|\bgithub_pat_[A-Za-z0-9_-]{8,}\b|\bsk-[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{12,}\b)/i;
const H2_PRIVATE_PATH = /(?:file:\/\/|data:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|(?:^|[\s(])\/(?:Users|home|root|private|etc|var|tmp|opt|srv)(?:[\\/]|$))/i;
const H2_STRUCTURAL_TOKENS = Object.freeze(['<!--', '-->', '```']);

const H2_MARKERS = Object.freeze({
  generic: Object.freeze({
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
  }),
  toolkit: Object.freeze({
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
  }),
});

function h2Own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function h2Error(code, stage) {
  const error = new Error(code);
  error.h2_code = code;
  error.h2_stage = stage;
  return error;
}
function h2Require(condition, _legacyBoolean, code, stage) {
  if (!condition) throw h2Error(code, stage);
  return condition;
}
function h2IsPlain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const names = Object.getOwnPropertyNames(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) return false;
  return names.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}
function h2Exact(value, keys) {
  if (!h2IsPlain(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function h2NoMalformedUnicode(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function h2ForbiddenUnicode(value) {
  if (!h2NoMalformedUnicode(value)) return true;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === 0xfeff || code === 0x061c || code === 0x200e || code === 0x200f
      || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069
      || code >= 0xfdd0 && code <= 0xfdef || (code & 0xffff) === 0xfffe || (code & 0xffff) === 0xffff) return true;
  }
  return false;
}
function h2Canonical(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (h2ForbiddenUnicode(value)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype && Object.getPrototypeOf(value) !== null) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    if (Object.getOwnPropertySymbols(value).length > 0) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || (descriptor.get || descriptor.set)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
      if (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    }
    if (seen.has(value)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    seen.add(value);
    const serialized = '[' + value.map((item) => h2Canonical(item, seen)).join(',') + ']';
    seen.delete(value);
    return serialized;
  }
  if (!h2IsPlain(value) || seen.has(value)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
  seen.add(value);
  const serialized = '{' + Object.keys(value).sort().map((key) => {
    if (h2ForbiddenUnicode(key)) throw h2Error('CANONICAL_VALUE_INVALID', 'CANONICAL');
    return JSON.stringify(key) + ':' + h2Canonical(value[key], seen);
  }).join(',') + '}';
  seen.delete(value);
  return serialized;
}
function h2Clone(value) { return JSON.parse(h2Canonical(value)); }
function h2Digest(value) {
  return crypto.createHash('sha256').update(h2Canonical(value), 'utf8').digest('hex');
}
function h2DigestText(value) {
  h2Require(typeof value === 'string' && h2NoMalformedUnicode(value), true, 'PUBLIC_TEXT_INVALID', 'PUBLIC_AUDIT');
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function h2SafeLine(value, max = 4096) {
  return typeof value === 'string' && value.length <= max && h2NoMalformedUnicode(value)
    && !/[\r\n\t]/.test(value) && !h2ForbiddenUnicode(value);
}
function h2SafeId(value, max = 512) {
  return h2SafeLine(value, max) && value.length > 0 && !value.includes('..') && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}
function h2Repository(value) {
  return h2SafeLine(value, 512) && /^[^/\s]+\/[^/\s]+$/.test(value);
}
function h2AuditScalar(value) {
  return typeof value === 'string'
    && !h2ForbiddenUnicode(value)
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !H2_SECRET_VALUE.test(value)
    && !/-----BEGIN [^-]*PRIVATE KEY-----/i.test(value)
    && !H2_PRIVATE_PATH.test(value)
    && !H2_STRUCTURAL_TOKENS.some((token) => value.includes(token));
}
function h2Audit(value, seen = new Set()) {
  if (typeof value === 'string') return h2AuditScalar(value);
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => h2Audit(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!h2IsPlain(value) || seen.has(value)) return false;
  seen.add(value);
  const valid = Object.entries(value).every(([key, item]) => !H2_SENSITIVE_KEY.test(key) && h2AuditScalar(key) && h2Audit(item, seen));
  seen.delete(value);
  return valid;
}
function h2Sha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function h2Hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function h2Issue(value) { return Number.isSafeInteger(value) && value >= 1; }
function h2Array(value) { return Array.isArray(value); }
function h2StringArray(value, max = 4096) { return Array.isArray(value) && value.every((item) => h2SafeLine(item, max)); }
function h2Comparable(left, right) {
  try { return h2Canonical(left) === h2Canonical(right); } catch (_error) { return false; }
}
function h2Without(value, key) {
  const copy = h2Clone(value);
  delete copy[key];
  return copy;
}
function h2Candidate(value, stage = 'AUTHORITY') {
  const keys = ['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version'];
  h2Require(h2Exact(value, keys)
    && h2Repository(value.repository)
    && h2SafeLine(value.branch, 1024)
    && h2SafeLine(value.base_ref, 256)
    && h2Sha(value.base_sha) && h2Sha(value.head) && h2Sha(value.tree)
    && h2SafeLine(value.version, 256), true, 'CANDIDATE_INVALID', stage);
  return h2Clone(value);
}
function h2Descriptor(value, stage = 'AUTHORITY') {
  const keys = [
    'schema', 'root', 'lock', 'repository', 'parent_issue', 'child_issue', 'epoch_id',
    'gate', 'role', 'completes_child', 'summary', 'purpose', 'changed_surfaces',
    'scope', 'out_of_scope', 'design_constraints', 'validation_requirements',
    'evidence_refs', 'eli5', 'next_action_pre_number', 'repair_history', 'before_after',
    'repair_budget', 'hosted_qualification', 'recovery_evidence', 'candidate',
  ];
  h2Require(h2Exact(value, keys)
    && value.schema === H2_DESCRIPTOR_SCHEMA
    && value.root === H2_ROOT && value.lock === H2_LOCK
    && h2Repository(value.repository) && h2Issue(value.parent_issue) && h2Issue(value.child_issue)
    && h2SafeId(value.epoch_id) && h2SafeId(value.gate)
    && value.role === 'INTERMEDIATE' && typeof value.completes_child === 'boolean'
    && h2SafeLine(value.summary) && h2SafeLine(value.purpose)
    && h2StringArray(value.changed_surfaces) && h2StringArray(value.scope)
    && h2StringArray(value.out_of_scope) && h2StringArray(value.design_constraints)
    && h2StringArray(value.validation_requirements) && h2StringArray(value.evidence_refs)
    && h2SafeLine(value.eli5) && h2SafeLine(value.next_action_pre_number)
    && h2StringArray(value.repair_history) && h2StringArray(value.before_after)
    && h2StringArray(value.repair_budget) && h2StringArray(value.hosted_qualification)
    && h2StringArray(value.recovery_evidence), true, 'DESCRIPTOR_INVALID', stage);
  const candidate = h2Candidate(value.candidate, stage);
  h2Require(candidate.repository === value.repository, true, 'CANDIDATE_INVALID', stage);
  h2Require(h2Audit(value), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  return h2Clone(value);
}
function h2BoundAuthority(value, descriptor, stage = 'AUTHORITY') {
  const keys = ['schema', 'decision', 'root', 'lock', 'source', 'repository', 'pr_number', 'descriptor_sha256', 'candidate', 'authority_sha256'];
  const sourceKeys = ['kind', 'reference', 'body_sha256'];
  if (h2IsPlain(value) && value.decision === 'BIND_PR_NUMBER'
    && keys.some((key) => !h2Own(value, key))) {
    throw h2Error('BOUND_CURRENT_FIELD_MISSING', stage);
  }
  h2Require(h2Exact(value, keys)
    && value.schema === H2_BIND_AUTHORITY_SCHEMA && value.decision === 'BIND_PR_NUMBER'
    && value.root === descriptor.root && value.lock === descriptor.lock
    && h2Exact(value.source, sourceKeys) && value.source.kind === 'USER_WEB_CONTROLLER'
    && h2SafeLine(value.source.reference, 2048) && h2Hash(value.source.body_sha256)
    && h2Repository(value.repository) && h2Issue(value.pr_number)
    && h2Hash(value.descriptor_sha256) && h2Repository(value.candidate?.repository), true, 'BOUND_AUTHORITY_INVALID', stage);
  const normalizedDescriptor = h2Descriptor(descriptor, stage);
  h2Candidate(value.candidate, stage);
  h2Require(value.repository === normalizedDescriptor.repository
    && value.candidate.repository === normalizedDescriptor.candidate.repository
    && value.descriptor_sha256 === h2Digest(normalizedDescriptor)
    && h2Comparable(value.candidate, normalizedDescriptor.candidate), true, 'BOUND_AUTHORITY_INVALID', stage);
  h2Require(value.authority_sha256 === h2Digest(h2Without(value, 'authority_sha256')), true, 'BOUND_AUTHORITY_INVALID', stage);
  h2Require(h2Audit(value), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  return h2Clone(value);
}
function h2ValidateCompleteRead(value) {
  const keys = ['body', 'complete', 'byte_length', 'body_sha256', 'revision'];
  h2Require(h2Exact(value, keys) && typeof value.body === 'string' && value.complete === true
    && Number.isSafeInteger(value.byte_length) && value.byte_length >= 0
    && h2Hash(value.body_sha256) && (value.revision === null || typeof value.revision === 'string'), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  h2Require(h2NoMalformedUnicode(value.body) && !value.body.includes('\uFEFF'), true, 'COMPLETE_READ_INVALID', 'COMPLETE_READ');
  h2Require(!h2ForbiddenUnicode(value.body), true, 'COMPLETE_READ_INVALID', 'COMPLETE_READ');
  const bytes = Buffer.byteLength(value.body, 'utf8');
  h2Require(bytes === value.byte_length, true, 'COMPLETE_READ_BYTE_LENGTH_MISMATCH', 'COMPLETE_READ');
  h2Require(sha256Text(value.body) === value.body_sha256, true, 'COMPLETE_READ_DIGEST_MISMATCH', 'COMPLETE_READ');
  h2Require(value.revision === null || h2SafeLine(value.revision), true, 'COMPLETE_READ_INVALID', 'COMPLETE_READ');
  return h2Clone(value);
}
function h2CompleteRead(body, revision = null) {
  h2Require(typeof body === 'string' && h2NoMalformedUnicode(body), true, 'COMPLETE_READ_INVALID', 'COMPLETE_READ');
  return {
    body,
    complete: true,
    byte_length: Buffer.byteLength(body, 'utf8'),
    body_sha256: sha256Text(body),
    revision: revision === undefined ? null : revision,
  };
}

function h2Count(body, token) {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = body.indexOf(token, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + token.length;
  }
}
function h2StrictCarrierText(encoded) {
  return typeof encoded === 'string' && encoded.length > 0 && encoded.length % 4 !== 1
    && /^[A-Za-z0-9_-]+$/.test(encoded);
}
function h2DecodeCarrier(encoded) {
  h2Require(h2StrictCarrierText(encoded), true, 'CARRIER_INVALID', 'PARSE');
  let decoded;
  try { decoded = Buffer.from(encoded, 'base64url').toString('utf8'); } catch (_error) { throw h2Error('CARRIER_INVALID', 'PARSE'); }
  h2Require(h2NoMalformedUnicode(decoded) && !decoded.includes('\uFEFF'), true, 'CARRIER_INVALID', 'PARSE');
  h2Require(Buffer.from(decoded, 'utf8').toString('base64url') === encoded, true, 'CARRIER_INVALID', 'PARSE');
  let value;
  try { value = JSON.parse(decoded); } catch (_error) { throw h2Error('CARRIER_INVALID', 'PARSE'); }
  let canonical;
  try { canonical = h2Canonical(value); } catch (_error) { throw h2Error('CARRIER_INVALID', 'PARSE'); }
  h2Require(canonical === decoded && h2Audit(value), true, 'CARRIER_INVALID', 'PARSE');
  return value;
}
function h2MarkerStyleForState(state) {
  return state?.schema === STATE_SCHEMA ? H2_MARKERS.toolkit : H2_MARKERS.generic;
}
function h2MarkerStyleForRepository(repository) {
  return repository === REPOSITORY ? H2_MARKERS.toolkit : H2_MARKERS.generic;
}
function h2Classifier(body) {
  h2Require(typeof body === 'string', true, 'BODY_NOT_STRING', 'CLASSIFY');
  h2Require(!body.includes('\r'), true, 'HUMAN_LINE_ENDING_INVALID', 'CLASSIFY');
  const humanVariants = [];
  for (const namespace of ['generic', 'toolkit']) {
    for (const kind of ['parent', 'child', 'pr']) {
      const marker = H2_MARKERS[namespace][kind];
      const beginCount = h2Count(body, marker.begin);
      const carrierCount = h2Count(body, marker.carrier);
      const endCount = h2Count(body, marker.end);
      if (beginCount || carrierCount || endCount) humanVariants.push({ namespace, kind, marker, beginCount, carrierCount, endCount });
    }
  }
  const hasHumanStem = body.includes('MANAGED-PROGRAM-') || humanVariants.length > 0;
  const hasToolkitStem = body.includes('AI-AGENT-TOOLKIT:GITHUB-PROGRAM-');
  const hasHumanVersion = /(?:MANAGED-PROGRAM-|GITHUB-PROGRAM-)[^\n]*human-v/i.test(body);
  if (body.includes('human-v1')) throw h2Error('HUMAN_V1_UNSUPPORTED', 'CLASSIFY');
  if (humanVariants.length > 0 || hasHumanVersion && hasHumanStem) {
    h2Require(humanVariants.length > 0, true, 'HUMAN_VERSION_UNSUPPORTED', 'CLASSIFY');
    const namespaces = new Set(humanVariants.map((item) => item.namespace));
    const kinds = new Set(humanVariants.map((item) => item.kind));
    h2Require(namespaces.size === 1, true, 'MARKER_MIXED_NAMESPACE', 'CLASSIFY');
    h2Require(kinds.size === 1, true, 'MARKER_MIXED_KIND', 'CLASSIFY');
    const selected = humanVariants[0];
    h2Require(selected.beginCount === 1 && selected.carrierCount === 1 && selected.endCount === 1,
      true, selected.beginCount > 1 || selected.carrierCount > 1 || selected.endCount > 1 ? 'MARKER_DUPLICATE' : 'MARKER_PARTIAL', 'CLASSIFY');
    h2Require(!hasToolkitStem || selected.namespace === 'toolkit', true, 'MARKER_MIXED_NAMESPACE', 'CLASSIFY');
    h2Require(!body.endsWith('\n'), true, 'MARKER_FINAL_NEWLINE', 'CLASSIFY');
    h2Require(body.startsWith(selected.marker.begin), true, 'MARKER_PREFIX', 'CLASSIFY');
    h2Require(body.endsWith(selected.marker.end), true, 'MARKER_SUFFIX', 'CLASSIFY');
    const lines = body.split('\n');
    h2Require(lines.length >= 3 && lines[0] === selected.marker.begin && lines[lines.length - 1] === selected.marker.end,
      true, 'MARKER_ORDER_INVALID', 'CLASSIFY');
    const carrierLine = lines[lines.length - 2];
    h2Require(carrierLine.startsWith(selected.marker.carrier) && carrierLine.endsWith(' -->'), true, 'CARRIER_INVALID', 'CLASSIFY');
    const encoded = carrierLine.slice(selected.marker.carrier.length, -4);
    h2Require(h2StrictCarrierText(encoded), true, 'CARRIER_INVALID', 'CLASSIFY');
    const expectedStem = selected.namespace === 'toolkit' ? H2_RESERVED_STEMS[0] : H2_RESERVED_STEMS[1];
    const otherStem = selected.namespace === 'toolkit' ? H2_RESERVED_STEMS[1] : H2_RESERVED_STEMS[0];
    h2Require(h2Count(body, expectedStem) === 3 && h2Count(body, otherStem) === 0, true, 'RESERVED_RESIDUE', 'CLASSIFY');
    for (const line of lines.slice(1, -2)) h2Require(!H2_RESERVED_STEMS.some((stem) => line.includes(stem)), true, 'RESERVED_RESIDUE', 'CLASSIFY');
    return { format: 'human-v2', namespace: selected.namespace, kind: selected.kind, marker: selected.marker, lines, encoded };
  }
  const legacy = [];
  for (const kind of ['parent', 'child']) {
    const marker = MANAGED_MARKERS[kind];
    const begin = h2Count(body, marker.begin);
    const end = h2Count(body, marker.end);
    const carrier = kind === 'parent'
      ? h2Count(body, 'AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v5 ')
      : h2Count(body, 'AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 ');
    if (begin || end || carrier) legacy.push({ kind, begin, end, carrier });
  }
  if (legacy.length > 0) {
    h2Require(legacy.length === 1, true, 'MARKER_MIXED_KIND', 'CLASSIFY');
    const selected = legacy[0];
    const known = selected.kind === 'parent' ? H2_LEGACY_PARENT_DIGESTS : H2_LEGACY_CHILD_DIGESTS;

    h2Require(known.has(sha256Text(body)), true, 'LEGACY_BODY_NOT_FROZEN', 'CLASSIFY');
    h2Require(selected.begin === 1 && selected.end === 1 && selected.carrier === 1, true, 'MARKER_PARTIAL', 'CLASSIFY');
    h2Require(!body.includes('MANAGED-PROGRAM-'), true, 'MARKER_MIXED_NAMESPACE', 'CLASSIFY');
    return { format: 'legacy-v5', namespace: 'toolkit', kind: selected.kind };
  }
  if (hasHumanStem || hasToolkitStem) throw h2Error('BODY_UNRECOGNISED', 'CLASSIFY');
  throw h2Error('BODY_UNRECOGNISED', 'CLASSIFY');
}

const H2_LEGACY_PARENT_DIGESTS = new Set([
  SOURCE_PARENT_BODY_DIGEST,
  FINALISATION_SOURCE_PARENT_BODY_DIGEST,
  sha256Text(FINALISATION_STAGE_A_RENDERED.parent),
  sha256Text(FINALISATION_STAGE_B_RENDERED.parent),
]);
const H2_LEGACY_CHILD_DIGESTS = new Set([
  SOURCE_CHILD_BODY_DIGEST,
  FINALISATION_SOURCE_CHILD_BODY_DIGEST,
  sha256Text(FINALISATION_STAGE_A_RENDERED.child),
  sha256Text(FINALISATION_STAGE_B_RENDERED.child),
]);

function h2ValidateEpoch(value) {
  const required = ['evidence_ref', 'id', 'name', 'purpose', 'terminal_disposition'];
  const optional = ['gates', 'lock', 'state', 'status'];
  return h2IsPlain(value) && h2Exact(value, [...required, ...optional])
    && (value.evidence_ref === null || h2SafeId(value.evidence_ref))
    && h2SafeId(value.id) && h2SafeLine(value.name) && h2SafeLine(value.purpose)
    && (value.terminal_disposition === null || ['ACCEPTED', 'REJECTED', 'NON_CONVERGENT', 'AMEND'].includes(value.terminal_disposition))
    && (!h2Own(value, 'gates') || h2StringArray(value.gates, 256))
    && (!h2Own(value, 'lock') || h2SafeId(value.lock, 1024))
    && (!h2Own(value, 'state') || h2SafeLine(value.state, 128))
    && (!h2Own(value, 'status') || h2SafeLine(value.status, 128));
}
function h2ValidateEvidence(value) {
  return h2IsPlain(value) && h2Exact(value, ['id', 'kind', 'reference', 'summary'])
    && h2SafeId(value.id) && ['WEB', 'USER_WEB_CONTROLLER', 'COMMIT', 'CHECK'].includes(value.kind)
    && h2SafeLine(value.reference, 2048) && h2SafeLine(value.summary);
}
function h2ValidateLegacyDescriptor(value) {
  const required = ['changed_surfaces', 'child_issue', 'design_constraints', 'eli5', 'evidence_refs', 'number', 'out_of_scope', 'purpose', 'scope', 'summary', 'validation_requirements'];
  const optional = ['candidate', 'schema', 'repository'];
  return h2IsPlain(value) && h2Exact(value, [...required, ...optional])
    && h2StringArray(value.changed_surfaces) && h2Issue(value.child_issue)
    && h2StringArray(value.design_constraints) && h2SafeLine(value.eli5)
    && h2StringArray(value.evidence_refs) && h2Issue(value.number)
    && h2StringArray(value.out_of_scope) && h2SafeLine(value.purpose)
    && h2StringArray(value.scope) && h2SafeLine(value.summary)
    && h2StringArray(value.validation_requirements)
    && (!h2Own(value, 'schema') || value.schema === H2_DESCRIPTOR_SCHEMA)
    && (!h2Own(value, 'repository') || h2Repository(value.repository))
    && (!h2Own(value, 'candidate') || value.candidate === null || (() => { try { h2Candidate(value.candidate, 'CANONICAL'); return true; } catch (_error) { return false; } })());
}
function h2ValidateRegistry(value, legacy = false) {
  const required = ['accepted_evidence_ref', 'completes_child', 'epoch_id', 'pr', 'retirement_evidence_ref', 'role', 'status'];
  const optional = ['candidate', 'draft', 'github_state', 'merged', 'retention_evidence_ref'];
  if (!h2IsPlain(value) || !h2Exact(value, [...required, ...optional]) || !h2Issue(value.pr)
    || !h2SafeId(value.epoch_id) || typeof value.completes_child !== 'boolean'
    || value.role !== 'INTERMEDIATE' || !['ACTIVE', 'ACCEPTED', 'RETIRED', 'RETAINED'].includes(value.status)) return false;
  for (const key of ['accepted_evidence_ref', 'retirement_evidence_ref', 'retention_evidence_ref']) {
    if (h2Own(value, key) && value[key] !== null && !h2SafeId(value[key])) return false;
  }
  for (const key of ['draft', 'merged']) if (h2Own(value, key) && typeof value[key] !== 'boolean') return false;
  if (h2Own(value, 'github_state') && !['OPEN', 'CLOSED', 'MERGED'].includes(value.github_state)) return false;
  if (h2Own(value, 'candidate') && value.candidate !== null) {
    try { h2Candidate(value.candidate, 'RELATIONSHIP'); } catch (_error) { return false; }
  }
  if (!legacy && (!h2Own(value, 'draft') || !h2Own(value, 'merged') || !h2Own(value, 'github_state') || !h2Own(value, 'candidate') || value.candidate === null)) return false;
  return true;
}
function h2ValidateFinality(value) {
  return h2IsPlain(value) && (h2Exact(value, ['state']) || h2Exact(value, ['authority_ref', 'state']))
    && ['HELD', 'MERGED', 'UNMERGED'].includes(value.state)
    && (!h2Own(value, 'authority_ref') || value.authority_ref === null || h2SafeId(value.authority_ref));
}
function h2ValidateChild(value, legacy = false) {
  const required = ['boundaries', 'done_when', 'eli5', 'epochs', 'finality', 'issue', 'lifecycle', 'objective', 'order', 'out_of_scope', 'pr_registry', 'scope', 'summary', 'title'];
  const optional = ['dependencies', 'holds', 'deliverables'];
  if (!h2IsPlain(value) || !h2Exact(value, [...required, ...optional])
    || !h2Issue(value.issue) || !Number.isSafeInteger(value.order) || value.order < 1
    || !['COMPLETED', 'CURRENT', 'QUEUED'].includes(value.lifecycle)
    || !h2SafeLine(value.title) || !h2SafeLine(value.summary) || !h2SafeLine(value.objective) || !h2SafeLine(value.eli5)
    || !h2StringArray(value.scope) || !h2StringArray(value.boundaries) || !h2StringArray(value.out_of_scope)
    || !h2StringArray(value.done_when) || !Array.isArray(value.epochs) || !value.epochs.every(h2ValidateEpoch)
    || !h2ValidateFinality(value.finality) || !Array.isArray(value.pr_registry)
    || !value.pr_registry.every((item) => h2ValidateRegistry(item, legacy))) return false;
  if (h2Own(value, 'dependencies') && (!Array.isArray(value.dependencies) || !value.dependencies.every(h2Issue))) return false;
  if (h2Own(value, 'holds') && !Array.isArray(value.holds)) return false;
  if (h2Own(value, 'deliverables') && !h2StringArray(value.deliverables)) return false;
  return true;
}
function h2ValidateGenericState(value) {
  const required = ['active_lanes', 'children', 'evidence_refs', 'historical_transitions', 'parent', 'prs', 'repository', 'schema'];
  const optional = ['design_lock', 'extensions', 'dependencies', H2_HISTORY_KEY];
  if (!h2IsPlain(value) || !h2Exact(value, [...required, ...optional]) || !h2Repository(value.repository)
    || !h2SafeLine(value.schema) || !h2IsPlain(value.parent) || !h2Exact(value.parent, ['goal', 'issue', 'title'])
    || !h2Issue(value.parent.issue) || !h2SafeLine(value.parent.title) || !h2SafeLine(value.parent.goal)
    || !Array.isArray(value.children) || value.children.length === 0
    || !Array.isArray(value.prs) || !Array.isArray(value.evidence_refs)
    || !Array.isArray(value.historical_transitions) || !Array.isArray(value.active_lanes)) return false;
  if (h2Own(value, 'design_lock') && !h2SafeLine(value.design_lock, 1024)) return false;
  if (h2Own(value, 'extensions') && (!Array.isArray(value.extensions) || !value.extensions.every(h2IsPlain))) return false;
  const issues = new Set();
  const orders = new Set();
  let current = 0;
  for (const child of value.children) {
    if (!h2ValidateChild(child, false) || issues.has(child.issue) || orders.has(child.order)) return false;
    issues.add(child.issue); orders.add(child.order); if (child.lifecycle === 'CURRENT') current += 1;
    const epochs = new Set();
    for (const epoch of child.epochs) { if (epochs.has(epoch.id)) return false; epochs.add(epoch.id); }
  }
  const allCompleted = value.children.every((child) => child.lifecycle === 'COMPLETED' && child.finality.state === 'MERGED');
  if (current !== 1 && !(current === 0 && allCompleted && value.evidence_refs.some((item) => item.kind === 'WEB' || item.kind === 'USER_WEB_CONTROLLER'))) throw h2Error('CANONICAL_STATE_CONTRADICTION', 'CANONICAL');
  if (!value.prs.every((item) => h2ValidateLegacyDescriptor(item) || (() => { try { h2Descriptor(item, 'CANONICAL'); return true; } catch (_error) { return false; } })())) return false;
  if (!value.evidence_refs.every(h2ValidateEvidence)) return false;
  if (!value.historical_transitions.every((item) => h2IsPlain(item) && h2Exact(item, ['child_issue', 'disposition', 'epoch_id', 'evidence_ref', 'gate', 'id'])
    && h2Issue(item.child_issue) && h2SafeId(item.disposition) && h2SafeId(item.epoch_id) && h2SafeId(item.evidence_ref) && h2SafeId(item.gate) && h2SafeId(item.id))) return false;
  for (const lane of value.active_lanes) {
    if (!h2IsPlain(lane) || !h2Issue(lane.child_issue ?? lane.child)) return false;
    const child = value.children.find((item) => item.issue === (lane.child_issue ?? lane.child));
    if (!child || child.lifecycle !== 'CURRENT') return false;
  }
  return true;
}
function h2ValidateToolkitState(value) {
  if (value.schema !== STATE_SCHEMA) return false;
  const base = h2Clone(value);
  delete base[H2_HISTORY_KEY];
  const valid = validateCanonicalStateV5(base);
  if (!valid.ok) return false;
  return true;
}

function h2ValidateHistoryEntry(value, sourceRepository = null) {
  const keys = ['descriptor', 'bound_authority', 'registry'];
  h2Require(h2Exact(value, keys), true, 'HISTORY_ENTRY_INVALID', 'HISTORY');
  const descriptor = h2Descriptor(value.descriptor, 'HISTORY');
  const authority = h2BoundAuthority(value.bound_authority, descriptor, 'HISTORY');
  h2Require(authority.root === H2_ROOT && authority.lock === H2_LOCK
    && authority.repository === descriptor.repository && authority.candidate.repository === descriptor.repository
    && authority.pr_number >= 1, true, 'HISTORY_ENTRY_INVALID', 'HISTORY');
  const registry = value.registry;
  h2Require(h2Exact(registry, ['child_issue', 'entry']) && registry.child_issue === descriptor.child_issue
    && h2ValidateRegistry(registry.entry, false), true, 'HISTORY_ENTRY_INVALID', 'HISTORY');
  h2Require(registry.entry.pr === authority.pr_number && registry.entry.epoch_id === descriptor.epoch_id
    && h2Comparable(registry.entry.candidate, descriptor.candidate)
    && (sourceRepository === null || descriptor.repository === sourceRepository), true, 'HISTORY_ENTRY_INVALID', 'HISTORY');
  h2Require(h2Audit(value), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  return { descriptor, authority, registry: { child_issue: registry.child_issue, entry: h2Clone(registry.entry) } };
}
function h2ValidateHistoryContainer(value, sourceRepository = null) {
  if (value === undefined) return { pr_history: [], evidence_refs: [], transitions: [] };
  h2Require(h2Exact(value, ['schema', 'pr_history', 'evidence_refs', 'transitions']) && value.schema === H2_HISTORY_SCHEMA
    && Array.isArray(value.pr_history) && Array.isArray(value.evidence_refs) && Array.isArray(value.transitions), true, 'HISTORY_INVALID', 'RELATIONSHIP');
  const entries = value.pr_history.map((item) => h2ValidateHistoryEntry(item, sourceRepository));
  for (let index = 1; index < entries.length; index += 1) h2Require(entries[index - 1].authority.pr_number < entries[index].authority.pr_number, true, 'HISTORY_ORDER_INVALID', 'RELATIONSHIP');
  const evidence = value.evidence_refs.map((item) => {
    h2Require(h2ValidateEvidence(item), true, 'HISTORY_EVIDENCE_INVALID', 'RELATIONSHIP');
    return h2Clone(item);
  });
  for (let index = 1; index < evidence.length; index += 1) h2Require(evidence[index - 1].id < evidence[index].id, true, 'HISTORY_ORDER_INVALID', 'RELATIONSHIP');
  const transitions = value.transitions.map((item) => {
    h2Require(h2IsPlain(item) && h2Exact(item, ['id', 'child_issue', 'epoch_id', 'gate', 'disposition', 'evidence_ref'])
      && h2SafeId(item.id) && h2Issue(item.child_issue) && h2SafeId(item.epoch_id) && h2SafeId(item.gate)
      && h2SafeId(item.disposition) && h2SafeId(item.evidence_ref), true, 'HISTORY_TRANSITION_INVALID', 'RELATIONSHIP');
    return h2Clone(item);
  });
  for (let index = 1; index < transitions.length; index += 1) h2Require(transitions[index - 1].id < transitions[index].id, true, 'HISTORY_ORDER_INVALID', 'RELATIONSHIP');
  const prs = new Set();
  for (const entry of entries) {
    h2Require(!prs.has(entry.authority.pr_number), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
    prs.add(entry.authority.pr_number);
  }
  const ids = new Set();
  for (const item of evidence) { h2Require(!ids.has(item.id), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP'); ids.add(item.id); }
  const transitionIds = new Set();
  for (const item of transitions) { h2Require(!transitionIds.has(item.id), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP'); transitionIds.add(item.id); }
  return { schema: H2_HISTORY_SCHEMA, pr_history: entries, evidence_refs: evidence, transitions };
}
function h2MergedEvidenceMap(state, history) {
  const map = new Map();
  for (const item of state.evidence_refs || []) {
    h2Require(!map.has(item.id), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
    map.set(item.id, item);
  }
  for (const item of history.evidence_refs) {
    h2Require(!map.has(item.id), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
    map.set(item.id, item);
  }
  return map;
}
function h2FindEpoch(state, childIssue, epochId) {
  const child = state.children.find((item) => item.issue === childIssue);
  return child?.epochs.find((item) => item.id === epochId) || null;
}
function h2Relationship(state, history, legacyCompatibilityOnly = false) {
  const evidence = h2MergedEvidenceMap(state, history);
  const childByIssueMap = new Map();
  for (const child of state.children) childByIssueMap.set(child.issue, child);
  const descriptorByPr = new Map();
  for (const descriptor of state.prs || []) {
    if (h2Own(descriptor, 'number')) {
      h2Require(!descriptorByPr.has(descriptor.number), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
      descriptorByPr.set(descriptor.number, { descriptor, legacy: true });
    }
  }
  const registryByPr = new Map();
  for (const child of state.children) {
    for (const entry of child.pr_registry || []) {
      h2Require(!registryByPr.has(entry.pr), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
      registryByPr.set(entry.pr, { entry, child });
      for (const ref of [entry.accepted_evidence_ref, entry.retirement_evidence_ref, entry.retention_evidence_ref]) {
        if (ref !== null && ref !== undefined) h2Require(evidence.has(ref) || legacyCompatibilityOnly, true, 'RELATIONSHIP_EVIDENCE_MISSING', 'RELATIONSHIP');
      }
    }
  }
  const newPrs = new Set();
  for (const item of history.pr_history) {
    const pr = item.authority.pr_number;
    h2Require(!newPrs.has(pr) && !descriptorByPr.has(pr) && !registryByPr.has(pr), true, 'RELATIONSHIP_DUPLICATE', 'RELATIONSHIP');
    newPrs.add(pr);
    const child = childByIssueMap.get(item.descriptor.child_issue);
    h2Require(child && h2FindEpoch(state, item.descriptor.child_issue, item.descriptor.epoch_id), true, 'RELATIONSHIP_REFERENT_MISSING', 'RELATIONSHIP');
    descriptorByPr.set(pr, { descriptor: item.descriptor, authority: item.authority, legacy: false });
    registryByPr.set(pr, { entry: item.registry.entry, child });
    for (const ref of item.descriptor.evidence_refs) h2Require(evidence.has(ref), true, 'RELATIONSHIP_EVIDENCE_MISSING', 'RELATIONSHIP');
    for (const ref of [item.registry.entry.accepted_evidence_ref, item.registry.entry.retirement_evidence_ref, item.registry.entry.retention_evidence_ref]) {
      if (ref !== null) h2Require(evidence.has(ref), true, 'RELATIONSHIP_EVIDENCE_MISSING', 'RELATIONSHIP');
    }
    const entry = item.registry.entry;
    if (entry.status === 'ACCEPTED') {
      h2Require(entry.accepted_evidence_ref !== null && ['WEB', 'USER_WEB_CONTROLLER'].includes(evidence.get(entry.accepted_evidence_ref).kind)
        && entry.retirement_evidence_ref === null && entry.retention_evidence_ref === null, true, 'RELATIONSHIP_ACCEPTANCE_INVALID', 'RELATIONSHIP');
    }
    if (entry.status === 'RETIRED') h2Require(entry.retirement_evidence_ref !== null && entry.accepted_evidence_ref === null, true, 'RELATIONSHIP_RETIREMENT_INVALID', 'RELATIONSHIP');
    if (entry.status === 'RETAINED') h2Require(entry.retention_evidence_ref !== null && entry.accepted_evidence_ref === null, true, 'RELATIONSHIP_RETENTION_INVALID', 'RELATIONSHIP');
    h2Require(entry.child_issue === undefined || entry.child_issue === item.descriptor.child_issue, true, 'RELATIONSHIP_CHILD_INVALID', 'RELATIONSHIP');
  }
  for (const [pr, record] of registryByPr) {
    const descriptor = descriptorByPr.get(pr);
    if (!descriptor) {
      const legacyRetainedGap = legacyCompatibilityOnly && ['RETIRED', 'RETAINED'].includes(record.entry.status);
      h2Require(legacyRetainedGap, true, 'RELATIONSHIP_DESCRIPTOR_MISSING', 'RELATIONSHIP');
      continue;
    }
    if (!descriptor.legacy) {
      h2Require(descriptor.descriptor.child_issue === record.child.issue
        && descriptor.descriptor.epoch_id === record.entry.epoch_id
        && h2Comparable(descriptor.descriptor.candidate, record.entry.candidate), true, 'RELATIONSHIP_DESCRIPTOR_REGISTRY_MISMATCH', 'RELATIONSHIP');
    } else if (h2Own(descriptor.descriptor, 'child_issue')) {
      h2Require(descriptor.descriptor.child_issue === record.child.issue, true, 'RELATIONSHIP_DESCRIPTOR_REGISTRY_MISMATCH', 'RELATIONSHIP');
      for (const ref of descriptor.descriptor.evidence_refs || []) h2Require(evidence.has(ref) || legacyCompatibilityOnly, true, 'RELATIONSHIP_EVIDENCE_MISSING', 'RELATIONSHIP');
    }
  }
  for (const item of state.historical_transitions || []) {
    h2Require(childByIssueMap.has(item.child_issue) && h2FindEpoch(state, item.child_issue, item.epoch_id)
      && (evidence.has(item.evidence_ref) || legacyCompatibilityOnly), true, 'RELATIONSHIP_REFERENT_MISSING', 'RELATIONSHIP');
  }
  for (const item of history.transitions) {
    h2Require(childByIssueMap.has(item.child_issue) && h2FindEpoch(state, item.child_issue, item.epoch_id)
      && evidence.has(item.evidence_ref), true, 'RELATIONSHIP_REFERENT_MISSING', 'RELATIONSHIP');
  }
  if (history.evidence_refs.length > 0) {
    const referenced = new Set();
    for (const item of history.pr_history) {
      for (const ref of item.descriptor.evidence_refs) referenced.add(ref);
      for (const ref of [item.registry.entry.accepted_evidence_ref, item.registry.entry.retirement_evidence_ref, item.registry.entry.retention_evidence_ref]) if (ref) referenced.add(ref);
    }
    for (const item of history.transitions) referenced.add(item.evidence_ref);
    for (const item of history.evidence_refs) h2Require(referenced.has(item.id), true, 'RELATIONSHIP_ORPHAN_EVIDENCE', 'RELATIONSHIP');
  }
  return { evidence, descriptorByPr, registryByPr };
}
function h2ValidateState(value) {
  h2Require(h2IsPlain(value), true, 'CANONICAL_STATE_INVALID', 'CANONICAL');
  h2Require(h2Audit(value), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  const history = h2ValidateHistoryContainer(value[H2_HISTORY_KEY], value.repository || null);
  const base = h2Clone(value);
  delete base[H2_HISTORY_KEY];
  let legacyCompatibilityOnly = false;
  if (value.schema === STATE_SCHEMA) {
    legacyCompatibilityOnly = h2ValidateToolkitState(value);
    h2Require(legacyCompatibilityOnly, true, 'CANONICAL_STATE_INVALID', 'CANONICAL');
  } else {
    h2Require(h2ValidateGenericState(base), true, 'CANONICAL_STATE_INVALID', 'CANONICAL');
  }
  h2Relationship(base, history, legacyCompatibilityOnly);
  return { state: h2Clone(value), canonical_sha256: h2Digest(value), history };
}

function h2BoundaryCategory(value) {
  const upper = String(value).toUpperCase();
  if (/SAFETY|HOLD|SECURITY|PRIVATE|SECRET/.test(upper)) return 'SAFETY';
  if (/NOT[_ -]?AUTHORI[ZS]ED|UNAUTHORI[ZS]ED|PROHIBIT|DENY|CANNOT/.test(upper)) return 'NOT_AUTHORISED';
  if (/OUT[_ -]?OF[_ -]?SCOPE|OUTSIDE/.test(upper)) return 'OUT_OF_SCOPE';
  if (/READY|MERGE|FINALITY|TRANSITION|WEB OWNS|AUTHORITY/.test(upper)) return 'OWNERSHIP_AUTHORITY';
  if (/LIFECYCLE|CURRENT CHILD|COMPLETION|FINAL/.test(upper)) return 'LIFECYCLE_FINALITY_RESTRICTION';
  return 'SCOPE';
}
function h2EvidenceMap(state, history) {
  const map = new Map();
  for (const item of state.evidence_refs || []) map.set(item.id, item);
  for (const item of history.evidence_refs || []) map.set(item.id, item);
  return map;
}
function h2ActiveHold(child) {
  return Array.isArray(child?.holds) && child.holds.some((hold) => h2IsPlain(hold)
    && hold.active === true && hold.blocks_normal_lanes === true);
}
function h2DependenciesMet(state, child) {
  const dependencies = Array.isArray(child.dependencies) ? child.dependencies : [];
  return dependencies.every((issue) => {
    const dependency = state.children.find((item) => item.issue === issue);
    return dependency && (dependency.lifecycle === 'COMPLETED' || dependency.finality.state === 'MERGED');
  });
}
function h2ChildAction(state, child, history) {
  if (!child) throw h2Error('CANONICAL_STATE_CONTRADICTION', 'LIFECYCLE');
  if (child.lifecycle === 'COMPLETED' || child.finality.state === 'MERGED') return { action: 'CHILD_COMPLETE', ref: null, text: 'The child is complete under source-backed terminal evidence.' };
  if (h2ActiveHold(child)) return { action: 'BLOCKING_HOLD', ref: null, text: 'A blocking hold keeps this child paused until its authority is resolved.' };
  if (child.lifecycle === 'QUEUED') {
    if (!h2DependenciesMet(state, child)) return { action: 'WAIT_DEPENDENCIES', ref: null, text: 'Declared dependencies are not complete, so this child remains queued.' };
    return { action: 'AWAIT_CHILD_AUTHORITY', ref: null, text: 'Dependencies are met, but separate child activation authority is still required.' };
  }
  const lanes = (state.active_lanes || []).filter((lane) => (lane.child_issue ?? lane.child) === child.issue);
  if (lanes.length > 0) return { action: 'CONTINUE_ACTIVE_GATE', ref: lanes[0].lane_id ?? lanes[0].id ?? null, text: 'Continue the already admitted active gate; no new lane is created.' };
  const registries = child.pr_registry || [];
  if (registries.some((entry) => entry.status === 'AMEND' || entry.github_state === 'AMEND')
    || child.epochs.some((epoch) => epoch.terminal_disposition === 'AMEND' || epoch.status === 'AMEND')) return { action: 'AMEND_REQUIRED', ref: null, text: 'The current candidate needs an amendment before the gate can continue.' };
  if (registries.some((entry) => ['REJECTED', 'NON_CONVERGENT'].includes(entry.status))
    || child.epochs.some((epoch) => ['REJECTED', 'NON_CONVERGENT'].includes(epoch.terminal_disposition) || epoch.status === 'NON_CONVERGENT')) return { action: 'REPLACEMENT_REQUIRED', ref: null, text: 'The current candidate is rejected or non-convergent; a replacement requires separate authority.' };
  const pending = child.epochs.filter((epoch) => epoch.terminal_disposition === null);
  if (pending.length > 0) {
    const admitted = pending.some((epoch) => registries.some((entry) => entry.epoch_id === epoch.id && ['ACTIVE', 'ACCEPTED', 'RETAINED'].includes(entry.status)));
    if (admitted) return { action: 'BEGIN_OR_CONTINUE_EPOCH', ref: pending[0].id, text: 'An admitted candidate exists for the next pending epoch; begin or continue only that epoch.' };
    return { action: 'AWAIT_EPOCH_AUTHORITY', ref: pending[0].id, text: 'The next epoch is pending separate authority; no activation is inferred.' };
  }
  return { action: 'AWAIT_CHILD_FINALITY', ref: null, text: 'All epochs are terminal, but source-backed child finality is not yet complete.' };
}
function h2ProgrammeAction(state, history) {
  const current = state.children.filter((child) => child.lifecycle === 'CURRENT');
  if (current.length > 1) throw h2Error('CANONICAL_STATE_CONTRADICTION', 'LIFECYCLE');
  const terminal = state.children.length > 0 && state.children.every((child) => child.lifecycle === 'COMPLETED' && child.finality.state === 'MERGED');
  const terminalEvidence = state.evidence_refs.some((item) => ['WEB', 'USER_WEB_CONTROLLER'].includes(item.kind)) || history.evidence_refs.some((item) => ['WEB', 'USER_WEB_CONTROLLER'].includes(item.kind));
  if (terminal && terminalEvidence) return { action: 'PROGRAMME_COMPLETE', current_child: null, child_action: null, ref: null, text: 'All children are complete under source-backed terminal evidence.' };
  if (current.length === 1) {
    const childAction = h2ChildAction(state, current[0], history);
    return { action: 'CONTINUE_CURRENT_CHILD', current_child: current[0].issue, child_action: childAction.action, ref: childAction.ref, text: childAction.text };
  }
  return { action: 'AWAIT_PROGRAMME_FINALITY', current_child: null, child_action: null, ref: null, text: 'No current child is selected; source-backed programme finality is still pending.' };
}
function h2ProjectionState(state, history) {
  const evidence = h2EvidenceMap(state, history);
  const children = state.children.map((child) => ({
    issue: child.issue,
    order: child.order,
    title: child.title,
    lifecycle: child.lifecycle,
    finality: child.finality.state,
    summary: child.summary,
  }));
  const boundaries = [];
  for (const item of state.boundaries || []) boundaries.push({ category: h2BoundaryCategory(item), text: item });
  for (const child of state.children) for (const item of child.boundaries || []) boundaries.push({ category: h2BoundaryCategory(item), text: item });
  const unique = new Set();
  const boundaryList = boundaries.filter((item) => { const key = item.category + '\u0000' + item.text; if (unique.has(key)) return false; unique.add(key); return true; });
  const current = state.children.find((child) => child.lifecycle === 'CURRENT') || null;
  const programme = h2ProgrammeAction(state, history);
  const childAction = current ? h2ChildAction(state, current, history) : null;
  const historyRows = history.pr_history.map((item) => ({
    pr: item.authority.pr_number,
    child_issue: item.descriptor.child_issue,
    epoch_id: item.descriptor.epoch_id,
    summary: item.descriptor.summary,
    outcome: item.registry.entry.status,
    evidence_refs: item.descriptor.evidence_refs,
  }));
  for (const descriptor of state.prs || []) if (h2Own(descriptor, 'number')) {
    const registry = state.children.flatMap((child) => child.pr_registry || []).find((entry) => entry.pr === descriptor.number);
    historyRows.unshift({ pr: descriptor.number, child_issue: descriptor.child_issue, epoch_id: registry?.epoch_id || null, summary: descriptor.summary, outcome: registry?.status || 'HISTORICAL', evidence_refs: descriptor.evidence_refs || [] });
  }
  historyRows.sort((left, right) => left.pr - right.pr);
  return {
    schema: H2_PARENT_PROJECTION_SCHEMA,
    version: H2_VERSION,
    kind: 'parent',
    repository: state.repository,
    parent_issue: state.parent.issue,
    title: state.parent.title,
    lifecycle: current ? 'ACTIVE' : (programme.action === 'PROGRAMME_COMPLETE' ? 'COMPLETED' : 'PENDING_FINALITY'),
    finality: programme.action === 'PROGRAMME_COMPLETE' ? 'MERGED' : (current?.finality.state || 'HELD'),
    programme_action: programme.action,
    current_child: current ? { issue: current.issue, title: current.title, lifecycle: current.lifecycle, finality: current.finality.state, summary: current.summary, action: childAction.action } : null,
    children,
    completed_work: children.filter((child) => child.lifecycle === 'COMPLETED'),
    boundaries: boundaryList,
    pr_history: historyRows,
    next_action: { action: programme.action, ref: programme.ref, text: programme.text },
    evidence_count: evidence.size,
  };

}
function h2ProjectionChild(state, history, childIssue) {
  const child = state.children.find((item) => item.issue === childIssue);
  h2Require(child, true, 'CHILD_NOT_FOUND', 'CANONICAL');
  const evidence = h2EvidenceMap(state, history);
  const action = h2ChildAction(state, child, history);
  const epochs = child.epochs.map((epoch) => {
    const evidenceItem = epoch.evidence_ref ? evidence.get(epoch.evidence_ref) : null;
    const active = (state.active_lanes || []).find((lane) => (lane.child_issue ?? lane.child) === child.issue && (lane.epoch_id ?? lane.epoch) === epoch.id);
    return { id: epoch.id, name: epoch.name, purpose: epoch.purpose, state: epoch.terminal_disposition || (active ? 'ACTIVE' : 'PENDING'), outcome: epoch.terminal_disposition || evidenceItem?.summary || (active ? 'Active gate admitted.' : 'Awaiting authority or completion.'), evidence_ref: epoch.evidence_ref || null };
  });
  const rows = [];
  for (const descriptor of state.prs || []) if (h2Own(descriptor, 'number') && descriptor.child_issue === child.issue) {
    const registry = child.pr_registry.find((entry) => entry.pr === descriptor.number);
    rows.push({ pr: descriptor.number, epoch_id: registry?.epoch_id || null, outcome: registry?.status || 'HISTORICAL', summary: descriptor.summary });
  }
  for (const item of history.pr_history) if (item.descriptor.child_issue === child.issue) rows.push({ pr: item.authority.pr_number, epoch_id: item.descriptor.epoch_id, outcome: item.registry.entry.status, summary: item.descriptor.summary });
  rows.sort((left, right) => left.pr - right.pr);
  return {
    schema: H2_CHILD_PROJECTION_SCHEMA,
    version: H2_VERSION,
    kind: 'child',
    repository: state.repository,
    parent_issue: state.parent.issue,
    child_issue: child.issue,
    title: child.title,
    lifecycle: child.lifecycle,
    summary: child.summary,
    objective: child.objective,
    scope: child.scope,
    boundaries: [...(child.boundaries || []), ...(child.out_of_scope || []).map((item) => 'Out of scope: ' + item)].map((text) => ({ category: h2BoundaryCategory(text), text })),
    done_when: child.done_when,
    out_of_scope: child.out_of_scope,
    eli5: child.eli5,
    finality: child.finality.state,
    epochs,
    pr_history: rows,
    next_action: { action: action.action, ref: action.ref, text: action.text },
  };
}
function h2Line(type, value, field) {
  if (['heading', 'paragraph', 'bullet', 'table_cell'].includes(type)) {
    h2Require(typeof value === 'string' && h2AuditScalar(value), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    h2Require(!value.includes('\n') && !value.includes('\r'), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    return { type, value };
  }
  if (type === 'identifier') {
    h2Require(h2Issue(value) || (typeof value === 'string' && h2AuditScalar(value) && !/[\r\n]/.test(value)), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    return { type, value };
  }
  if (type === 'lineage') {
    h2Require(['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version'].includes(field)
      && typeof value === 'string' && h2AuditScalar(value) && !/[\r\n]/.test(value), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    return { type, field, value };
  }
  if (type === 'url') {
    h2Require(typeof value?.href === 'string' && typeof value?.label === 'string', true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    h2Require(h2AuditScalar(value.href) && h2AuditScalar(value.label) && !/[\r\n]/.test(value.href + value.label), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
    return { type, href: value.href, label: value.label };
  }
  throw h2Error('PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
}
function h2EncodeText(value, context) {
  const node = h2Line(context === 'cell' ? 'table_cell' : context, value);
  const original = node.value;
  let result = '';
  for (const character of original) {
    const code = character.codePointAt(0);
    if (character === '&') result += '&amp;';
    else if (character === '<') result += '&#60;';
    else if (character === '>') result += '&#62;';
    else if (H2_TEXT_PUNCTUATION(code)) result += '\\' + character;
    else result += character;
  }
  return result;
}
function h2Cell(value) { return h2EncodeText(String(value), 'cell'); }
function h2Paragraph(value) { return h2EncodeText(String(value), 'paragraph'); }
function h2Heading(value) { return h2EncodeText(String(value), 'heading'); }
function h2Bullet(value) { return '- ' + h2EncodeText(String(value), 'bullet'); }
function h2Identifier(value) { return h2EncodeText(String(value), 'identifier'); }
function h2Lineage(value, field = 'branch') {
  h2Line('lineage', String(value), field);
  return h2EncodeText(String(value), 'paragraph');
}
function h2DecodeUrlComponent(value) {
  try { return decodeURIComponent(value); } catch (_error) { throw h2Error('PUBLIC_URL_INVALID', 'PUBLIC_AUDIT'); }
}
function h2UrlPart(value, allowed) {
  let result = '';
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (character === '%') {
      h2Require(index + 2 < value.length && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3)), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
      result += '%' + value.slice(index + 1, index + 3).toUpperCase();
      index += 3;
      continue;
    }
    const code = value.codePointAt(index);
    const fullCharacter = String.fromCodePoint(code);
    const length = fullCharacter.length;
    if (code <= 0x7f && allowed.includes(character)) result += character;
    else {
      const encoded = encodeURIComponent(String.fromCodePoint(code)).replace(/%[0-9a-f]{2}/gi, (part) => part.toUpperCase());
      result += encoded;
    }
    index += length;
  }
  return result;
}
function h2HostIsPrivate(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
    || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return true;
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const ipv4 = host.split('.');
  if (ipv4.length === 4 && ipv4.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
    const [a, b] = ipv4.map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
  }
  return !host.includes('.') && !host.includes(':');
}
function h2CanonicalUrl(value) {
  h2Require(typeof value === 'string' && h2NoMalformedUnicode(value) && !/[\r\n\t]/.test(value), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  for (let index = 0; index < value.length; index += 1) if (value[index] === '%') h2Require(/^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3)), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw h2Error('PUBLIC_URL_INVALID', 'PUBLIC_AUDIT'); }
  h2Require(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !h2HostIsPrivate(parsed.hostname), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  const decoded = h2DecodeUrlComponent(parsed.pathname + parsed.search + parsed.hash);
  h2Require(h2AuditScalar(decoded), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port && parsed.port !== '443' ? ':' + parsed.port : '';
  const pathname = h2UrlPart(parsed.pathname || '/', "-._~!$&'()*+,;=:@/");
  const searchValue = parsed.search.startsWith('?') ? parsed.search.slice(1) : '';
  const hashValue = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
  const search = searchValue === '' ? '' : '?' + h2UrlPart(searchValue, "-._~!$&'()*+,;=:@/?");
  const hash = hashValue === '' ? '' : '#' + h2UrlPart(hashValue, "-._~!$&'()*+,;=:@/?");
  const rebuilt = 'https://' + host + port + pathname + search + hash;
  h2Require(!/[\u0000-\u0020<>"\\\u007f]/.test(rebuilt), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  h2Require(!H2_SECRET_VALUE.test(h2DecodeUrlComponent(searchValue + hashValue)), true, 'PUBLIC_URL_INVALID', 'PUBLIC_AUDIT');
  return rebuilt;
}
function h2UrlNode(href, label) {
  const canonical = h2CanonicalUrl(href);
  h2Line('url', { href, label });
  return '[' + h2EncodeText(label, 'paragraph') + '](<' + canonical + '>)';
}
function h2LinesForArray(values, empty = 'None recorded.') {
  return values.length ? values.map((item) => {
    const text = String(item);
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? h2UrlNode(text, text) : h2Bullet(item);
  }) : [h2Paragraph(empty)];
}
function h2ManagedDocument(style, kind, prose, carrier) {
  const marker = style[kind];
  h2Require(Array.isArray(prose) && prose.every((line) => typeof line === 'string' && !/[\r\n]/.test(line)), true, 'PUBLIC_NODE_INVALID', 'PUBLIC_AUDIT');
  for (const line of prose) h2Require(!H2_RESERVED_STEMS.some((stem) => line.includes(stem)), true, 'RESERVED_RESIDUE', 'PUBLIC_AUDIT');
  const proseDigest = h2DigestText(prose.join('\n'));
  const finalizedCarrier = { ...carrier, public_prose_sha256: proseDigest };
  h2Require(h2Audit(finalizedCarrier), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  const encoded = Buffer.from(h2Canonical(finalizedCarrier), 'utf8').toString('base64url');
  h2Require(h2StrictCarrierText(encoded), true, 'CARRIER_INVALID', 'SERIALIZE');
  const body = [marker.begin, ...prose, marker.carrier + encoded + ' -->', marker.end].join('\n');
  h2Require(body.startsWith(marker.begin) && body.endsWith(marker.end) && !body.endsWith('\n'), true, 'SERIALIZE', 'SERIALIZE');
  return {
    body,
    carrier: finalizedCarrier,
    carrier_sha256: h2Digest(finalizedCarrier),
    managed_block_sha256: sha256Text(body),
    public_prose_sha256: proseDigest,
    encoded,
    marker,
    prose,
  };
}
function h2ParentProse(state, projection) {
  const lines = [
    '# AI Agent Toolkit Programme',
    '',
    '## Programme status',
    '| Field | Value |',
    '| --- | --- |',
    '| Repository | ' + h2Cell(projection.repository) + ' |',
    '| Parent issue | #' + h2Identifier(projection.parent_issue) + ' |',
    '| Lifecycle | ' + h2Cell(projection.lifecycle) + ' |',
    '| Finality | ' + h2Cell(projection.finality) + ' |',
    '| Programme action | ' + h2Cell(projection.programme_action) + ' |',
    '',
    '## Children',
    '| Issue | Order | Lifecycle | Finality | Summary |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const child of projection.children) lines.push('| #' + h2Identifier(child.issue) + ' | ' + h2Identifier(child.order) + ' | ' + h2Cell(child.lifecycle) + ' | ' + h2Cell(child.finality) + ' | ' + h2Cell(child.summary) + ' |');
  lines.push('', '## Current action', h2Bullet(projection.next_action.action + ': ' + projection.next_action.text), '');
  lines.push('## Completed work', ...h2LinesForArray(projection.completed_work.map((item) => '#' + item.issue + ' - ' + item.title + ': ' + item.summary)), '');
  lines.push('## Boundaries', ...h2LinesForArray(projection.boundaries.map((item) => '[' + item.category + '] ' + item.text)), '');
  lines.push('## PR history', '| PR | Child | Epoch | Outcome | Summary |', '| --- | --- | --- | --- | --- |');
  if (projection.pr_history.length) for (const item of projection.pr_history) lines.push('| #' + h2Identifier(item.pr) + ' | #' + h2Identifier(item.child_issue) + ' | ' + h2Cell(item.epoch_id || '-') + ' | ' + h2Cell(item.outcome) + ' | ' + h2Cell(item.summary) + ' |');
  else lines.push('| None | - | - | None recorded | - |');
  lines.push('', '## ELI5', h2Paragraph('The parent is the one source of programme truth; child and PR views are derived from it.'), '');
  lines.push('## Immediate next', h2Bullet(projection.next_action.text));
  return lines;
}
function h2ChildProse(projection) {
  const lines = [
    '# ' + h2Heading(projection.title),
    '',
    '## Status / summary',
    '| Field | Value |',
    '| --- | --- |',
    '| Repository | ' + h2Cell(projection.repository) + ' |',
    '| Parent | #' + h2Identifier(projection.parent_issue) + ' |',
    '| Child | #' + h2Identifier(projection.child_issue) + ' |',
    '| Lifecycle | ' + h2Cell(projection.lifecycle) + ' |',
    '| Finality | ' + h2Cell(projection.finality) + ' |',
    '',
    h2Paragraph(projection.summary),
    '',
    '## Objective', h2Paragraph(projection.objective),
    '',
    '## Scope', ...h2LinesForArray(projection.scope),
    '',
    '## Boundaries', ...h2LinesForArray(projection.boundaries.map((item) => '[' + item.category + '] ' + item.text)),
    '',
    '## Completion criteria', ...h2LinesForArray(projection.done_when),
    '',
    '## Out of scope', ...h2LinesForArray(projection.out_of_scope),
    '',
    '## Epochs / phases',
    '| Epoch | Name | State | Purpose | Outcome |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const epoch of projection.epochs) lines.push('| ' + h2Cell(epoch.id) + ' | ' + h2Cell(epoch.name) + ' | ' + h2Cell(epoch.state) + ' | ' + h2Cell(epoch.purpose) + ' | ' + h2Cell(epoch.outcome) + ' |');
  lines.push('', '## PR history', '| PR | Epoch | Outcome | Summary |', '| --- | --- | --- | --- |');
  if (projection.pr_history.length) for (const row of projection.pr_history) lines.push('| #' + h2Identifier(row.pr) + ' | ' + h2Cell(row.epoch_id || '-') + ' | ' + h2Cell(row.outcome) + ' | ' + h2Cell(row.summary) + ' |');
  else lines.push('| None | - | None recorded | - |');
  lines.push('', '## ELI5', h2Paragraph(projection.eli5), '', '## Immediate next', h2Bullet(projection.next_action.action + ': ' + projection.next_action.text));
  return lines;
}
function h2ProjectionNode(zone, field, type, value) {
  const nodeField = field.split('.').pop().replace(/\[[0-9]+\]$/, '');
  return { zone, field, node: h2Line(type, value, nodeField) };
}
function h2PhaseProjectionNodes(projection) {
  const nodes = [];
  const push = (zone, field, type, value) => nodes.push(h2ProjectionNode(zone, field, type, value));
  const current = projection.current_derived;
  push('CURRENT_DERIVED', 'current_derived.authority_presence', 'table_cell', current.authority_presence);
  push('CURRENT_DERIVED', 'current_derived.number_state', 'table_cell', current.number_state);
  push('CURRENT_DERIVED', 'current_derived.pr_number', current.pr_number === null ? 'table_cell' : 'identifier',
    current.pr_number === null ? 'pending provider assignment' : current.pr_number);
  push('CURRENT_DERIVED', 'current_derived.next_action', 'paragraph', current.next_action);
  const structural = projection.structural_provenance;
  const structuralValues = [
    ['root', 'table_cell', structural.root],
    ['lock', 'table_cell', structural.lock],
    ['repository', 'table_cell', structural.repository],
    ['parent_issue', 'identifier', structural.parent_issue],
    ['child_issue', 'identifier', structural.child_issue],
    ['epoch_id', 'table_cell', structural.epoch_id],
    ['gate', 'table_cell', structural.gate],
    ['role', 'table_cell', structural.role],
    ['completes_child', 'table_cell', String(structural.completes_child)],
    ['descriptor_sha256', 'table_cell', structural.descriptor_sha256],
    ['candidate_sha256', 'table_cell', structural.candidate_sha256],
  ];
  for (const [field, type, value] of structuralValues) push('STRUCTURAL_PROVENANCE', 'structural_provenance.' + field, type, value);
  for (const field of ['repository', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version']) {
    push('STRUCTURAL_PROVENANCE', 'structural_provenance.candidate.' + field, 'lineage', structural.candidate[field]);
  }
  if (structural.authority_source !== null) {
    push('STRUCTURAL_PROVENANCE', 'structural_provenance.authority_source.kind', 'table_cell', structural.authority_source.kind);
    push('STRUCTURAL_PROVENANCE', 'structural_provenance.authority_source.reference', 'table_cell', structural.authority_source.reference);
    push('STRUCTURAL_PROVENANCE', 'structural_provenance.authority_source.body_sha256', 'table_cell', structural.authority_source.body_sha256);
    push('STRUCTURAL_PROVENANCE', 'structural_provenance.authority_sha256', 'table_cell', structural.authority_sha256);
  }
  const descriptor = projection.descriptor_at_creation;
  push('DESCRIPTOR_AT_CREATION', 'descriptor_at_creation.heading', 'heading', descriptor.heading);
  push('DESCRIPTOR_AT_CREATION', 'descriptor_at_creation.preamble', 'paragraph', descriptor.preamble);
  for (const field of ['summary', 'purpose', 'eli5_at_creation']) {
    push('DESCRIPTOR_AT_CREATION', 'descriptor_at_creation.' + field, 'paragraph', descriptor[field]);
  }
  for (const field of ['changed_surfaces', 'scope', 'out_of_scope', 'design_constraints',
    'validation_requirements', 'evidence_refs', 'repair_history', 'before_after',
    'repair_budget', 'hosted_qualification', 'recovery_evidence']) {
    descriptor[field].forEach((value, index) => push('DESCRIPTOR_AT_CREATION',
      'descriptor_at_creation.' + field + '[' + index + ']', 'bullet', value));
  }
  if (projection.phase === 'PRE_NUMBER') {
    push('DESCRIPTOR_AT_CREATION', 'descriptor_at_creation.next_action_pre_number', 'paragraph', descriptor.next_action_pre_number);
  }
  return nodes;
}
function h2ValidatePrPhaseProjection(projection) {
  const currentKeys = ['authority_presence', 'number_state', 'pr_number', 'next_action'];
  const structuralKeys = ['root', 'lock', 'repository', 'parent_issue', 'child_issue', 'epoch_id', 'gate',
    'role', 'completes_child', 'candidate', 'descriptor_sha256', 'candidate_sha256',
    'authority_source', 'authority_sha256'];
  const descriptorKeys = ['heading', 'preamble', 'summary', 'purpose', 'changed_surfaces', 'scope',
    'out_of_scope', 'design_constraints', 'validation_requirements', 'evidence_refs',
    'repair_history', 'before_after', 'repair_budget', 'hosted_qualification',
    'recovery_evidence', 'eli5_at_creation', 'next_action_pre_number'];
  const omittedKeys = ['field', 'reason'];
  if (h2IsPlain(projection) && projection.phase === 'BOUND' && h2IsPlain(projection.current_derived)
    && currentKeys.some((key) => !h2Own(projection.current_derived, key))) {
    throw h2Error('BOUND_CURRENT_FIELD_MISSING', 'AUTHORITY');
  }
  h2Require(h2Exact(projection, ['schema', 'version', 'kind', 'phase', 'current_derived',
    'structural_provenance', 'descriptor_at_creation', 'omitted', 'typed_nodes'])
    && projection.schema === H2_PR_PHASE_PROJECTION_SCHEMA && projection.version === H2_VERSION
    && projection.kind === 'pr' && ['PRE_NUMBER', 'BOUND'].includes(projection.phase), true,
    'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  h2Require(h2Exact(projection.current_derived, currentKeys)
    && h2Exact(projection.structural_provenance, structuralKeys)
    && h2Exact(projection.descriptor_at_creation, descriptorKeys)
    && Array.isArray(projection.omitted), true, 'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  const current = projection.current_derived;
  const structural = projection.structural_provenance;
  const descriptor = projection.descriptor_at_creation;
  h2Require(['ABSENT', 'BOUND_VALIDATED'].includes(current.authority_presence)
    && current.number_state === projection.phase
    && (current.pr_number === null || h2Issue(current.pr_number))
    && h2SafeLine(current.next_action), true, 'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  h2Require(h2Repository(structural.repository) && h2Issue(structural.parent_issue)
    && h2Issue(structural.child_issue) && h2SafeId(structural.epoch_id) && h2SafeId(structural.gate)
    && structural.root === H2_ROOT && structural.lock === H2_LOCK
    && structural.role === 'INTERMEDIATE' && typeof structural.completes_child === 'boolean'
    && h2Hash(structural.descriptor_sha256) && h2Hash(structural.candidate_sha256)
    && (structural.authority_source === null || h2IsPlain(structural.authority_source))
    && (structural.authority_sha256 === null || h2Hash(structural.authority_sha256)), true,
    'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  h2Candidate(structural.candidate, 'CANONICAL');
  h2Require(h2SafeLine(descriptor.heading) && h2SafeLine(descriptor.preamble)
    && h2SafeLine(descriptor.summary) && h2SafeLine(descriptor.purpose)
    && h2SafeLine(descriptor.eli5_at_creation)
    && h2StringArray(descriptor.changed_surfaces) && h2StringArray(descriptor.scope)
    && h2StringArray(descriptor.out_of_scope) && h2StringArray(descriptor.design_constraints)
    && h2StringArray(descriptor.validation_requirements) && h2StringArray(descriptor.evidence_refs)
    && h2StringArray(descriptor.repair_history) && h2StringArray(descriptor.before_after)
    && h2StringArray(descriptor.repair_budget) && h2StringArray(descriptor.hosted_qualification)
    && h2StringArray(descriptor.recovery_evidence)
    && (descriptor.next_action_pre_number === null || h2SafeLine(descriptor.next_action_pre_number)), true,
    'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  const expectedPreHeading = projection.phase === 'PRE_NUMBER'
    ? '## Descriptor at creation (active PRE_NUMBER candidate declaration)'
    : '## Descriptor at creation (historical evidence only)';
  const expectedPreamble = projection.phase === 'PRE_NUMBER'
    ? 'This immutable descriptor is the active candidate declaration before provider number binding.'
    : 'This immutable descriptor records creation-time evidence only. It does not assert current provider, gate, review, check, Draft, Ready, merge, finality, or number-binding state.';
  h2Require(descriptor.heading === expectedPreHeading && descriptor.preamble === expectedPreamble, true,
    'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  if (projection.phase === 'PRE_NUMBER') {
    h2Require(current.authority_presence === 'ABSENT' && current.pr_number === null
      && current.next_action === descriptor.next_action_pre_number
      && descriptor.next_action_pre_number !== null
      && structural.authority_source === null && structural.authority_sha256 === null
      && projection.omitted.length === 0, true, 'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  } else {
    h2Require(current.authority_presence === 'BOUND_VALIDATED' && h2Issue(current.pr_number)
      && current.next_action === 'Continue only under the bound controller authority.'
      && descriptor.next_action_pre_number === null
      && structural.authority_source !== null && h2Hash(structural.authority_sha256)
      && projection.omitted.length === 1
      && h2Exact(projection.omitted[0], omittedKeys)
      && projection.omitted[0].field === 'next_action_pre_number'
      && projection.omitted[0].reason === 'BOUND_NONDISPLAYABLE', true,
      'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  }
  h2Require(h2Audit(projection), true, 'PR_PHASE_PROJECTION_INVALID', 'CANONICAL');
  const expectedNodes = h2PhaseProjectionNodes(projection);
  h2Require(Array.isArray(projection.typed_nodes), true, 'PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
  const expectedByField = new Map(expectedNodes.map((item) => [item.field, item]));
  const seen = new Set();
  for (const item of projection.typed_nodes) {
    if (!h2IsPlain(item) || !h2Exact(item, ['zone', 'field', 'node'])) {
      throw h2Error('PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
    }
    if (seen.has(item.field)) throw h2Error('PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
    seen.add(item.field);
    const expected = expectedByField.get(item.field);
    if (!expected) {
      if (String(item.field).includes('next_action_pre_number') && projection.phase === 'BOUND') {
        throw h2Error('PRE_NUMBER_FIELD_IN_BOUND', 'PUBLIC_AUDIT');
      }
      throw h2Error('PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
    }
    if (expected.zone === 'DESCRIPTOR_AT_CREATION' && item.zone === 'CURRENT_DERIVED') {
      throw h2Error('DESCRIPTOR_TEXT_CURRENT_ZONE', 'PUBLIC_AUDIT');
    }
    if (expected.zone === 'STRUCTURAL_PROVENANCE' && item.zone !== 'STRUCTURAL_PROVENANCE') {
      throw h2Error('STRUCTURAL_FIELD_ZONE_INVALID', 'PUBLIC_AUDIT');
    }
    if (item.zone !== expected.zone) throw h2Error('PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
    if (!h2Comparable(item.node, expected.node)) throw h2Error('PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
  }
  h2Require(seen.size === expectedNodes.length, true, 'PR_PHASE_PROVENANCE_INVALID', 'PUBLIC_AUDIT');
  return h2Clone(projection);
}
function h2BuildPrPhaseProjection(descriptor, authority) {
  const normalized = h2Descriptor(descriptor, 'AUTHORITY');
  const bound = authority === null ? null : h2BoundAuthority(authority, normalized, 'AUTHORITY');
  const projection = {
    schema: H2_PR_PHASE_PROJECTION_SCHEMA,
    version: H2_VERSION,
    kind: 'pr',
    phase: bound ? 'BOUND' : 'PRE_NUMBER',
    current_derived: {
      authority_presence: bound ? 'BOUND_VALIDATED' : 'ABSENT',
      number_state: bound ? 'BOUND' : 'PRE_NUMBER',
      pr_number: bound ? bound.pr_number : null,
      next_action: bound ? 'Continue only under the bound controller authority.' : normalized.next_action_pre_number,
    },
    structural_provenance: {
      root: normalized.root,
      lock: normalized.lock,
      repository: normalized.repository,
      parent_issue: normalized.parent_issue,
      child_issue: normalized.child_issue,
      epoch_id: normalized.epoch_id,
      gate: normalized.gate,
      role: normalized.role,
      completes_child: normalized.completes_child,
      candidate: h2Clone(normalized.candidate),
      descriptor_sha256: h2Digest(normalized),
      candidate_sha256: h2Digest(normalized.candidate),
      authority_source: bound ? h2Clone(bound.source) : null,
      authority_sha256: bound ? bound.authority_sha256 : null,
    },
    descriptor_at_creation: {
      heading: bound
        ? '## Descriptor at creation (historical evidence only)'
        : '## Descriptor at creation (active PRE_NUMBER candidate declaration)',
      preamble: bound
        ? 'This immutable descriptor records creation-time evidence only. It does not assert current provider, gate, review, check, Draft, Ready, merge, finality, or number-binding state.'
        : 'This immutable descriptor is the active candidate declaration before provider number binding.',
      summary: normalized.summary,
      purpose: normalized.purpose,
      changed_surfaces: h2Clone(normalized.changed_surfaces),
      scope: h2Clone(normalized.scope),
      out_of_scope: h2Clone(normalized.out_of_scope),
      design_constraints: h2Clone(normalized.design_constraints),
      validation_requirements: h2Clone(normalized.validation_requirements),
      evidence_refs: h2Clone(normalized.evidence_refs),
      repair_history: h2Clone(normalized.repair_history),
      before_after: h2Clone(normalized.before_after),
      repair_budget: h2Clone(normalized.repair_budget),
      hosted_qualification: h2Clone(normalized.hosted_qualification),
      recovery_evidence: h2Clone(normalized.recovery_evidence),
      eli5_at_creation: normalized.eli5,
      next_action_pre_number: bound ? null : normalized.next_action_pre_number,
    },
    omitted: bound ? [{ field: 'next_action_pre_number', reason: 'BOUND_NONDISPLAYABLE' }] : [],
    typed_nodes: [],
  };
  projection.typed_nodes = h2PhaseProjectionNodes(projection);
  return h2ValidatePrPhaseProjection(projection);
}
function h2BuildPrTypedDocument(projection) {
  const checked = h2ValidatePrPhaseProjection(projection);
  const current = checked.current_derived;
  const structural = checked.structural_provenance;
  const descriptor = checked.descriptor_at_creation;
  const lines = [
    '# Pull request candidate',
    '',
    '## Current phase',
    '| Field | Value |',
    '| --- | --- |',
    '| Phase | ' + h2Cell(checked.phase) + ' |',
    '| Authority | ' + h2Cell(current.authority_presence) + ' |',
    '| Number state | ' + h2Cell(current.number_state) + ' |',
    '| PR number | ' + (current.pr_number === null ? h2Cell('pending provider assignment') : '#' + h2Identifier(current.pr_number)) + ' |',
    '',
    '## Programme position',
    'These fields identify programme and candidate provenance only. They do not assert current provider state, gate activation, reviews, checks, Draft, Ready, merge, or finality.',
    '| Field | Value |',
    '| --- | --- |',
    '| Root | ' + h2Cell(structural.root) + ' |',
    '| Lock | ' + h2Cell(structural.lock) + ' |',
    '| Repository | ' + h2Cell(structural.repository) + ' |',
    '| Parent | #' + h2Identifier(structural.parent_issue) + ' |',
    '| Child | #' + h2Identifier(structural.child_issue) + ' |',
    '| Epoch | ' + h2Cell(structural.epoch_id) + ' |',
    '| Gate | ' + h2Cell(structural.gate) + ' |',
    '| Role | ' + h2Cell(structural.role) + ' |',
    '| Completes child | ' + h2Cell(String(structural.completes_child)) + ' |',
    '',
    '## Candidate / lineage',
    '| Field | Value |',
    '| --- | --- |',
    '| Repository | ' + h2Lineage(structural.candidate.repository, 'repository') + ' |',
    '| Branch | ' + h2Lineage(structural.candidate.branch, 'branch') + ' |',
    '| Base ref | ' + h2Lineage(structural.candidate.base_ref, 'base_ref') + ' |',
    '| Base SHA | ' + h2Lineage(structural.candidate.base_sha, 'base_sha') + ' |',
    '| Head | ' + h2Lineage(structural.candidate.head, 'head') + ' |',
    '| Tree | ' + h2Lineage(structural.candidate.tree, 'tree') + ' |',
    '| Version | ' + h2Lineage(structural.candidate.version, 'version') + ' |',
    '| Descriptor digest | ' + h2Cell(structural.descriptor_sha256) + ' |',
    '| Candidate digest | ' + h2Cell(structural.candidate_sha256) + ' |',
    '',
    descriptor.heading,
    h2Paragraph(descriptor.preamble),
    '',
    '### Summary', h2Paragraph(descriptor.summary),
    '',
    '### Purpose', h2Paragraph(descriptor.purpose),
    '',
    '### Changed surfaces', ...h2LinesForArray(descriptor.changed_surfaces),
    '',
    '### Scope', ...h2LinesForArray(descriptor.scope),
    '',
    '### Out of scope', ...h2LinesForArray(descriptor.out_of_scope),
    '',
    '### Design constraints', ...h2LinesForArray(descriptor.design_constraints),
    '',
    '### Validation requirements', ...h2LinesForArray(descriptor.validation_requirements),
    '',
    '### Evidence references', ...h2LinesForArray(descriptor.evidence_refs),
    '',
    '### Repair history', ...h2LinesForArray(descriptor.repair_history),
    '',
    '### Before and after', ...h2LinesForArray(descriptor.before_after),
    '',
    '### Repair budget', ...h2LinesForArray(descriptor.repair_budget),
    '',
    '### Hosted qualification', ...h2LinesForArray(descriptor.hosted_qualification),
    '',
    '### Recovery evidence', ...h2LinesForArray(descriptor.recovery_evidence),
    '',
    '### ELI5 at creation', h2Paragraph(descriptor.eli5_at_creation),
    '',
    '## What happens next', h2Bullet(current.next_action),
  ];
  return lines;
}
function h2PrProse(projection) {
  return h2BuildPrTypedDocument(projection);
}
function h2BuildParentDoc(state) {
  const checked = h2ValidateState(state);
  const projection = h2ProjectionState(checked.state, checked.history);
  const style = h2MarkerStyleForState(checked.state);
  const carrier = {
    schema: H2_PARENT_CARRIER_SCHEMA,
    version: H2_VERSION,
    kind: 'parent',
    repository: checked.state.repository,
    parent_issue: checked.state.parent.issue,
    canonical: { schema: checked.state.schema, class: H2_CANONICAL_CLASS, digest: checked.canonical_sha256, state: h2Clone(checked.state) },
    projection: { schema: H2_PARENT_PROJECTION_SCHEMA, digest: h2Digest(projection) },
    public_prose_sha256: null,
  };
  const prose = h2ParentProse(checked.state, projection);
  const document = h2ManagedDocument(style, 'parent', prose, carrier);
  h2Require(document.carrier.projection.digest === h2Digest(projection), true, 'PROJECTION_DIGEST_INVALID', 'PUBLIC_AUDIT');
  return { ...document, state: checked.state, canonical_sha256: checked.canonical_sha256, projection, projection_sha256: h2Digest(projection), kind: 'parent', format: 'human-v2' };
}
function h2BuildChildDoc(state, issue) {
  const checked = h2ValidateState(state);
  const projection = h2ProjectionChild(checked.state, checked.history, issue);
  const style = h2MarkerStyleForState(checked.state);
  const carrier = {
    schema: H2_CHILD_CARRIER_SCHEMA,
    version: H2_VERSION,
    kind: 'child',
    repository: checked.state.repository,
    parent_issue: checked.state.parent.issue,
    child_issue: issue,
    canonical: { schema: checked.state.schema, class: H2_CANONICAL_CLASS, digest: checked.canonical_sha256 },
    projection: { schema: H2_CHILD_PROJECTION_SCHEMA, digest: h2Digest(projection) },
    public_prose_sha256: null,
  };
  const prose = h2ChildProse(projection);
  const document = h2ManagedDocument(style, 'child', prose, carrier);
  return { ...document, state: checked.state, canonical_sha256: checked.canonical_sha256, projection, projection_sha256: h2Digest(projection), child_issue: issue, kind: 'child', format: 'human-v2' };
}
function h2BuildPrDoc(descriptor, authority) {
  const normalized = h2Descriptor(descriptor, 'AUTHORITY');
  const bound = authority === null ? null : h2BoundAuthority(authority, normalized, 'AUTHORITY');
  const projection = h2BuildPrPhaseProjection(normalized, bound);
  const style = h2MarkerStyleForRepository(normalized.repository);
  const carrier = {
    schema: H2_PR_CARRIER_SCHEMA,
    version: H2_VERSION,
    kind: 'pr',
    repository: normalized.repository,
    pr_number: projection.current_derived.pr_number,
    number_state: projection.current_derived.number_state,
    descriptor: { schema: H2_DESCRIPTOR_SCHEMA, digest: projection.structural_provenance.descriptor_sha256 },
    candidate: { digest: projection.structural_provenance.candidate_sha256 },
    authority_sha256: projection.structural_provenance.authority_sha256,
    projection: { schema: H2_PR_PHASE_PROJECTION_SCHEMA, phase: projection.phase, digest: h2Digest(projection) },
    public_prose_sha256: null,
  };
  const prose = h2BuildPrTypedDocument(projection);
  const document = h2ManagedDocument(style, 'pr', prose, carrier);
  return {
    ...document,
    descriptor: normalized,
    bound_authority: bound,
    projection,
    projection_sha256: h2Digest(projection),
    kind: 'pr',
    format: 'human-v2',
  };
}
function h2ValidateCarrierShape(carrier, kind) {
  const common = ['schema', 'version', 'kind', 'repository'];
  if (!h2IsPlain(carrier) || carrier.version !== H2_VERSION || carrier.kind !== kind || !h2Repository(carrier.repository)) throw h2Error('CARRIER_INVALID', 'PARSE');
  if (kind === 'parent') {
    h2Require(h2Exact(carrier, [...common, 'parent_issue', 'canonical', 'projection', 'public_prose_sha256'])
      && carrier.schema === H2_PARENT_CARRIER_SCHEMA && h2Issue(carrier.parent_issue), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(h2Exact(carrier.canonical, ['schema', 'class', 'digest', 'state']) && carrier.canonical.class === H2_CANONICAL_CLASS
      && h2SafeLine(carrier.canonical.schema) && h2Hash(carrier.canonical.digest), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(h2Exact(carrier.projection, ['schema', 'digest']) && carrier.projection.schema === H2_PARENT_PROJECTION_SCHEMA && h2Hash(carrier.projection.digest), true, 'CARRIER_INVALID', 'PARSE');
  } else if (kind === 'child') {
    h2Require(h2Exact(carrier, [...common, 'parent_issue', 'child_issue', 'canonical', 'projection', 'public_prose_sha256'])
      && carrier.schema === H2_CHILD_CARRIER_SCHEMA && h2Issue(carrier.parent_issue) && h2Issue(carrier.child_issue), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(h2Exact(carrier.canonical, ['schema', 'class', 'digest']) && carrier.canonical.class === H2_CANONICAL_CLASS
      && h2SafeLine(carrier.canonical.schema) && h2Hash(carrier.canonical.digest), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(h2Exact(carrier.projection, ['schema', 'digest']) && carrier.projection.schema === H2_CHILD_PROJECTION_SCHEMA && h2Hash(carrier.projection.digest), true, 'CARRIER_INVALID', 'PARSE');
  } else {
    h2Require(h2Exact(carrier, [...common, 'pr_number', 'number_state', 'descriptor', 'candidate', 'authority_sha256', 'projection', 'public_prose_sha256'])
      && carrier.schema === H2_PR_CARRIER_SCHEMA && (carrier.pr_number === null || h2Issue(carrier.pr_number))
      && ['PRE_NUMBER', 'BOUND'].includes(carrier.number_state), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(h2Exact(carrier.descriptor, ['schema', 'digest']) && carrier.descriptor.schema === H2_DESCRIPTOR_SCHEMA && h2Hash(carrier.descriptor.digest)
      && h2Exact(carrier.candidate, ['digest']) && h2Hash(carrier.candidate.digest)
      && (carrier.authority_sha256 === null || h2Hash(carrier.authority_sha256))
      && h2Exact(carrier.projection, ['schema', 'phase', 'digest'])
      && carrier.projection.schema === H2_PR_PHASE_PROJECTION_SCHEMA
      && ['PRE_NUMBER', 'BOUND'].includes(carrier.projection.phase)
      && h2Hash(carrier.projection.digest), true, 'CARRIER_INVALID', 'PARSE');
    h2Require(carrier.number_state === 'PRE_NUMBER' ? carrier.pr_number === null && carrier.authority_sha256 === null : h2Issue(carrier.pr_number) && h2Hash(carrier.authority_sha256), true, 'CARRIER_INVALID', 'PARSE');
  }
  h2Require(h2Hash(carrier.public_prose_sha256), true, 'CARRIER_INVALID', 'PARSE');
  h2Require(h2Audit(carrier), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
}
function h2CarrierParts(envelope, kind) {
  const carrier = h2DecodeCarrier(envelope.classification.encoded);
  h2ValidateCarrierShape(carrier, kind);

  const prose = envelope.classification.lines.slice(1, -2).join('\n');
  h2Require(h2DigestText(prose) === carrier.public_prose_sha256, true, 'PUBLIC_PROSE_DIGEST_MISMATCH', 'READBACK');
  return { carrier, prose };
}
function h2ReadEnvelope(read) {
  const complete = h2ValidateCompleteRead(read);
  const classification = h2Classifier(complete.body);
  return { read: complete, classification };
}
function h2Expect(value) {
  h2Require(h2IsPlain(value) && h2Own(value, 'kind') && h2Own(value, 'repository')
    && ['parent', 'child', 'pr'].includes(value.kind) && h2Repository(value.repository), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  if (value.kind === 'parent') h2Require(h2Exact(value, ['kind', 'repository', 'issue']), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  if (value.kind === 'child') h2Require(h2Exact(value, ['kind', 'repository', 'issue', 'parent_issue', 'parent_read'])
    && h2Issue(value.issue) && h2Issue(value.parent_issue) && h2Exact(value.parent_read, ['body', 'complete', 'byte_length', 'body_sha256', 'revision']), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  if (value.kind === 'parent') h2Require(h2Issue(value.issue), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  if (value.kind === 'pr') h2Require(h2Exact(value, ['kind', 'repository', 'descriptor', 'bound_authority'])
    && (value.bound_authority === null || h2IsPlain(value.bound_authority)), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
  return value;
}
function h2ParsedResult(envelope, kind, extra = {}) {
  return { ...extra, kind, format: envelope.classification.format, read: h2Clone(envelope.read), body: envelope.read.body, body_sha256: envelope.read.body_sha256 };
}
function h2ParseParentEnvelope(envelope, expected = null) {
  if (envelope.classification.format === 'legacy-v5') {
    h2Require(envelope.classification.kind === 'parent', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
    const parsed = parseParentV5Body(envelope.read.body, { complete: true });
    h2Require(parsed.ok, true, 'LEGACY_PARSE_INVALID', 'PARSE');
    const valid = h2ValidateState(parsed.state);
    h2Require(valid.canonical_sha256 === parsed.envelope.canonical_digest, true, 'CANONICAL_DIGEST_MISMATCH', 'CANONICAL');
    if (expected) h2Require(parsed.state.repository === expected.repository && parsed.state.parent.issue === expected.issue, true, 'IDENTITY_MISMATCH', 'PARSE');
    return h2ParsedResult(envelope, 'parent', { state: valid.state, canonical_sha256: valid.canonical_sha256, legacy_compatibility_only: true, projection: h2ProjectionState(valid.state, valid.history), legacy_envelope: parsed.envelope });
  }
  h2Require(envelope.classification.kind === 'parent', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  const parts = h2CarrierParts(envelope, 'parent');
  const valid = h2ValidateState(parts.carrier.canonical.state);
  h2Require(parts.carrier.canonical.schema === valid.state.schema && parts.carrier.canonical.digest === valid.canonical_sha256
    && parts.carrier.parent_issue === valid.state.parent.issue, true, 'CANONICAL_DIGEST_MISMATCH', 'CANONICAL');
  if (expected) h2Require(valid.state.repository === expected.repository && valid.state.parent.issue === expected.issue, true, 'IDENTITY_MISMATCH', 'PARSE');
  const expectedDoc = h2BuildParentDoc(valid.state);
  h2Require(expectedDoc.body === envelope.read.body && h2Comparable(expectedDoc.carrier, parts.carrier), true, 'READBACK_MISMATCH', 'READBACK');
  return h2ParsedResult(envelope, 'parent', { state: valid.state, canonical_sha256: valid.canonical_sha256, projection: expectedDoc.projection, projection_sha256: expectedDoc.projection_sha256, carrier: parts.carrier });
}
function h2ParseChildEnvelope(envelope, expected = null, parentParsed = null) {
  if (envelope.classification.format === 'legacy-v5') {
    h2Require(envelope.classification.kind === 'child', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
    const parsed = parseChildV5Body(envelope.read.body, { complete: true });
    h2Require(parsed.ok, true, 'LEGACY_PARSE_INVALID', 'PARSE');
    h2Require(parsed.envelope.kind === 'child', true, 'LEGACY_PARSE_INVALID', 'PARSE');
    if (expected) h2Require(parsed.envelope.repository === expected.repository && parsed.envelope.parent_issue === expected.parent_issue
      && parsed.envelope.number === expected.issue, true, 'IDENTITY_MISMATCH', 'PARSE');
    if (parentParsed) h2Require(parsed.envelope.canonical_digest === parentParsed.canonical_sha256, true, 'CHILD_SOURCE_MISMATCH', 'RELATIONSHIP');
    return h2ParsedResult(envelope, 'child', { canonical_sha256: parsed.envelope.canonical_digest, child_issue: parsed.envelope.number, legacy_compatibility_only: true, legacy_envelope: parsed.envelope, parent_state: parentParsed?.state || null });
  }
  h2Require(envelope.classification.kind === 'child', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  const parts = h2CarrierParts(envelope, 'child');
  const carrier = parts.carrier;
  h2Require(carrier.canonical.schema && carrier.canonical.class === H2_CANONICAL_CLASS, true, 'CANONICAL_DIGEST_MISMATCH', 'CANONICAL');
  if (expected) h2Require(carrier.repository === expected.repository && carrier.parent_issue === expected.parent_issue && carrier.child_issue === expected.issue, true, 'IDENTITY_MISMATCH', 'PARSE');
  if (parentParsed) {
    h2Require(carrier.repository === parentParsed.state.repository && carrier.parent_issue === parentParsed.state.parent.issue
      && carrier.canonical.schema === parentParsed.state.schema && carrier.canonical.digest === parentParsed.canonical_sha256, true, 'CHILD_SOURCE_MISMATCH', 'RELATIONSHIP');
    const expectedDoc = h2BuildChildDoc(parentParsed.state, carrier.child_issue);
    h2Require(expectedDoc.body === envelope.read.body && h2Comparable(expectedDoc.carrier, carrier), true, 'READBACK_MISMATCH', 'READBACK');
    return h2ParsedResult(envelope, 'child', { state: parentParsed.state, parent_state: parentParsed.state, canonical_sha256: parentParsed.canonical_sha256, child_issue: carrier.child_issue, projection: expectedDoc.projection, projection_sha256: expectedDoc.projection_sha256, carrier });
  }
  h2Require(h2Hash(carrier.canonical.digest), true, 'CANONICAL_DIGEST_MISMATCH', 'CANONICAL');
  return h2ParsedResult(envelope, 'child', { canonical_sha256: carrier.canonical.digest, child_issue: carrier.child_issue, carrier });
}
function h2ParsePrEnvelope(envelope, descriptor, authority) {
  h2Require(envelope.classification.format === 'human-v2' && envelope.classification.kind === 'pr', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  const parts = h2CarrierParts(envelope, 'pr');
  const normalized = h2Descriptor(descriptor, 'AUTHORITY');
  const bound = authority === null ? null : h2BoundAuthority(authority, normalized, 'AUTHORITY');
  const expectedDoc = h2BuildPrDoc(normalized, bound);
  const expectedProjectionDigest = h2Digest(expectedDoc.projection);
  h2Require(expectedDoc.projection_sha256 === expectedProjectionDigest, true, 'PROJECTION_DIGEST_MISMATCH', 'READBACK');
  h2Require(parts.carrier.projection.schema === H2_PR_PHASE_PROJECTION_SCHEMA
    && parts.carrier.projection.phase === expectedDoc.projection.phase
    && parts.carrier.projection.digest === expectedProjectionDigest, true, 'CARRIER_PROJECTION_MISMATCH', 'READBACK');
  h2Require(parts.carrier.repository === normalized.repository
    && parts.carrier.number_state === expectedDoc.projection.current_derived.number_state
    && parts.carrier.pr_number === expectedDoc.projection.current_derived.pr_number
    && parts.carrier.descriptor.digest === expectedDoc.projection.structural_provenance.descriptor_sha256
    && parts.carrier.candidate.digest === expectedDoc.projection.structural_provenance.candidate_sha256
    && parts.carrier.authority_sha256 === expectedDoc.projection.structural_provenance.authority_sha256, true,
    'BOUND_AUTHORITY_CURRENT_MISMATCH', 'AUTHORITY');
  h2Require(expectedDoc.body === envelope.read.body && h2Comparable(expectedDoc.carrier, parts.carrier), true, 'READBACK_MISMATCH', 'READBACK');
  return h2ParsedResult(envelope, 'pr', {
    descriptor: normalized,
    bound_authority: bound,
    projection: expectedDoc.projection,
    projection_sha256: expectedDoc.projection_sha256,
    carrier: parts.carrier,
    pr_number: expectedDoc.projection.current_derived.pr_number,
    number_state: expectedDoc.projection.current_derived.number_state,
  });
}
function h2ReadInternal(read, expected) {
  const envelope = h2ReadEnvelope(read);
  h2Expect(expected);
  h2Require(envelope.classification.kind === expected.kind, true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  if (expected.kind === 'parent') return h2ParseParentEnvelope(envelope, expected);
  if (expected.kind === 'pr') {
    h2Require(expected.repository === expected.descriptor.repository, true, 'IDENTITY_MISMATCH', 'PARSE');
    h2Descriptor(expected.descriptor, 'AUTHORITY');
    if (expected.bound_authority !== null) h2BoundAuthority(expected.bound_authority, expected.descriptor, 'AUTHORITY');
    return h2ParsePrEnvelope(envelope, expected.descriptor, expected.bound_authority);
  }
  const parent = h2ReadInternal(expected.parent_read, { kind: 'parent', repository: expected.repository, issue: expected.parent_issue });
  return h2ParseChildEnvelope(envelope, { repository: expected.repository, parent_issue: expected.parent_issue, issue: expected.issue }, parent);
}
function h2ReadParentUnbound(read) {
  const envelope = h2ReadEnvelope(read);
  h2Require(envelope.classification.kind === 'parent', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  return h2ParseParentEnvelope(envelope, null);
}
function h2ReadChildUnbound(read) {
  const envelope = h2ReadEnvelope(read);
  h2Require(envelope.classification.kind === 'child', true, 'MARKER_WRONG_KIND', 'CLASSIFY');
  return h2ParseChildEnvelope(envelope, null, null);
}
function h2ValidateProviderObservation(value) {
  const keys = ['schema', 'provider', 'repository', 'pr_number', 'github_state', 'draft', 'merged', 'base_ref', 'base_sha', 'head', 'tree', 'observed_revision'];
  return h2IsPlain(value) && h2Exact(value, keys) && value.schema === H2_PROVIDER_OBSERVATION_SCHEMA
    && value.provider === 'GITHUB' && h2Repository(value.repository) && h2Issue(value.pr_number)
    && ['OPEN', 'CLOSED', 'MERGED'].includes(value.github_state) && typeof value.draft === 'boolean' && typeof value.merged === 'boolean'
    && h2SafeLine(value.base_ref, 256) && h2Sha(value.base_sha) && h2Sha(value.head) && h2Sha(value.tree)
    && (value.observed_revision === null || h2SafeLine(value.observed_revision, 1024));
}
function h2CandidateForPr(state, history, pr) {
  for (const item of history.pr_history) if (item.authority.pr_number === pr) return { candidate: item.descriptor.candidate, entry: item.registry.entry };
  for (const child of state.children) for (const entry of child.pr_registry || []) if (entry.pr === pr && entry.candidate) {
    const descriptor = (state.prs || []).find((item) => item.number === pr);
    return { candidate: entry.candidate, entry, descriptor };
  }
  return null;
}
function h2ValidateProviderAssertions(value, state, history) {
  if (value === null) return [];
  h2Require(Array.isArray(value), true, 'PROVIDER_ASSERTION_INVALID', 'PROVIDER_ASSERTION');
  let previous = null;
  const seen = new Set();
  const result = [];
  for (const observation of value) {
    h2Require(h2ValidateProviderObservation(observation), true, 'PROVIDER_ASSERTION_INVALID', 'PROVIDER_ASSERTION');
    h2Require(observation.repository === state.repository, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    const key = observation.repository + '\u0000' + String(observation.pr_number);
    h2Require(!seen.has(key), true, 'PROVIDER_ASSERTION_INVALID', 'PROVIDER_ASSERTION');
    seen.add(key);
    if (previous !== null) h2Require(previous.repository < observation.repository || previous.repository === observation.repository && previous.pr_number < observation.pr_number, true, 'PROVIDER_ASSERTION_INVALID', 'PROVIDER_ASSERTION');
    previous = observation;
    const known = h2CandidateForPr(state, history, observation.pr_number);
    h2Require(known && known.candidate, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    const candidate = known.candidate;
    const entry = known.entry || {};
    h2Require(observation.base_ref === candidate.base_ref && observation.base_sha === candidate.base_sha
      && observation.head === candidate.head && observation.tree === candidate.tree, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    if (h2Own(entry, 'github_state')) h2Require(observation.github_state === entry.github_state, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    if (h2Own(entry, 'draft')) h2Require(observation.draft === entry.draft, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    if (h2Own(entry, 'merged')) h2Require(observation.merged === entry.merged, true, 'PROVIDER_ASSERTION_MISMATCH', 'PROVIDER_ASSERTION');
    result.push(h2Clone(observation));
  }
  return result;
}
function h2ValidateDecision(value, sourceParsed) {
  const keys = ['schema', 'decision', 'root', 'lock', 'repository', 'source', 'authority', 'additions', 'decision_sha256'];
  const sourceKeys = ['body_sha256', 'canonical_sha256'];
  const authorityKeys = ['kind', 'reference', 'body_sha256'];
  const additionsKeys = ['pr_history', 'evidence_refs', 'transitions'];
  h2Require(h2Exact(value, keys) && value.schema === H2_HISTORY_DECISION_SCHEMA && value.decision === 'EXTEND_HISTORY'
    && value.root === H2_ROOT && value.lock === H2_LOCK && value.repository === sourceParsed.state.repository
    && h2Exact(value.source, sourceKeys) && value.source.body_sha256 === sourceParsed.read.body_sha256 && value.source.canonical_sha256 === sourceParsed.canonical_sha256
    && h2Exact(value.authority, authorityKeys) && value.authority.kind === 'USER_WEB_CONTROLLER'
    && h2SafeLine(value.authority.reference, 2048) && h2Hash(value.authority.body_sha256)
    && h2Exact(value.additions, additionsKeys) && Array.isArray(value.additions.pr_history)
    && Array.isArray(value.additions.evidence_refs) && Array.isArray(value.additions.transitions) && h2Hash(value.decision_sha256), true, 'HISTORY_DECISION_INVALID', 'HISTORY');
  let previousPr = 0;
  const entryNumbers = new Set();
  for (const item of value.additions.pr_history) {
    const normalized = h2ValidateHistoryEntry(item, sourceParsed.state.repository);
    h2Require(normalized.descriptor.parent_issue === sourceParsed.state.parent.issue, true, 'HISTORY_ENTRY_INVALID', 'HISTORY');
    h2Require(normalized.authority.pr_number > previousPr && !entryNumbers.has(normalized.authority.pr_number), true, 'HISTORY_ORDER_INVALID', 'HISTORY');
    previousPr = normalized.authority.pr_number; entryNumbers.add(normalized.authority.pr_number);
    h2Require(normalized.descriptor.evidence_refs.every((ref) => sourceParsed.state.evidence_refs.some((item) => item.id === ref) || value.additions.evidence_refs.some((item) => item.id === ref)), true, 'HISTORY_EVIDENCE_MISSING', 'HISTORY');
  }
  let previousId = '';
  const evidenceIds = new Set();
  for (const item of value.additions.evidence_refs) {
    h2Require(h2ValidateEvidence(item), true, 'HISTORY_EVIDENCE_INVALID', 'HISTORY');
    h2Require(item.id > previousId && !evidenceIds.has(item.id), true, 'HISTORY_ORDER_INVALID', 'HISTORY');
    previousId = item.id; evidenceIds.add(item.id);
  }
  let previousTransition = '';
  const transitionIds = new Set();
  for (const item of value.additions.transitions) {
    h2Require(h2IsPlain(item) && h2Exact(item, ['id', 'child_issue', 'epoch_id', 'gate', 'disposition', 'evidence_ref'])
      && h2SafeId(item.id) && h2Issue(item.child_issue) && h2SafeId(item.epoch_id) && h2SafeId(item.gate)
      && h2SafeId(item.disposition) && h2SafeId(item.evidence_ref), true, 'HISTORY_TRANSITION_INVALID', 'HISTORY');
    h2Require(item.id > previousTransition && !transitionIds.has(item.id), true, 'HISTORY_ORDER_INVALID', 'HISTORY');
    previousTransition = item.id; transitionIds.add(item.id);
    h2Require(sourceParsed.state.children.some((child) => child.issue === item.child_issue && child.epochs.some((epoch) => epoch.id === item.epoch_id)), true, 'HISTORY_REFERENT_MISSING', 'HISTORY');
    h2Require(sourceParsed.state.evidence_refs.some((evidence) => evidence.id === item.evidence_ref) || evidenceIds.has(item.evidence_ref), true, 'HISTORY_REFERENT_MISSING', 'HISTORY');
  }
  h2Require(value.decision_sha256 === h2Digest(h2Without(value, 'decision_sha256')), true, 'HISTORY_DECISION_DIGEST_INVALID', 'HISTORY');
  h2Require(h2Audit(value), true, 'PUBLIC_DATA_UNSAFE', 'PUBLIC_AUDIT');
  return h2Clone(value);
}
function h2ApplyHistory(source, decision) {
  const existing = h2ValidateHistoryContainer(source[H2_HISTORY_KEY], source.repository);
  const additions = decision.additions;
  const target = h2Clone(source);
  const prHistory = existing.pr_history.map((item) => ({ descriptor: item.descriptor, bound_authority: item.authority, registry: item.registry }));
  const evidenceRefs = existing.evidence_refs.map((item) => h2Clone(item));
  const transitions = existing.transitions.map((item) => h2Clone(item));
  const existingPr = new Set(existing.pr_history.map((item) => item.authority.pr_number));
  const existingEvidence = new Set(existing.evidence_refs.map((item) => item.id));
  const existingTransitions = new Set(existing.transitions.map((item) => item.id));
  for (const item of additions.pr_history) {
    const normalized = h2ValidateHistoryEntry(item, source.repository);
    h2Require(!existingPr.has(normalized.authority.pr_number), true, 'HISTORY_DUPLICATE', 'HISTORY');
    existingPr.add(normalized.authority.pr_number);
    prHistory.push({ descriptor: normalized.descriptor, bound_authority: normalized.authority, registry: normalized.registry });
  }
  for (const item of additions.evidence_refs) {
    h2Require(!existingEvidence.has(item.id), true, 'HISTORY_DUPLICATE', 'HISTORY');
    existingEvidence.add(item.id); evidenceRefs.push(h2Clone(item));
  }
  for (const item of additions.transitions) {
    h2Require(!existingTransitions.has(item.id), true, 'HISTORY_DUPLICATE', 'HISTORY');
    existingTransitions.add(item.id); transitions.push(h2Clone(item));
  }
  prHistory.sort((left, right) => left.bound_authority.pr_number - right.bound_authority.pr_number);
  evidenceRefs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  transitions.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  target[H2_HISTORY_KEY] = { schema: H2_HISTORY_SCHEMA, pr_history: prHistory, evidence_refs: evidenceRefs, transitions };
  const valid = h2ValidateState(target);
  return valid.state;
}
function h2Call(operation, fn) {
  try {
    return fn();
  } catch (error) {
    const code = error?.h2_code || 'SURFACE_INPUT_INVALID';
    const stage = H2_STAGES.includes(error?.h2_stage) ? error.h2_stage : 'INPUT';
    return {
      ok: false,
      code,
      operation,
      stage,
      safe_for_provider_write: false,
      provider_mutation_authorised: false,
    };
  }
}
function h2Success(operation, code, stage, extra = {}) {
  return {
    ok: true,
    code,
    operation,
    stage,
    safe_for_provider_write: false,
    provider_mutation_authorised: false,
    ...extra,
  };
}
function h2PublicReadProjection(projection) {
  const publicProjection = h2Clone(projection);
  if (publicProjection.phase === 'BOUND') {
    delete publicProjection.descriptor_at_creation.next_action_pre_number;
    delete publicProjection.omitted;
  }
  return publicProjection;
}
function h2ReadCompletePublic(input) {
  return h2Call('readComplete', () => {
    h2Require(arguments.length === 1, true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    h2Require(h2IsPlain(input) && h2Exact(input, ['read', 'expect']), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    const parsed = h2ReadInternal(input.read, input.expect);
    const result = {
      kind: parsed.kind,
      format: parsed.format,
      repository: parsed.kind === 'pr' ? parsed.descriptor.repository : parsed.state.repository,
      issue: parsed.kind === 'pr' ? (parsed.pr_number || null) : parsed.kind === 'parent' ? parsed.state.parent.issue : parsed.child_issue,
      canonical_sha256: parsed.canonical_sha256 || null,
      body_sha256: parsed.body_sha256,
      read: parsed.read,
    };
    if (parsed.state) result.canonical_state = h2Clone(parsed.state);
    if (parsed.projection) {
      result.projection = h2PublicReadProjection(parsed.projection);
      result.projection_sha256 = h2Digest(parsed.projection);
    }
    if (parsed.descriptor) {
      const descriptor = h2Clone(parsed.descriptor);
      if (parsed.bound_authority) delete descriptor.next_action_pre_number;
      result.descriptor = descriptor;
    }
    if (parsed.bound_authority !== undefined) result.bound_authority = parsed.bound_authority === null ? null : h2Clone(parsed.bound_authority);
    if (parsed.pr_number !== undefined) { result.pr_number = parsed.pr_number; result.number_state = parsed.number_state; }
    return h2Success('readComplete', 'READ_COMPLETE', 'READBACK', result);
  });
}
function h2RenderPublic(input) {
  return h2Call('render', () => {
    h2Require(arguments.length === 1, true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    h2Require(h2IsPlain(input) && h2Exact(input, ['source', 'target']) && h2IsPlain(input.source) && h2IsPlain(input.target), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    const source = input.source;
    const target = input.target;
    h2Require(h2Own(source, 'type') && typeof source.type === 'string', true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    let document;
    if (source.type === 'PARENT_READ') {
      h2Require(h2Exact(source, ['type', 'parent_read']), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
      h2Require(h2IsPlain(target) && (target.kind === 'parent' && h2Exact(target, ['kind']) || target.kind === 'child' && h2Exact(target, ['kind', 'issue']) && h2Issue(target.issue)), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
      const parent = h2ReadParentUnbound(source.parent_read);
      document = target.kind === 'parent' ? h2BuildParentDoc(parent.state) : h2BuildChildDoc(parent.state, target.issue);
    } else if (source.type === 'PR_DESCRIPTOR') {
      h2Require(h2Exact(source, ['type', 'descriptor', 'bound_authority']) && h2IsPlain(target) && h2Exact(target, ['kind']) && target.kind === 'pr', true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
      h2Descriptor(source.descriptor, 'AUTHORITY');
      h2Require(source.bound_authority === null || h2IsPlain(source.bound_authority), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
      document = h2BuildPrDoc(source.descriptor, source.bound_authority);
    } else {
      throw h2Error('INPUT_KEY_UNEXPECTED', 'INPUT');
    }
    const complete = h2CompleteRead(document.body);
    const extra = document.kind === 'pr'
      ? { kind: 'pr', descriptor: h2Clone(document.descriptor), bound_authority: document.bound_authority === null ? null : h2Clone(document.bound_authority), pr_number: document.bound_authority?.pr_number || null, number_state: document.bound_authority ? 'BOUND' : 'PRE_NUMBER', projection: h2Clone(document.projection), projection_sha256: document.projection_sha256 }
      : { kind: document.kind, canonical_state: h2Clone(document.state), canonical_sha256: document.canonical_sha256, projection: h2Clone(document.projection), projection_sha256: document.projection_sha256 };
    return h2Success('render', 'RENDER_READY', 'SERIALIZE', { ...extra, body: document.body, read: complete, body_sha256: complete.body_sha256, carrier_sha256: document.carrier_sha256, managed_block_sha256: document.managed_block_sha256, public_prose_sha256: document.public_prose_sha256 });
  });
}
function h2ExtendHistoryPublic(input) {
  return h2Call('extendHistory', () => {
    h2Require(arguments.length === 1, true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    h2Require(h2IsPlain(input) && h2Exact(input, ['parent_read', 'decision', 'provider_observations'])
      && h2IsPlain(input.decision) && (input.provider_observations === null || Array.isArray(input.provider_observations)), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    const source = h2ReadParentUnbound(input.parent_read);
    const decision = h2ValidateDecision(input.decision, source);
    const target = h2ApplyHistory(source.state, decision);
    const targetValid = h2ValidateState(target);
    const observations = h2ValidateProviderAssertions(input.provider_observations, targetValid.state, targetValid.history);
    const parent = h2BuildParentDoc(targetValid.state);
    const children = targetValid.state.children.map((child) => h2BuildChildDoc(targetValid.state, child.issue));
    return h2Success('extendHistory', 'HISTORY_EXTENDED', 'READBACK', {
      source_body_sha256: source.read.body_sha256,
      source_canonical_sha256: source.canonical_sha256,
      decision_sha256: input.decision.decision_sha256,
      target_state: h2Clone(targetValid.state),
      target_canonical_sha256: targetValid.canonical_sha256,
      parent: { body: parent.body, read: h2CompleteRead(parent.body), body_sha256: sha256Text(parent.body), canonical_sha256: parent.canonical_sha256 },
      children: children.map((child) => ({ issue: child.child_issue, body: child.body, read: h2CompleteRead(child.body), body_sha256: sha256Text(child.body), canonical_sha256: child.canonical_sha256 })),
      provider_observations: observations,
    });
  });
}
function h2WritePlan(kind, issue, document) {
  return { kind, issue, body: document.body, read: h2CompleteRead(document.body), body_sha256: sha256Text(document.body), canonical_sha256: document.canonical_sha256 };
}
function h2PlanMigrationPublic(input) {
  return h2Call('planMigration', () => {
    h2Require(arguments.length === 1, true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    h2Require(h2IsPlain(input) && h2Exact(input, ['parent_read', 'child_read', 'history_decision', 'provider_observations'])
      && h2IsPlain(input.parent_read) && h2IsPlain(input.child_read)
      && (input.history_decision === null || h2IsPlain(input.history_decision))
      && (input.provider_observations === null || Array.isArray(input.provider_observations)), true, 'INPUT_KEY_UNEXPECTED', 'INPUT');
    const parent = h2ReadParentUnbound(input.parent_read);
    const childEnvelope = h2ReadEnvelope(input.child_read);
    h2Require(childEnvelope.classification.kind === 'child', true, 'MIGRATION_INPUT_INVALID', 'MIGRATION');
    const childIssue = parent.state.children.find((item) => item.lifecycle === 'CURRENT')?.issue || CHILD_ISSUE;
    let child = null;
    let observations;
    if (parent.format === 'human-v2') {
      h2Require(input.history_decision === null, true, 'MIGRATION_HISTORY_DECISION_PHASE_INVALID', 'MIGRATION');
      if (childEnvelope.classification.format === 'legacy-v5') {
        try { child = h2ParseChildEnvelope(childEnvelope, null, parent); } catch (_error) { throw h2Error('MIGRATION_CHILD_DRIFT', 'MIGRATION'); }
        h2Require(child.child_issue === childIssue, true, 'MIGRATION_CHILD_DRIFT', 'MIGRATION');
        observations = h2ValidateProviderAssertions(input.provider_observations, parent.state, h2ValidateHistoryContainer(parent.state[H2_HISTORY_KEY], parent.state.repository));
        const document = h2BuildChildDoc(parent.state, childIssue);
        return h2Success('planMigration', 'MIGRATION_CHILD_WRITE_READY', 'MIGRATION', { action: 'WRITE_CHILD', writes: [h2WritePlan('child', childIssue, document)], write_count: 1, source_parent_format: parent.format, source_child_format: child.format, provider_observations: observations });
      }
      const parsedChild = h2ParseChildEnvelope(childEnvelope, null, null);
      h2Require(parsedChild.child_issue === childIssue, true, 'MIGRATION_CHILD_DRIFT', 'MIGRATION');
      const expected = h2BuildChildDoc(parent.state, childIssue);
      h2Require(expected.body === childEnvelope.read.body && h2Comparable(expected.carrier, parsedChild.carrier), true, 'MIGRATION_CHILD_DRIFT', 'MIGRATION');
      observations = h2ValidateProviderAssertions(input.provider_observations, parent.state, h2ValidateHistoryContainer(parent.state[H2_HISTORY_KEY], parent.state.repository));
      return h2Success('planMigration', 'MIGRATION_RECONCILED', 'MIGRATION', { action: 'RECONCILED', writes: [], write_count: 0, source_parent_format: parent.format, source_child_format: childEnvelope.classification.format, child_issue: childIssue, provider_observations: observations });
    }
    if (childEnvelope.classification.format === 'human-v2') throw h2Error('MIGRATION_ORDER_INVALID', 'MIGRATION');
    if (input.history_decision !== null) h2ValidateDecision(input.history_decision, parent);
    child = h2ParseChildEnvelope(childEnvelope, null, parent);
    h2Require(child.child_issue === childIssue, true, 'MIGRATION_CHILD_DRIFT', 'MIGRATION');
    observations = h2ValidateProviderAssertions(input.provider_observations, parent.state, h2ValidateHistoryContainer(parent.state[H2_HISTORY_KEY], parent.state.repository));
    const document = h2BuildParentDoc(parent.state);
    return h2Success('planMigration', 'MIGRATION_PARENT_WRITE_READY', 'MIGRATION', { action: 'WRITE_PARENT', writes: [h2WritePlan('parent', parent.state.parent.issue, document)], write_count: 1, source_parent_format: parent.format, source_child_format: child.format, provider_observations: observations });
  });
}

const humanSurfaceV2 = Object.freeze({
  readComplete: h2ReadCompletePublic,
  render: h2RenderPublic,
  extendHistory: h2ExtendHistoryPublic,
  planMigration: h2PlanMigrationPublic,
});

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
  validateCanonicalStateV5,
  deriveProjectionV5: (state, kind) => {
    const valid = validateCanonicalStateV5(state);
    return valid.ok ? success('V5_PROJECTION_READY', { projection: projectionPayload(state, kind), projection_digest: digestValue(projectionPayload(state, kind)) }) : valid;
  },
  renderProgrammeV5,
  parseProgrammeV5Body,
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
  validateEvidence,
  validateProviderEvidence,
  buildPaginationEvidence,
  classifyPartialState,
  buildReceiptOperationDescriptor,
  verifyBootstrapWorkspaceProof,
  validateControllerBootstrap,
  projectionBootstrapRecovery,
  postMergeEpochFinalisation,
  humanSurfaceV2,
  programmeV5,
});
