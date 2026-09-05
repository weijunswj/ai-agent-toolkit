use github_program_broker::canonical::{self, Digest, ParseLimits};
use github_program_broker::crypto::{
    HolderAttestation, HolderKey, KeyId, Principal, boot_identity_digest, broker_identity_digest,
    holder_attestation_digest, holder_tag, linux_principal_digest, path_binding_identity_digest,
    pid_namespace_identity_digest, principal_digest, process_identity_digest,
    process_incarnation_digest, process_start_identity_digest, sign_holder_attestation,
    store_binding_identity_digest, verify_holder_attestation,
};
use github_program_broker::error::{BrokerError, ErrorCode};
use github_program_broker::protocol::{
    AuthorAssociation, AuthoritySnapshot, Candidate, Lease, MAX_FRAME_PAYLOAD_BYTES,
    MAX_NESTING_DEPTH, MutationEvent, MutationOperation, MutationOperationKind, MutationState,
    Namespace, OperationKind, PreRecoveryEvidence, Readback, ReadbackTarget, ReceiptPayload,
    ReceiptRecord, ReceiptType, RecoveryRecord, RefSnapshot, Request, RequestId, Response,
    RunAllocation, SafetyClass, StartSnapshot, SuccessValue, TargetIdentity, decode_frame,
    decode_request_frame, decode_response_frame, encode_frame, encode_request_frame,
    encode_response_frame, namespace_digest,
};
use serde_json::{Value, json};

const VECTORS: &str = include_str!("fixtures/source-slice-1-vectors.json");
const RECEIPT_POLICY: &str =
    include_str!("../../../contracts/github-program-receipt/github-program-receipt-policy.json");

fn fixture() -> Value {
    serde_json::from_str(VECTORS).expect("fixed fixture must be valid JSON")
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().expect("fixture string")
}

fn error_code(error: &BrokerError) -> &'static str {
    error.code().as_str()
}

fn hex_bytes(value: &str) -> [u8; 32] {
    let bytes = (0..32)
        .map(|index| u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("fixture hex"))
        .collect::<Vec<_>>();
    bytes.try_into().expect("32-byte fixture value")
}

