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
    MAX_FRAME_PAYLOAD_BYTES, MAX_NESTING_DEPTH, Namespace, Readback, Request, RequestId, Response,
    decode_frame, decode_request_frame, decode_response_frame, encode_frame, encode_request_frame,
    encode_response_frame,
};
use serde_json::Value;

const VECTORS: &str = include_str!("fixtures/source-slice-1-vectors.json");

fn fixture() -> Value {
    serde_json::from_str(VECTORS).expect("fixed fixture must be valid JSON")
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().expect("fixture string")
}

fn error_code(error: &BrokerError) -> &'static str {
    error.code().as_str()
}

fn hex_array(value: &str) -> [u8; 32] {
    let bytes = (0..32)
        .map(|index| u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("fixture hex"))
        .collect::<Vec<_>>();
    bytes.try_into().expect("32-byte fixture key")
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
}

#[test]
fn strict_json_rejects_floats_exponents_and_unsafe_integers() {
    let root = fixture();
    for case in root["invalid_json"].as_array().expect("invalid cases") {
        let error = canonical::parse_json(text(case, "raw").as_bytes(), ParseLimits::PROTOCOL)
            .expect_err("invalid number must fail closed");
        assert_eq!(
            error_code(&error),
            text(case, "code"),
            "{}",
            text(case, "name")
        );
    }
    assert_eq!(
        canonical::canonical_serialize(&serde_json::json!(-0)).expect("negative zero"),
        b"0"
    );
    assert!(canonical::canonical_serialize(&serde_json::json!(1.5)).is_err());
}

#[test]
fn request_golden_digest_and_frame_are_exact() {
    let root = fixture();
    let request_case = &root["request"];
    let request = Request::from_canonical_json(text(request_case, "serialized").as_bytes())
        .expect("request fixture");
    assert_eq!(
        request.digest().expect("request digest").as_str(),
        text(request_case, "digest")
    );

    let frame = encode_request_frame(&request).expect("request frame");
    let expected_prefix = [0x00, 0x00, 0x03, 0xde];
    assert_eq!(&frame[..4], expected_prefix);
    assert_eq!(
        frame.len(),
        4 + request_case["payload_length"].as_u64().unwrap() as usize
    );
    assert_eq!(
        decode_request_frame(&frame).expect("decoded request"),
        request
    );
}

#[test]
fn holder_tag_and_attestation_digest_follow_the_locked_exclusions() {
    let root = fixture();
    let holder_case = &root["holder"];
    let holder: HolderAttestation =
        serde_json::from_value(holder_case["value"].clone()).expect("holder fixture");
    let key = HolderKey::from_bytes(hex_array(text(holder_case, "key_hex")));
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
    let signed = sign_holder_attestation(unsigned, &key).expect("test signing");
    assert_eq!(signed, holder);

    let mut tampered_tag = holder.clone();
    tampered_tag.attestation_tag = Digest::zero();
    assert_eq!(
        error_code(&verify_holder_attestation(&tampered_tag, &key).unwrap_err()),
        ErrorCode::UnverifiableIdentity.as_str()
    );
    let mut tampered_digest = holder;
    tampered_digest.attestation_digest = Digest::zero();
    assert_eq!(
        error_code(&verify_holder_attestation(&tampered_digest, &key).unwrap_err()),
        ErrorCode::UnverifiableIdentity.as_str()
    );
}

#[test]
fn key_id_validation_is_exact_and_serde_matches() {
    let cases = [
        ("0123456789abcdef0123456789abcdef", true),
        ("key-id", false),
        ("0123456789ABCDEF0123456789abcdef", false),
        ("0123456789abcdef0123456789abcdeg", false),
        ("0123456789abcdef0123456789abcde", false),
        ("0123456789abcdef0123456789abcdef0", false),
    ];
    for (value, valid) in cases {
        assert_eq!(KeyId::parse(value).is_ok(), valid, "parse: {value}");
        assert_eq!(
            serde_json::from_value::<KeyId>(Value::String(value.to_owned())).is_ok(),
            valid,
            "serde: {value}"
        );
    }
}

