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
    MAX_FRAME_PAYLOAD_BYTES, MAX_NESTING_DEPTH, Namespace, OperationKind, Readback, Request,
    RequestId, Response, SuccessValue, TargetIdentity, decode_frame, decode_request_frame,
    decode_response_frame, encode_frame, encode_request_frame, encode_response_frame,
    namespace_digest,
};
use serde_json::Value;

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
        SuccessValue::ReadbackInspection { readback },
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

    let failure = Response::failure(
        Some(request_id),
        &BrokerError::new(ErrorCode::UnsupportedPlatform),
    );
    let decoded_failure = decode_response_frame(&encode_response_frame(&failure).unwrap()).unwrap();
    assert_eq!(decoded_failure, failure);
    assert_eq!(
        decoded_failure.error.unwrap().code,
        ErrorCode::UnsupportedPlatform.as_str()
    );
    let parse_failure = Response::failure(None, &BrokerError::new(ErrorCode::MalformedRequest));
    assert_eq!(
        decode_response_frame(&encode_response_frame(&parse_failure).unwrap()).unwrap(),
        parse_failure
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