fn hex_encode(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn test_digest() -> Digest {
    Digest::parse(&"a".repeat(64)).unwrap()
}

fn test_authority() -> AuthoritySnapshot {
    let digest = test_digest();
    AuthoritySnapshot {
        child_comment_id: 359,
        parent_comment_id: 240,
        node_id: "node-id".to_owned(),
        author_login: "owner".to_owned(),
        author_association: AuthorAssociation::Owner,
        body_digest: digest.clone(),
        updated_at: "2026-09-04T12:00:00.000Z".to_owned(),
        update_identity_digest: digest.clone(),
        scope_digest: digest,
    }
}

fn test_start() -> StartSnapshot {
    let digest = test_digest();
    StartSnapshot {
        base_sha: "0".repeat(40),
        head_sha: "1".repeat(40),
        tree_sha: "2".repeat(40),
        status_digest: digest,
        clean_worktree: true,
        ref_snapshot: RefSnapshot {
            detached: false,
            name: Some("refs/heads/main".to_owned()),
        },
    }
}

fn test_lease() -> Lease {
    Lease {
        lease_id: "lease-test".to_owned(),
        fence_id: "fence-test".to_owned(),
        fence_sequence: 1,
        issued_at: "2026-09-04T12:00:00.000Z".to_owned(),
        expires_at: "2026-09-04T13:00:00.000Z".to_owned(),
    }
}

fn test_allocation() -> RunAllocation {
    RunAllocation {
        allocation_id: "allocation-test".to_owned(),
        run_id: "run-test".to_owned(),
        lock: "lock-test".to_owned(),
        lease: test_lease(),
    }
}

fn test_receipt() -> ReceiptRecord {
    let mut receipt = ReceiptRecord {
        schema: "toolkit.github-program.run-receipt.v1".to_owned(),
        receipt_type: ReceiptType::RunStarted,
        receipt_id: Digest::zero(),
        sequence: 1,
        prior_receipt_id: None,
        run_id: "run-test".to_owned(),
        allocation_id: "allocation-test".to_owned(),
        repository: "weijunswj/ai-agent-toolkit".to_owned(),
        parent_issue: 240,
        child_issue: 359,
        lock: "lock-test".to_owned(),
        authority: test_authority(),
        start: test_start(),
        candidate: None,
        lease: test_lease(),
        payload: ReceiptPayload {
            classification: "RUN_STARTED".to_owned(),
            reason_code: None,
            outcome_digest: None,
            evidence_digest: None,
            operation_digest: None,
            detail_digest: None,
            mutation_outcome: None,
            evidence_refs: None,
        },
        created_at: "2026-09-04T12:00:00.000Z".to_owned(),
    };
    let mut value = serde_json::to_value(&receipt).unwrap();
    value.as_object_mut().unwrap().remove("receipt_id");
    receipt.receipt_id = canonical::canonical_digest(&value).unwrap();
    receipt
}

fn resign_receipt(mut receipt: ReceiptRecord) -> ReceiptRecord {
    let mut value = serde_json::to_value(&receipt).unwrap();
    value.as_object_mut().unwrap().remove("receipt_id");
    receipt.receipt_id = canonical::canonical_digest(&value).unwrap();
    receipt
}

fn test_receipt_chain() -> Vec<ReceiptRecord> {
    let first = test_receipt();
    let candidate = Candidate {
        pr_number: 374,
        branch: "luna/s2-e3-native-protected-broker-lock006-s1".to_owned(),
        base_ref: "main".to_owned(),
        base_sha: "0".repeat(40),
        head_sha: "1".repeat(40),
        tree_sha: "2".repeat(40),
    };
    let second = resign_receipt(ReceiptRecord {
        schema: first.schema.clone(),
        receipt_type: ReceiptType::TransitionPreview,
        receipt_id: Digest::zero(),
        sequence: 2,
        prior_receipt_id: Some(first.receipt_id.clone()),
        run_id: first.run_id.clone(),
        allocation_id: first.allocation_id.clone(),
        repository: first.repository.clone(),
        parent_issue: first.parent_issue,
        child_issue: first.child_issue,
        lock: first.lock.clone(),
        authority: first.authority.clone(),
        start: first.start.clone(),
        candidate: Some(candidate.clone()),
        lease: first.lease.clone(),
        payload: ReceiptPayload {
            classification: "TRANSITION_PREVIEW".to_owned(),
            reason_code: None,
            outcome_digest: None,
            evidence_digest: None,
            operation_digest: None,
            detail_digest: None,
            mutation_outcome: None,
            evidence_refs: None,
        },
        created_at: first.created_at.clone(),
    });
    let third = resign_receipt(ReceiptRecord {
        schema: second.schema.clone(),
        receipt_type: ReceiptType::ExecutorTerminal,
        receipt_id: Digest::zero(),
        sequence: 3,
        prior_receipt_id: Some(second.receipt_id.clone()),
        run_id: second.run_id.clone(),
        allocation_id: second.allocation_id.clone(),
        repository: second.repository.clone(),
        parent_issue: second.parent_issue,
        child_issue: second.child_issue,
        lock: second.lock.clone(),
        authority: second.authority.clone(),
        start: second.start.clone(),
        candidate: second.candidate.clone(),
        lease: second.lease.clone(),
        payload: ReceiptPayload {
            classification: "EXECUTOR_TERMINAL".to_owned(),
            reason_code: None,
            outcome_digest: None,
            evidence_digest: None,
            operation_digest: None,
            detail_digest: None,
            mutation_outcome: None,
            evidence_refs: None,
        },
        created_at: second.created_at.clone(),
    });
    vec![first, second, third]
}

fn mutation_logical_operation_digest(operation: &MutationOperation) -> Digest {
    canonical::canonical_digest_value(&json!({
        "operation_kind": &operation.operation_kind,
        "safety_class": &operation.safety_class,
        "target_identity": &operation.target_identity,
        "target_digest": &operation.target_digest,
        "expected_post_state_digest": &operation.expected_post_state_digest,
        "adapter_identity_digest": &operation.adapter_identity_digest,
    }))
    .unwrap()
}

fn mutation_operation_digest(operation: &MutationOperation) -> Digest {
    let target_identity_json = String::from_utf8(
        canonical::canonical_serialize_value(&operation.target_identity).unwrap(),
    )
    .unwrap();
    canonical::canonical_digest_value(&json!({
        "operation_id": &operation.operation_id,
        "logical_operation_digest": &operation.logical_operation_digest,
        "run_id": &operation.run_id,
        "allocation_id": &operation.allocation_id,
        "lock_id": &operation.lock,
        "authority_digest": &operation.authority_digest,
        "lease_id": &operation.lease_id,
        "fence_id": &operation.fence_id,
        "fence_sequence": operation.fence_sequence,
        "operation_kind": &operation.operation_kind,
        "safety_class": &operation.safety_class,
        "target_identity_json": target_identity_json,
        "target_digest": &operation.target_digest,
        "source_digest": &operation.expected_source_digest,
        "cas_digest": &operation.cas_digest,
        "expected_post_state_digest": &operation.expected_post_state_digest,
        "provider_operation_key": &operation.provider_operation_key,
        "adapter_identity_digest": &operation.adapter_identity_digest,
        "retry_of_operation_id": &operation.retry_of_operation_id,
        "created_at": &operation.created_at,
    }))
    .unwrap()
}

fn mutation_event_digest(event: &MutationEvent) -> Digest {
    canonical::canonical_digest_value(&json!({
        "event_id": &event.event_id,
        "operation_id": &event.operation_id,
        "sequence": event.sequence,
        "prior_event_id": &event.prior_event_id,
        "event_type": &event.event_type,
        "state": &event.state,
        "event_at": &event.event_at,
        "authority_digest": &event.authority_digest,
        "provider_evidence_digest": &event.provider_evidence_digest,
        "readback_digest": &event.readback_digest,
        "detail_digest": &event.detail_digest,
    }))
    .unwrap()
}

fn mutation_operation_digest_value(operation: &Value) -> Digest {
    let target_identity_json =
        String::from_utf8(canonical::canonical_serialize(&operation["target_identity"]).unwrap())
            .unwrap();
    canonical::canonical_digest_value(&json!({
        "operation_id": operation["operation_id"].clone(),
        "logical_operation_digest": operation["logical_operation_digest"].clone(),
        "run_id": operation["run_id"].clone(),
        "allocation_id": operation["allocation_id"].clone(),
        "lock_id": operation["lock"].clone(),
        "authority_digest": operation["authority_digest"].clone(),
        "lease_id": operation["lease_id"].clone(),
        "fence_id": operation["fence_id"].clone(),
        "fence_sequence": operation["fence_sequence"].clone(),
        "operation_kind": operation["operation_kind"].clone(),
        "safety_class": operation["safety_class"].clone(),
        "target_identity_json": target_identity_json,
        "target_digest": operation["target_digest"].clone(),
        "source_digest": operation["expected_source_digest"].clone(),
        "cas_digest": operation["cas_digest"].clone(),
        "expected_post_state_digest": operation["expected_post_state_digest"].clone(),
        "provider_operation_key": operation["provider_operation_key"].clone(),
        "adapter_identity_digest": operation["adapter_identity_digest"].clone(),
        "retry_of_operation_id": operation["retry_of_operation_id"].clone(),
        "created_at": operation["created_at"].clone(),
    }))
    .unwrap()
}

fn mutation_event_digest_value(event: &Value) -> Digest {
    canonical::canonical_digest_value(&json!({
        "event_id": event["event_id"].clone(),
        "operation_id": event["operation_id"].clone(),
        "sequence": event["sequence"].clone(),
        "prior_event_id": event["prior_event_id"].clone(),
        "event_type": event["event_type"].clone(),
        "state": event["state"].clone(),
        "event_at": event["event_at"].clone(),
        "authority_digest": event["authority_digest"].clone(),
        "provider_evidence_digest": event["provider_evidence_digest"].clone(),
        "readback_digest": event["readback_digest"].clone(),
        "detail_digest": event["detail_digest"].clone(),
    }))
    .unwrap()
}

fn test_mutation_event(
    sequence: u64,
    prior_event_id: Option<String>,
    event_type: &str,
    state: MutationState,
    digest: &Digest,
) -> MutationEvent {
    let mut event = MutationEvent {
        event_id: format!("event-{sequence}"),
        operation_id: "operation-test".to_owned(),
        sequence,
        prior_event_id,
        event_type: event_type.to_owned(),
        state,
        event_at: "2026-09-04T12:00:00.000Z".to_owned(),
        authority_digest: digest.clone(),
        provider_evidence_digest: digest.clone(),
        readback_digest: None,
        detail_digest: digest.clone(),
        event_digest: Digest::zero(),
    };
    event.event_digest = mutation_event_digest(&event);
    event
}

fn test_mutation_readback(state: MutationState) -> Readback {
    let target_identity = TargetIdentity {
        resource_type: "git_ref".to_owned(),
        resource_id: "refs/heads/main".to_owned(),
    };
    let target_digest = canonical::canonical_digest_value(&target_identity).unwrap();
    let digest = test_digest();
    let mut operation = MutationOperation {
        operation_id: "operation-test".to_owned(),
        logical_operation_digest: Digest::zero(),
        run_id: "run-test".to_owned(),
        allocation_id: "allocation-test".to_owned(),
        lock: "lock-test".to_owned(),
        authority_digest: digest.clone(),
        lease_id: "lease-test".to_owned(),
        fence_id: "fence-test".to_owned(),
        fence_sequence: 1,
        operation_kind: MutationOperationKind::GitRefUpdate,
        safety_class: SafetyClass::Cas,
        target_identity,
        target_digest,
        expected_source_digest: digest.clone(),
        cas_digest: digest.clone(),
        expected_post_state_digest: Some(digest.clone()),
        provider_operation_key: "gpr:operation-test".to_owned(),
        adapter_identity_digest: digest.clone(),
        retry_of_operation_id: None,
        created_at: "2026-09-04T12:00:00.000Z".to_owned(),
        operation_digest: Digest::zero(),
    };
    operation.logical_operation_digest = mutation_logical_operation_digest(&operation);
    operation.operation_digest = mutation_operation_digest(&operation);
    let prepared = test_mutation_event(1, None, "PREPARED", MutationState::Prepared, &digest);
    let in_flight = test_mutation_event(
        2,
        Some(prepared.event_id.clone()),
        "IN_FLIGHT",
        MutationState::InFlight,
        &digest,
    );
    let mut events = vec![prepared, in_flight];
    if state != MutationState::InFlight {
        events.push(test_mutation_event(
            3,
            Some(events[1].event_id.clone()),
            "OUTCOME_RECORDED",
            state.clone(),
            &digest,
        ));
    }
    Readback::Mutation {
        operation: Box::new(operation),
        state,
        events,
    }
}

fn test_recovery_record() -> RecoveryRecord {
    let digest = test_digest();
    let pre_recovery_evidence = PreRecoveryEvidence {
        schema: "toolkit.github-program.pre-recovery-evidence.v1".to_owned(),
        request_id: "request-test".to_owned(),
        repository: "weijunswj/ai-agent-toolkit".to_owned(),
        parent_issue: 240,
        child_issue: 359,
        lock: "lock-test".to_owned(),
        namespace_digest: digest.clone(),
        old_allocation_id: "allocation-test".to_owned(),
        old_run_id: "run-test".to_owned(),
        old_allocation_digest: digest.clone(),
        old_run_digest: digest.clone(),
        old_lease_id: "lease-test".to_owned(),
        old_fence_id: "fence-test".to_owned(),
        old_fence_sequence: 1,
        old_lease_issued_at: "2026-09-04T12:00:00.000Z".to_owned(),
        old_lease_expires_at: "2026-09-04T13:00:00.000Z".to_owned(),
        old_lease_tip_event_id: "event-test".to_owned(),
        old_lease_tip_event_digest: digest.clone(),
        old_receipt_tip_id: digest.clone(),
        old_receipt_tip_sequence: 1,
        old_receipt_tip_digest: digest.clone(),
        old_receipt_chain_digest: digest.clone(),
        zero_operation_count: 0,
        zero_operation_event_count: 0,
        zero_operation_inventory_digest: digest.clone(),
        authority_digest: digest.clone(),
        source_digest: digest.clone(),
        start_digest: digest.clone(),
        old_holder_classification: "ORPHAN_NONADOPTABLE".to_owned(),
        old_holder_identity_digest: digest.clone(),
        old_holder_attestation_digest: digest.clone(),
        recovery_peer_platform: "linux".to_owned(),
        recovery_peer_identity_digest: digest.clone(),
        recovery_peer_process_incarnation_digest: digest.clone(),
        broker_identity_digest: digest.clone(),
        broker_key_id: "broker-key".to_owned(),
        observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        authority_observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        source_observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        start_observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        store_observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        holder_observed_at: "2026-09-04T12:00:00.000Z".to_owned(),
    };
    let pre_recovery_evidence_digest =
        canonical::canonical_digest_value(&pre_recovery_evidence).unwrap();
    let mut record = RecoveryRecord {
        schema: "toolkit.github-program.recovery-record.v1".to_owned(),
        recovery_record_id: "recovery-test".to_owned(),
        request_id: "request-test".to_owned(),
        namespace_digest: digest.clone(),
        old_allocation_id: "allocation-test".to_owned(),
        old_run_id: "run-test".to_owned(),
        old_lease_id: "lease-test".to_owned(),
        old_fence_id: "fence-test".to_owned(),
        old_fence_sequence: 1,
        pre_recovery_evidence,
        pre_recovery_evidence_digest,
        terminal_receipt_id: digest.clone(),
        terminal_receipt_digest: digest.clone(),
        release_event_id: "release-event".to_owned(),
        release_event_digest: digest.clone(),
        replacement_allocation_id: "replacement-allocation".to_owned(),
        replacement_allocation_digest: digest.clone(),
        replacement_run_id: "replacement-run".to_owned(),
        replacement_run_digest: digest.clone(),
        replacement_lease_id: "replacement-lease".to_owned(),
        replacement_fence_id: "replacement-fence".to_owned(),
        replacement_fence_sequence: 2,
        replacement_holder_attestation_id: "replacement-holder".to_owned(),
        replacement_holder_attestation_digest: digest.clone(),
        new_high_water: 2,
        authority_digest: digest.clone(),
        source_digest: digest.clone(),
        start_digest: digest,
        committed_at: "2026-09-04T12:00:00.000Z".to_owned(),
        recovery_record_digest: Digest::zero(),
    };
    let mut value = serde_json::to_value(&record).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .remove("recovery_record_digest");
    record.recovery_record_digest = canonical::canonical_digest(&value).unwrap();
    record
}

fn exact_success_values() -> Vec<(OperationKind, SuccessValue)> {
    let namespace = Namespace {
        repository: "weijunswj/ai-agent-toolkit".to_owned(),
        parent_issue: 240,
        child_issue: 359,
    };
    let namespace_readback = Readback::Namespace {
        namespace: namespace.clone(),
        namespace_digest: namespace_digest(&namespace).unwrap(),
    };
    let digest = test_digest();
    let receipt = test_receipt();
    let allocation = test_allocation();
    vec![
        (
            OperationKind::ReadbackInspection,
            SuccessValue::ReadbackInspection {
                target: ReadbackTarget::Namespace,
                readback: namespace_readback.clone(),
            },
        ),
        (
            OperationKind::AllocateRun,
            SuccessValue::AllocateRun {
                allocation: allocation.clone(),
                started: false,
                run_started_receipt_id: None,
            },
        ),
        (
            OperationKind::StartRun,
            SuccessValue::StartRun {
                allocation: allocation.clone(),
                started: true,
                run_started_receipt_id: Some(digest.clone()),
            },
        ),
        (
            OperationKind::AppendReceipt,
            SuccessValue::AppendReceipt {
                receipt: receipt.clone(),
                duplicate: false,
            },
        ),
        (
            OperationKind::InterruptRun,
            SuccessValue::InterruptRun {
                receipt,
                duplicate: false,
            },
        ),
        (
            OperationKind::MutationAdmit,
            SuccessValue::MutationAdmit {
                readback: test_mutation_readback(MutationState::InFlight),
            },
        ),
        (
            OperationKind::MutationDispatch,
            SuccessValue::MutationDispatch {
                readback: test_mutation_readback(MutationState::InFlight),
            },
        ),
        (
            OperationKind::MutationOutcome,
            SuccessValue::MutationOutcome {
                readback: test_mutation_readback(MutationState::Applied),
            },
        ),
        (
            OperationKind::MutationReconcile,
            SuccessValue::MutationReconcile {
                readback: namespace_readback,
            },
        ),
        (
            OperationKind::OrphanRecovery,
            SuccessValue::OrphanRecovery {
                recovery_record: Box::new(test_recovery_record()),
                replacement_allocation: allocation,
            },
        ),
        (
            OperationKind::MigrateV2ToV3,
            SuccessValue::MigrateV2ToV3 {
                status: "MIGRATED".to_owned(),
                source_schema_fingerprint: digest.clone(),
                destination_schema_fingerprint: digest.clone(),
                namespace_digest: digest.clone(),
                store_binding_digest: digest,
            },
        ),
    ]
}

fn success_response_frame(operation: OperationKind, value: Value) -> Vec<u8> {
    let result_without_digest = json!({
        "operation": operation.as_str(),
        "value": value,
    });
    let result = json!({
        "operation": operation.as_str(),
        "value": result_without_digest["value"].clone(),
        "result_digest": canonical::canonical_digest(&result_without_digest).unwrap(),
    });
    let response = serde_json::json!({
        "schema": "toolkit.github-program.broker-ipc.v1",
        "request_id": "0123456789abcdef0123456789abcdef",
        "ok": true,
        "result": result,
        "error": null,
    });
    encode_frame(&canonical::canonical_serialize(&response).unwrap()).unwrap()
}

fn assert_invalid_success_shape(operation: OperationKind, value: Value) {
    let frame = success_response_frame(operation, value);
    assert!(
        decode_response_frame(&frame).is_err(),
        "wrong success shape unexpectedly decoded for {}",
        operation.as_str()
    );
}

fn receipt_chain_response_frame(receipts: Vec<Value>, run_id: &str) -> Vec<u8> {
    let chain_digest = canonical::canonical_digest(&Value::Array(receipts.clone())).unwrap();
    success_response_frame(
        OperationKind::ReadbackInspection,
        json!({
            "kind": "READBACK_INSPECTION",
            "target": "RECEIPT_CHAIN",
            "readback": {
                "kind": "RECEIPT_CHAIN",
                "run_id": run_id,
                "receipts": receipts,
                "chain_digest": chain_digest,
            },
        }),
    )
}

fn resign_receipt_value(receipt: &mut Value) {
    let mut payload = receipt.clone();
    payload.as_object_mut().unwrap().remove("receipt_id");
    let receipt_id = canonical::canonical_digest(&payload).unwrap();
    receipt["receipt_id"] = Value::String(receipt_id.as_str().to_owned());
}

#[test]
fn canonical_goldens_are_fixed_and_byte_exact() {
    let root = fixture();
    for case in root["canonical_cases"].as_array().expect("canonical cases") {
        let serialized = canonical::canonical_serialize(&case["value"]).expect("canonical value");
        assert_eq!(
            serialized,
            text(case, "serialized").as_bytes(),
            "{}",
            text(case, "name")
        );
        assert_eq!(
            canonical::canonical_digest(&case["value"])
                .expect("canonical digest")
                .as_str(),
            text(case, "digest"),
            "{}",
            text(case, "name")
        );
    }
    assert_eq!(
        canonical::canonical_serialize(&serde_json::json!(-0)).unwrap(),
        b"0"
    );
    assert!(canonical::canonical_serialize(&serde_json::json!(1.5)).is_err());
}

#[test]
fn lone_surrogate_vectors_are_preserved_as_raw_canonical_json() {
    let root = fixture();
    for case in root["surrogate_cases"].as_array().expect("surrogate cases") {
        let value = canonical::parse_json(text(case, "raw").as_bytes(), ParseLimits::PROTOCOL)
            .expect("raw surrogate JSON");
        let serialized = canonical::canonical_serialize(&value).expect("surrogate serialization");
        assert_eq!(
            hex_encode(&serialized),
            text(case, "serialized_hex"),
            "{}",
            text(case, "name")
        );
        assert_eq!(
            canonical::canonical_digest(&value).unwrap().as_str(),
            text(case, "digest"),
            "{}",
            text(case, "name")
        );
    }
}

#[test]
fn strict_json_rejects_noncanonical_numbers_duplicates_and_limits() {
    let root = fixture();
    for case in root["invalid_json"].as_array().expect("invalid cases") {
        let error = canonical::parse_json(text(case, "raw").as_bytes(), ParseLimits::PROTOCOL)
            .expect_err("invalid JSON must fail closed");
        assert_eq!(
            error_code(&error),
            text(case, "code"),
            "{}",
            text(case, "name")
        );
    }

    let max_depth = format!(
        "{}0{}",
        "[".repeat(MAX_NESTING_DEPTH),
        "]".repeat(MAX_NESTING_DEPTH)
    );
    assert!(canonical::parse_json(max_depth.as_bytes(), ParseLimits::PROTOCOL).is_ok());
    let over_depth = format!(
        "{}0{}",
        "[".repeat(MAX_NESTING_DEPTH + 1),
        "]".repeat(MAX_NESTING_DEPTH + 1)
    );
    assert_eq!(
        error_code(
            &canonical::parse_json(over_depth.as_bytes(), ParseLimits::PROTOCOL).unwrap_err()
        ),
        ErrorCode::LimitViolation.as_str()
    );
    let over_array = format!("[{}]", (0..257).map(|_| "0").collect::<Vec<_>>().join(","));
    assert_eq!(
        error_code(
            &canonical::parse_json(over_array.as_bytes(), ParseLimits::PROTOCOL).unwrap_err()
        ),
        ErrorCode::LimitViolation.as_str()
    );
    let over_object = format!(
        "{{{}}}",
        (0..65)
            .map(|index| format!("\"k{index}\":0"))
            .collect::<Vec<_>>()
            .join(",")
    );
    assert_eq!(
        error_code(
            &canonical::parse_json(over_object.as_bytes(), ParseLimits::PROTOCOL).unwrap_err()
        ),
        ErrorCode::LimitViolation.as_str()
    );
    let over_string = format!("\"{}\"", "x".repeat(4_097));
    assert_eq!(
        error_code(
            &canonical::parse_json(over_string.as_bytes(), ParseLimits::PROTOCOL).unwrap_err()
        ),
        ErrorCode::LimitViolation.as_str()
    );
}

#[test]
fn request_golden_digest_and_frame_are_exact() {
    let root = fixture();
    let request_case = &root["request"];
    let request = Request::from_canonical_json(text(request_case, "serialized").as_bytes())
        .expect("request fixture");
    assert_eq!(
        request.digest().unwrap().as_str(),
        text(request_case, "digest")
    );

    let frame = encode_request_frame(&request).expect("request frame");
    assert_eq!(&frame[..4], [0x00, 0x00, 0x03, 0xde]);
    assert_eq!(
        frame.len(),
        4 + request_case["payload_length"].as_u64().unwrap() as usize
    );
    assert_eq!(decode_request_frame(&frame).unwrap(), request);

    let mut changed: Value = serde_json::from_str(text(request_case, "serialized")).unwrap();
    changed["lock"] = Value::String("another-authorized-lock".to_owned());
    let changed_bytes = canonical::canonical_serialize(&changed).unwrap();
    let changed_request = Request::from_canonical_json(&changed_bytes).unwrap();
    assert_ne!(changed_request.digest().unwrap(), request.digest().unwrap());
}

#[test]
fn holder_hmac_digest_and_identity_vectors_are_exact() {
    let root = fixture();
    let holder_case = &root["holder"];
    let holder: HolderAttestation = serde_json::from_value(holder_case["value"].clone()).unwrap();
    let key = HolderKey::from_bytes(hex_bytes(text(holder_case, "key_hex")));
    verify_holder_attestation(&holder, &key).expect("fixed holder attestation");
    assert_eq!(
        holder_tag(&holder, &key).unwrap().as_str(),
        text(holder_case, "tag")
    );
    assert_eq!(
        holder_attestation_digest(&holder).unwrap().as_str(),
        text(holder_case, "attestation_digest")
    );

    let mut unsigned = holder.clone();
    unsigned.attestation_digest = Digest::zero();
    unsigned.attestation_tag = Digest::zero();
    assert_eq!(sign_holder_attestation(unsigned, &key).unwrap(), holder);

    let mut tampered = holder.clone();
    tampered.attestation_tag = Digest::zero();
    assert_eq!(
        error_code(&verify_holder_attestation(&tampered, &key).unwrap_err()),
        ErrorCode::UnverifiableIdentity.as_str()
    );

    let principal = linux_principal_digest("0123456789abcdef0123456789abcdef", 1_000).unwrap();
    let process = process_identity_digest("linux", u64::MAX).unwrap();
    let process_start =
        process_start_identity_digest("linux", &process, 9_007_199_254_740_991).unwrap();
    let boot = boot_identity_digest("linux", "boot-golden").unwrap();
    let pid_namespace = pid_namespace_identity_digest("linux", "pidns-golden").unwrap();
    let broker = broker_identity_digest(
        "linux",
        &Digest::parse(&"a".repeat(64)).unwrap(),
        "trusted-broker",
    )
    .unwrap();
    let process_incarnation = process_incarnation_digest(
        "linux",
        &principal,
        &process,
        &process_start,
        &boot,
        &pid_namespace,
        "session-peer-golden",
    )
    .unwrap();
    let expected = [
        ("principal", principal),
        ("broker", broker),
        ("process", process),
        ("process-start", process_start),
        ("boot", boot),
        ("pid-namespace", pid_namespace),
        ("process-incarnation", process_incarnation),
        (
            "store-binding",
            store_binding_identity_digest(
                &Digest::parse(&"a".repeat(64)).unwrap(),
                &Digest::parse(&"b".repeat(64)).unwrap(),
            )
            .unwrap(),
        ),
        (
            "path-binding",
            path_binding_identity_digest(
                &Digest::parse(&"a".repeat(64)).unwrap(),
                &Digest::parse(&"b".repeat(64)).unwrap(),
            )
            .unwrap(),
        ),
    ];
    for (name, actual) in expected {
        let case = root["identities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap();
        assert_eq!(actual.as_str(), text(case, "digest"), "{name}");
        assert_eq!(
            canonical::canonical_serialize(&case["value"]).unwrap(),
            text(case, "serialized").as_bytes()
        );
    }
    assert_eq!(
        error_code(
            &principal_digest(
                "freebsd",
                &Principal::Linux {
                    machine_id: "0123456789abcdef0123456789abcdef".to_owned(),
                    uid: 1_000,
                },
            )
            .unwrap_err(),
        ),
        ErrorCode::UnsupportedPlatform.as_str()
    );
    assert!(KeyId::parse("0123456789abcdef0123456789abcdef").is_ok());
    assert!(KeyId::parse("0123456789abcdef0123456789abcdeg").is_err());
}

#[test]
fn typed_response_result_and_failure_request_id_are_closed_and_digest_bound() {
    let namespace = Namespace {
        repository: "weijunswj/ai-agent-toolkit".to_owned(),
        parent_issue: 240,
        child_issue: 359,
    };
    let readback = Readback::Namespace {
        namespace: namespace.clone(),
        namespace_digest: namespace_digest(&namespace).unwrap(),
    };
    let request_id = RequestId::parse("0123456789abcdef0123456789abcdef").unwrap();
    let response = Response::success(
        request_id.clone(),
        OperationKind::ReadbackInspection,
        SuccessValue::ReadbackInspection {
            target: ReadbackTarget::Namespace,
            readback,
        },
    )
    .unwrap();
    let frame = encode_response_frame(&response).unwrap();
    assert_eq!(decode_response_frame(&frame).unwrap(), response);

    let mut tampered = serde_json::to_value(&response).unwrap();
    tampered["result"]["result_digest"] = Value::String("0".repeat(64));
    let tampered_frame = encode_frame(&canonical::canonical_serialize(&tampered).unwrap()).unwrap();
    assert_eq!(
        error_code(&decode_response_frame(&tampered_frame).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let failure = Response::failure(&BrokerError::new(ErrorCode::UnsupportedPlatform));
    let decoded_failure = decode_response_frame(&encode_response_frame(&failure).unwrap()).unwrap();
    assert_eq!(decoded_failure, failure);
    assert_eq!(
        decoded_failure.error.unwrap().code,
        ErrorCode::UnsupportedPlatform.as_str()
    );
    let parse_failure = Response::failure(&BrokerError::new(ErrorCode::MalformedRequest));
    assert_eq!(
        decode_response_frame(&encode_response_frame(&parse_failure).unwrap()).unwrap(),
        parse_failure
    );
}

#[test]
fn exact_success_value_algebra_round_trips_and_rejects_superseded_shapes() {
    let request_id = RequestId::parse("0123456789abcdef0123456789abcdef").unwrap();
    let values = exact_success_values();
    for (operation, value) in &values {
        let response = Response::success(request_id.clone(), *operation, value.clone()).unwrap();
        let frame = encode_response_frame(&response).unwrap();
        assert_eq!(
            decode_response_frame(&frame).unwrap(),
            response,
            "{operation:?}"
        );
    }

    let mut wrong = serde_json::to_value(&values[0].1).unwrap();
    wrong.as_object_mut().unwrap().remove("target");
    assert_invalid_success_shape(OperationKind::ReadbackInspection, wrong);

    let mut wrong = serde_json::to_value(&values[1].1).unwrap();
    wrong.as_object_mut().unwrap().remove("started");
    wrong
        .as_object_mut()
        .unwrap()
        .remove("run_started_receipt_id");
    assert_invalid_success_shape(OperationKind::AllocateRun, wrong);

    let mut wrong = serde_json::to_value(&values[2].1).unwrap();
    wrong["started"] = Value::Bool(false);
    wrong["run_started_receipt_id"] = Value::Null;
    assert_invalid_success_shape(OperationKind::StartRun, wrong);

    let mut wrong = serde_json::to_value(&values[3].1).unwrap();
    wrong.as_object_mut().unwrap().remove("duplicate");
    wrong["chain_digest"] = Value::String("a".repeat(64));
    assert_invalid_success_shape(OperationKind::AppendReceipt, wrong);

    let mut wrong = serde_json::to_value(&values[4].1).unwrap();
    wrong.as_object_mut().unwrap().remove("duplicate");
    assert_invalid_success_shape(OperationKind::InterruptRun, wrong);

    let mutation = serde_json::to_value(test_mutation_readback(MutationState::InFlight)).unwrap();
    assert_invalid_success_shape(
        OperationKind::MutationAdmit,
        serde_json::json!({"kind": "MUTATION_ADMIT", "operation": mutation["operation"]}),
    );
    assert_invalid_success_shape(
        OperationKind::MutationDispatch,
        serde_json::json!({"kind": "MUTATION_DISPATCH", "event": mutation["events"][0]}),
    );
    assert_invalid_success_shape(
        OperationKind::MutationOutcome,
        serde_json::json!({
            "kind": "MUTATION_OUTCOME",
            "operation": mutation["operation"],
            "event": mutation["events"][0]
        }),
    );

    let mut wrong = serde_json::to_value(&values[8].1).unwrap();
    wrong["operation"] = mutation["operation"].clone();
    assert_invalid_success_shape(OperationKind::MutationReconcile, wrong);

    assert_invalid_success_shape(
        OperationKind::OrphanRecovery,
        serde_json::json!({"kind": "ORPHAN_RECOVERY", "recovery": mutation}),
    );
    assert_invalid_success_shape(
        OperationKind::MigrateV2ToV3,
        serde_json::json!({
            "kind": "MIGRATE_V2_TO_V3",
            "source_schema_fingerprint": "a".repeat(64),
            "result_digest": "a".repeat(64)
        }),
    );
}

#[test]
fn mutation_readback_rejects_forged_inner_digests_and_semantics_after_outer_redigest() {
    let valid = serde_json::to_value(test_mutation_readback(MutationState::Applied)).unwrap();
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": valid.clone() }),
        ))
        .is_ok()
    );

    let mut forged = valid.clone();
    forged["operation"]["logical_operation_digest"] = Value::String("b".repeat(64));
    let operation_digest = mutation_operation_digest_value(&forged["operation"]);
    forged["operation"]["operation_digest"] = Value::String(operation_digest.as_str().to_owned());
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["operation"]["operation_digest"] = Value::String("b".repeat(64));
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["events"][0]["event_digest"] = Value::String("b".repeat(64));
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    let mut events = forged["events"].as_array().unwrap().clone();
    events.swap(1, 2);
    forged["events"] = Value::Array(events);
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["events"][2]["prior_event_id"] = Value::String("event-1".to_owned());
    let event_digest = mutation_event_digest_value(&forged["events"][2]);
    forged["events"][2]["event_digest"] = Value::String(event_digest.as_str().to_owned());
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["events"][0]["event_at"] = Value::String("2026-09-04T12:01:00.000Z".to_owned());
    let event_digest = mutation_event_digest_value(&forged["events"][0]);
    forged["events"][0]["event_digest"] = Value::String(event_digest.as_str().to_owned());
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["state"] = Value::String("PREPARED".to_owned());
    forged["events"][2]["state"] = Value::String("PREPARED".to_owned());
    let event_digest = mutation_event_digest_value(&forged["events"][2]);
    forged["events"][2]["event_digest"] = Value::String(event_digest.as_str().to_owned());
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );

    let mut forged = valid.clone();
    forged["events"][1]["event_type"] = Value::String(String::new());
    let event_digest = mutation_event_digest_value(&forged["events"][1]);
    forged["events"][1]["event_digest"] = Value::String(event_digest.as_str().to_owned());
    assert!(
        decode_response_frame(&success_response_frame(
            OperationKind::MutationOutcome,
            json!({ "kind": "MUTATION_OUTCOME", "readback": forged }),
        ))
        .is_err()
    );
}