#[test]
fn holder_validation_matches_contract_identifier_and_timestamp_bounds() {
    let root = fixture();
    let holder: HolderAttestation =
        serde_json::from_value(root["holder"]["value"].clone()).expect("holder fixture");

    let mut bad_identifier = holder.clone();
    bad_identifier.attestation_id = "_bad".to_owned();
    assert_eq!(
        error_code(&holder_tag(&bad_identifier, &HolderKey::from_bytes([0; 32])).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let mut bad_expiry = holder.clone();
    bad_expiry.lease_expires_at = bad_expiry.lease_issued_at.clone();
    assert_eq!(
        error_code(&holder_tag(&bad_expiry, &HolderKey::from_bytes([0; 32])).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let mut bad_date = holder;
    bad_date.lease_issued_at = "2026-02-30T12:00:00.000Z".to_owned();
    assert_eq!(
        error_code(&bad_date.validate().unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );
}

#[test]
fn trusted_identity_goldens_preserve_64_bit_values_as_decimal_strings() {
    let root = fixture();
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
    for identity in root["identities"].as_array().expect("identity cases") {
        let actual = match text(identity, "name") {
            "principal" => principal.clone(),
            "broker" => broker.clone(),
            "process" => process.clone(),
            "process-start" => process_start.clone(),
            "boot" => boot.clone(),
            "pid-namespace" => pid_namespace.clone(),
            "process-incarnation" => process_incarnation_digest(
                "linux",
                &principal,
                &process,
                &process_start,
                &boot,
                &pid_namespace,
                "session-peer-golden",
            )
            .unwrap(),
            "store-binding" => store_binding_identity_digest(
                &Digest::parse(&"a".repeat(64)).unwrap(),
                &Digest::parse(&"b".repeat(64)).unwrap(),
            )
            .unwrap(),
            "path-binding" => path_binding_identity_digest(
                &Digest::parse(&"a".repeat(64)).unwrap(),
                &Digest::parse(&"b".repeat(64)).unwrap(),
            )
            .unwrap(),
            other => panic!("unknown identity fixture {other}"),
        };
        assert_eq!(
            actual.as_str(),
            text(identity, "digest"),
            "{}",
            text(identity, "name")
        );
        assert_eq!(
            canonical::canonical_serialize(&identity["value"]).unwrap(),
            text(identity, "serialized").as_bytes()
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
}

#[test]
fn frames_and_limits_fail_closed_without_trailing_or_invalid_data() {
    let root = fixture();
    let request = text(&root["request"], "serialized").as_bytes();
    assert_eq!(
        &encode_frame(request).unwrap()[..4],
        [0x00, 0x00, 0x03, 0xde]
    );
    assert_eq!(
        &encode_frame(&vec![b'x'; MAX_FRAME_PAYLOAD_BYTES]).unwrap()[..4],
        [0x00, 0x01, 0x00, 0x00]
    );
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
    let mut trailing = encode_frame(request).unwrap();
    trailing.push(b'x');
    assert_eq!(
        error_code(&decode_frame(&trailing).unwrap_err()),
        ErrorCode::MalformedFrame.as_str()
    );
    assert_eq!(
        error_code(&decode_request_frame(&encode_frame(&[0xff]).unwrap()).unwrap_err()),
        ErrorCode::MalformedRequest.as_str()
    );
    assert_eq!(
        error_code(&decode_frame(&[0, 1, 0, 1]).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );

    let limits = ParseLimits::PROTOCOL;
    let max_depth = format!(
        "{}0{}",
        "[".repeat(MAX_NESTING_DEPTH),
        "]".repeat(MAX_NESTING_DEPTH)
    );
    assert!(canonical::parse_json(max_depth.as_bytes(), limits).is_ok());
    let over_depth = format!(
        "{}0{}",
        "[".repeat(MAX_NESTING_DEPTH + 1),
        "]".repeat(MAX_NESTING_DEPTH + 1)
    );
    assert_eq!(
        error_code(&canonical::parse_json(over_depth.as_bytes(), limits).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );
    let over_array = format!("[{}]", (0..257).map(|_| "0").collect::<Vec<_>>().join(","));
    assert_eq!(
        error_code(&canonical::parse_json(over_array.as_bytes(), limits).unwrap_err()),
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
        error_code(&canonical::parse_json(over_object.as_bytes(), limits).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );
    let over_string = format!("\"{}\"", "x".repeat(4_097));
    assert_eq!(
        error_code(&canonical::parse_json(over_string.as_bytes(), limits).unwrap_err()),
        ErrorCode::LimitViolation.as_str()
    );
}

#[test]
fn request_shape_schema_operation_and_authority_fields_are_closed() {
    let root = fixture();
    let base: Value = serde_json::from_str(text(&root["request"], "serialized")).unwrap();

    let mut unknown = base.clone();
    unknown["database_path"] = Value::String("C:/private.sqlite".to_owned());
    let unknown_bytes = canonical::canonical_serialize(&unknown).unwrap();
    assert_eq!(
        error_code(&Request::from_canonical_json(&unknown_bytes).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let mut unsupported_schema = base.clone();
    unsupported_schema["schema"] = Value::String("toolkit.github-program.broker-ipc.v2".to_owned());
    let unsupported_schema_bytes = canonical::canonical_serialize(&unsupported_schema).unwrap();
    assert_eq!(
        error_code(&Request::from_canonical_json(&unsupported_schema_bytes).unwrap_err()),
        ErrorCode::UnsupportedSchema.as_str()
    );

    let mut unsupported_operation = base.clone();
    unsupported_operation["operation"]["kind"] = Value::String("SQL_RPC".to_owned());
    let unsupported_operation_bytes =
        canonical::canonical_serialize(&unsupported_operation).unwrap();
    assert_eq!(
        error_code(&Request::from_canonical_json(&unsupported_operation_bytes).unwrap_err()),
        ErrorCode::UnsupportedOperation.as_str()
    );

    let mut invalid_id = base.clone();
    invalid_id["request_id"] = Value::String("ABC".to_owned());
    let invalid_id_bytes = canonical::canonical_serialize(&invalid_id).unwrap();
    assert_eq!(
        error_code(&Request::from_canonical_json(&invalid_id_bytes).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );

    let mut noncanonical = text(&root["request"], "serialized").as_bytes().to_vec();
    noncanonical.insert(0, b' ');
    assert_eq!(
        error_code(&Request::from_canonical_json(&noncanonical).unwrap_err()),
        ErrorCode::MalformedRequest.as_str()
    );
    assert_eq!(
        RequestId::parse("0123456789abcdef0123456789abcdef")
            .unwrap()
            .as_str()
            .len(),
        32
    );
    assert!(RequestId::parse("0123456789abcdef0123456789ABCDEf").is_err());
}

#[test]
fn all_locked_operation_kinds_have_typed_exact_key_definitions() {
    let root = fixture();
    let mut base: Value = serde_json::from_str(text(&root["request"], "serialized")).unwrap();
    let digest = "a".repeat(64);
    let target_identity = serde_json::json!({
        "resource_type": "git_ref",
        "resource_id": "refs/heads/main"
    });
    let target_digest = canonical::canonical_digest(&target_identity).unwrap();
    let logical_operation_digest = canonical::canonical_digest(&serde_json::json!({
        "operation_kind": "GIT_REF_UPDATE",
        "safety_class": "CAS",
        "target_identity": target_identity,
        "target_digest": target_digest,
        "expected_post_state_digest": "d".repeat(64),
        "adapter_identity_digest": "e".repeat(64)
    }))
    .unwrap();
    let mut outcome_evidence = serde_json::json!({
        "operation_id": "operation-test",
        "logical_operation_digest": logical_operation_digest,
        "adapter_identity_digest": "e".repeat(64),
        "target_identity": target_identity,
        "target_digest": target_digest,
        "provider_operation_key": "gpr:operation-test",
        "cas_digest": "c".repeat(64),
        "classification": "APPLIED",
        "observed_post_state_digest": "d".repeat(64),
        "rejection_digest": null,
        "delayed_completion_excluded": false,
        "evidence_at": "2026-09-04T12:00:00.000Z",
        "evidence_digest": digest.clone()
    });
    let mut outcome_payload = outcome_evidence.clone();
    outcome_payload
        .as_object_mut()
        .unwrap()
        .remove("evidence_digest");
    outcome_evidence["evidence_digest"] = Value::String(
        canonical::canonical_digest(&outcome_payload)
            .unwrap()
            .as_str()
            .to_owned(),
    );
    let authority = serde_json::json!({
        "child_comment_id": 359,
        "parent_comment_id": 240,
        "node_id": "node-id",
        "author_login": "owner",
        "author_association": "OWNER",
        "body_digest": "1".repeat(64),
        "updated_at": "2026-09-04T12:00:00.000Z",
        "update_identity_digest": "2".repeat(64),
        "scope_digest": "3".repeat(64)
    });
    let start = serde_json::json!({
        "base_sha": "0".repeat(40),
        "head_sha": "1".repeat(40),
        "tree_sha": "2".repeat(40),
        "status_digest": "4".repeat(64),
        "clean_worktree": true,
        "ref": {"detached": false, "name": "refs/heads/main"}
    });
    let operations = vec![
        serde_json::json!({"kind": "READBACK_INSPECTION", "target": "NAMESPACE"}),
        serde_json::json!({
            "kind": "ALLOCATE_RUN",
            "authority": authority,
            "start": start,
            "candidate": null,
            "lease_ms": 1000
        }),
        serde_json::json!({"kind": "START_RUN", "allocation_id": "allocation-test"}),
        serde_json::json!({
            "kind": "APPEND_RECEIPT",
            "receipt": {
                "receipt_type": "TRANSITION_PREVIEW",
                "candidate": null,
                "payload": {"classification": "TRANSITION_PREVIEW"},
                "created_at": "2026-09-04T12:00:00.000Z"
            }
        }),
        serde_json::json!({"kind": "INTERRUPT_RUN", "reason": "REQUESTED"}),
        serde_json::json!({
            "kind": "MUTATION_ADMIT",
            "descriptor": {
                "operation_kind": "GIT_REF_UPDATE",
                "safety_class": "CAS",
                "target_identity": target_identity,
                "target_digest": target_digest,
                "expected_source_digest": "b".repeat(64),
                "cas_digest": "c".repeat(64),
                "expected_post_state_digest": "d".repeat(64),
                "adapter_identity_digest": "e".repeat(64),
                "retry_of_operation_id": null
            }
        }),
        serde_json::json!({"kind": "MUTATION_DISPATCH", "operation_id": "operation-test"}),
        serde_json::json!({"kind": "MUTATION_OUTCOME", "operation_id": "operation-test", "evidence": outcome_evidence}),
        serde_json::json!({"kind": "MUTATION_RECONCILE", "operation_id": "operation-test"}),
        serde_json::json!({"kind": "ORPHAN_RECOVERY", "old_run_digest": digest.clone(), "evidence_digest": digest.clone()}),
        serde_json::json!({"kind": "MIGRATE_V2_TO_V3", "source_schema_fingerprint": digest}),
    ];
    assert_eq!(operations.len(), 11);
    for operation in operations {
        base["operation"] = operation;
        let bytes = canonical::canonical_serialize(&base).unwrap();
        Request::from_canonical_json(&bytes).expect("typed operation must validate");
    }
}

#[test]
fn response_wire_contract_exposes_only_stable_error_codes() {
    let request_id = RequestId::parse("0123456789abcdef0123456789abcdef").unwrap();
    let response = Response::failure(
        Some(request_id),
        &BrokerError::new(ErrorCode::UnsupportedPlatform),
    );
    let frame = encode_response_frame(&response).unwrap();
    let decoded = decode_response_frame(&frame).unwrap();
    assert_eq!(decoded, response);
    assert_eq!(
        decoded.error.unwrap().code,
        ErrorCode::UnsupportedPlatform.as_str()
    );
    assert!(
        !String::from_utf8(frame[4..].to_vec())
            .unwrap()
            .contains("stack")
    );
}

#[test]
fn response_readback_is_typed_and_digest_bound() {
    let namespace = Namespace {
        repository: "weijunswj/ai-agent-toolkit".to_owned(),
        parent_issue: 240,
        child_issue: 359,
    };
    let namespace_digest = canonical::canonical_digest(&serde_json::json!({
        "schema": "toolkit.github-program.run-receipt.v1",
        "repository": namespace.repository,
        "parent_issue": namespace.parent_issue,
        "child_issue": namespace.child_issue
    }))
    .unwrap();
    let response = Response::success_with_readback(
        RequestId::parse("0123456789abcdef0123456789abcdef").unwrap(),
        Readback::Namespace {
            namespace,
            namespace_digest,
        },
    )
    .unwrap();
    let frame = encode_response_frame(&response).unwrap();
    assert_eq!(decode_response_frame(&frame).unwrap(), response);

    let mut tampered = serde_json::to_value(response).unwrap();
    tampered["result"]["readback"]["namespace_digest"] = Value::String("0".repeat(64));
    let tampered_frame = encode_frame(&canonical::canonical_serialize(&tampered).unwrap()).unwrap();
    assert_eq!(
        error_code(&decode_response_frame(&tampered_frame).unwrap_err()),
        ErrorCode::InvalidField.as_str()
    );
}