#[test]
fn receipt_chain_readback_rejects_forged_semantics_after_chain_and_outer_redigest() {
    let valid: Vec<Value> = test_receipt_chain()
        .into_iter()
        .map(|receipt| serde_json::to_value(receipt).unwrap())
        .collect();
    assert!(
        decode_response_frame(&receipt_chain_response_frame(valid.clone(), "run-test",)).is_ok()
    );

    let mut forged = valid.clone();
    forged[2]["run_id"] = Value::String("other-run".to_owned());
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[2]["lock"] = Value::String("other-lock".to_owned());
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[2]["prior_receipt_id"] = Value::String("f".repeat(64));
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[1]["created_at"] = Value::String("2026-09-04T12:01:00.000Z".to_owned());
    resign_receipt_value(&mut forged[1]);
    forged[2]["prior_receipt_id"] = forged[1]["receipt_id"].clone();
    forged[2]["created_at"] = Value::String("2026-09-04T12:00:30.000Z".to_owned());
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[2]["candidate"]["pr_number"] = Value::Number(375.into());
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    let mut reordered = forged.clone();
    reordered.swap(1, 2);
    forged = reordered;
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[0]["candidate"] = forged[1]["candidate"].clone();
    resign_receipt_value(&mut forged[0]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid.clone();
    forged[1]["receipt_type"] = Value::String("EXECUTOR_TERMINAL".to_owned());
    resign_receipt_value(&mut forged[1]);
    forged[2]["prior_receipt_id"] = forged[1]["receipt_id"].clone();
    resign_receipt_value(&mut forged[2]);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());

    let mut forged = valid;
    let mut after_terminal = forged[2].clone();
    after_terminal["receipt_type"] = Value::String("TRANSITION_PREVIEW".to_owned());
    after_terminal["sequence"] = Value::Number(4.into());
    after_terminal["prior_receipt_id"] = forged[2]["receipt_id"].clone();
    after_terminal["payload"]["classification"] = Value::String("AFTER_TERMINAL".to_owned());
    resign_receipt_value(&mut after_terminal);
    forged.push(after_terminal);
    assert!(decode_response_frame(&receipt_chain_response_frame(forged, "run-test",)).is_err());
}

#[test]
fn request_id_context_preserves_only_the_parser_owned_id() {
    let root = fixture();
    let request_value: Value = serde_json::from_str(text(&root["request"], "serialized")).unwrap();
    let request_frame =
        encode_frame(&canonical::canonical_serialize(&request_value).unwrap()).unwrap();
    let request = decode_request_frame(&request_frame).unwrap();
    let request_id = request.request_id.as_str().to_owned();
    assert!(request_id.len() == 32);

    let mut invalid_value = request_value.clone();
    invalid_value["operation"]["descriptor"]["target_identity"]["resource_id"] =
        Value::String("invalid target".to_owned());
    let error = decode_request_frame(
        &encode_frame(&canonical::canonical_serialize(&invalid_value).unwrap()).unwrap(),
    )
    .unwrap_err();
    assert_eq!(error.request_id().unwrap().as_str(), request_id);
    let failure = error.failure_response();
    assert_eq!(failure.request_id.as_ref().unwrap().as_str(), request_id);
    assert!(failure.validate_for_request(&request).is_ok());

    let wrong_id = if request_id == "f".repeat(32) {
        "e".repeat(32)
    } else {
        "f".repeat(32)
    };
    let mut substituted = serde_json::to_value(&failure).unwrap();
    substituted["request_id"] = Value::String(wrong_id);
    let substituted = decode_response_frame(
        &encode_frame(&canonical::canonical_serialize(&substituted).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        error_code(&substituted.validate_for_request(&request).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let pre_id = decode_request_frame(&[0, 0, 0]).unwrap_err();
    assert!(pre_id.request_id().is_none());
    let pre_id_response = pre_id.failure_response();
    assert!(pre_id_response.request_id.is_none());
    pre_id_response.validate().unwrap();

    let mut success = serde_json::to_value(
        Response::success(
            request.request_id.clone(),
            OperationKind::ReadbackInspection,
            SuccessValue::ReadbackInspection {
                target: ReadbackTarget::Namespace,
                readback: Readback::Namespace {
                    namespace: Namespace {
                        repository: "weijunswj/ai-agent-toolkit".to_owned(),
                        parent_issue: 240,
                        child_issue: 359,
                    },
                    namespace_digest: namespace_digest(&Namespace {
                        repository: "weijunswj/ai-agent-toolkit".to_owned(),
                        parent_issue: 240,
                        child_issue: 359,
                    })
                    .unwrap(),
                },
            },
        )
        .unwrap(),
    )
    .unwrap();
    assert!(success["request_id"].is_string());
    success["request_id"] = Value::Null;
    assert!(
        decode_response_frame(
            &encode_frame(&canonical::canonical_serialize(&success).unwrap()).unwrap(),
        )
        .is_err()
    );
}

#[test]
fn target_identity_and_frames_fail_closed_at_authoritative_boundaries() {
    let valid = TargetIdentity {
        resource_type: "r".repeat(80),
        resource_id: "i".repeat(512),
    };
    valid.validate().unwrap();
    assert!(
        TargetIdentity {
            resource_type: "r".repeat(81),
            resource_id: "i".to_owned(),
        }
        .validate()
        .is_err()
    );
    assert!(
        TargetIdentity {
            resource_type: "r".to_owned(),
            resource_id: "i".repeat(513),
        }
        .validate()
        .is_err()
    );
    assert!(canonical::canonical_serialize_value(&valid).unwrap().len() <= 2_048);

    assert_eq!(
        error_code(&encode_frame(&vec![b'x'; MAX_FRAME_PAYLOAD_BYTES + 1]).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );
    assert_eq!(
        error_code(&decode_frame(&[0, 0, 0]).unwrap_err()),
        ErrorCode::MalformedFrame.as_str()
    );
    assert_eq!(
        error_code(&decode_frame(&[0, 0, 0, 5, b'{']).unwrap_err()),
        ErrorCode::MalformedFrame.as_str()
    );
    assert_eq!(
        error_code(&decode_frame(&[0, 1, 0, 1]).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );
}

#[test]
fn policy_binds_the_protocol_without_authorising_protected_runtime() {
    let policy: Value = serde_json::from_str(RECEIPT_POLICY).unwrap();
    assert_eq!(
        policy["broker_ipc"]["schema"],
        "toolkit.github-program.broker-ipc.v1"
    );
    assert_eq!(
        policy["broker_ipc"]["contract_file"],
        "broker-ipc-v1.schema.json"
    );
    assert_eq!(
        policy["broker_ipc"]["replay_persistence"]["protected_sqlite_implementation"],
        false
    );
    assert_eq!(
        policy["sqlite"]["v3_dormant_contract"]["holder_attestation"]["process_id_digest"],
        "SHA256(canonicalSerialize([\"toolkit.github-program.process-id.v1\", platform, pid_decimal_string]))"
    );
}
