use serde::Serialize;
use serde_json::{Map, Value};

use crate::canonical::{self, Digest, MAX_SAFE_INTEGER, ParseLimits};
use crate::error::{BrokerError, ErrorCode, Result};

pub const PROTOCOL_ID: &str = "toolkit.github-program.broker-ipc.v1";
pub const LOCK_ID: &str = "DL-S2-GITHUB-PROGRAM-CONVERGENCE-005";
pub const REPOSITORY: &str = "weijunswj/ai-agent-toolkit";
pub const PARENT_ISSUE: u64 = 240;
pub const CHILD_ISSUE: u64 = 359;

pub const MAX_FRAME_PAYLOAD_BYTES: usize = 65_536;
pub const MAX_NESTING_DEPTH: usize = 16;
pub const MAX_OBJECT_KEYS: usize = 64;
pub const MAX_ARRAY_ITEMS: usize = 256;
pub const MAX_STRING_BYTES: usize = 4_096;
pub const REQUEST_ID_BYTES: usize = 16;
pub const REQUEST_ID_HEX_LENGTH: usize = REQUEST_ID_BYTES * 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RequestId(String);

impl RequestId {
    pub fn parse(value: &str) -> Result<Self> {
        if value.len() == REQUEST_ID_HEX_LENGTH
            && value
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            Ok(Self(value.to_owned()))
        } else {
            Err(BrokerError::new(ErrorCode::InvalidField))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Namespace {
    pub repository: String,
    pub parent_issue: u64,
    pub child_issue: u64,
}

impl Namespace {
    pub fn lock005() -> Self {
        Self {
            repository: REPOSITORY.to_owned(),
            parent_issue: PARENT_ISSUE,
            child_issue: CHILD_ISSUE,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.repository != REPOSITORY
            || self.parent_issue != PARENT_ISSUE
            || self.child_issue != CHILD_ISSUE
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedState {
    pub state_digest: Option<Digest>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum Operation {
    #[serde(rename = "READBACK_INSPECTION")]
    ReadbackInspection { target: ReadbackTarget },
    #[serde(rename = "ALLOCATE_RUN")]
    AllocateRun { lease_ms: u64 },
    #[serde(rename = "START_RUN")]
    StartRun { allocation_id: String },
    #[serde(rename = "APPEND_RECEIPT")]
    AppendReceipt { receipt: ReceiptInput },
    #[serde(rename = "INTERRUPT_RUN")]
    InterruptRun { reason: InterruptReason },
    #[serde(rename = "MUTATION_ADMIT")]
    MutationAdmit { descriptor: MutationDescriptor },
    #[serde(rename = "MUTATION_DISPATCH")]
    MutationDispatch { operation_id: String },
    #[serde(rename = "MUTATION_OUTCOME")]
    MutationOutcome {
        operation_id: String,
        outcome: MutationState,
    },
    #[serde(rename = "MUTATION_RECONCILE")]
    MutationReconcile { operation_id: String },
    #[serde(rename = "ORPHAN_RECOVERY")]
    OrphanRecovery {
        old_run_digest: Digest,
        evidence_digest: Digest,
    },
    #[serde(rename = "MIGRATE_V2_TO_V3")]
    MigrateV2ToV3 { source_schema_fingerprint: Digest },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReadbackTarget {
    Namespace,
    Run,
    ReceiptChain,
    Mutation,
    Recovery,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReceiptType {
    RunStarted,
    TransitionPreview,
    ExecutorTerminal,
    G4Terminal,
    RunInterrupted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptInput {
    pub receipt_type: ReceiptType,
    pub receipt_digest: Digest,
    pub prior_receipt_id: Option<Digest>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InterruptReason {
    Requested,
    BrokerRecovery,
    Shutdown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MutationDescriptor {
    pub operation_kind: MutationOperationKind,
    pub safety_class: SafetyClass,
    pub target_digest: Digest,
    pub expected_source_digest: Digest,
    pub cas_digest: Digest,
    pub expected_post_state_digest: Option<Digest>,
    pub adapter_identity_digest: Digest,
    pub retry_of_operation_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MutationOperationKind {
    GitRefUpdate,
    ConditionalProviderUpdate,
    IdempotentSet,
    AppendCreate,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SafetyClass {
    Cas,
    Idempotent,
    AppendIdempotent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MutationState {
    Prepared,
    InFlight,
    Applied,
    NotApplied,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema: String,
    pub request_id: RequestId,
    pub operation: Operation,
    pub namespace: Namespace,
    pub lock: String,
    pub expected: ExpectedState,
}

impl Request {
    pub fn validate(&self) -> Result<()> {
        if self.schema != PROTOCOL_ID || self.lock != LOCK_ID {
            return Err(BrokerError::new(if self.schema != PROTOCOL_ID {
                ErrorCode::UnsupportedSchema
            } else {
                ErrorCode::InvalidField
            }));
        }
        self.namespace.validate()?;
        validate_operation(&self.operation)
    }

    pub fn digest(&self) -> Result<Digest> {
        self.validate()?;
        canonical::canonical_digest_value(self)
    }

    pub fn from_value(value: Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        require_exact_keys(
            object,
            &[
                "expected",
                "lock",
                "namespace",
                "operation",
                "request_id",
                "schema",
            ],
        )?;

        let schema = required_string(object, "schema")?;
        if schema != PROTOCOL_ID {
            return Err(BrokerError::new(ErrorCode::UnsupportedSchema));
        }
        let request_id = RequestId::parse(required_string(object, "request_id")?.as_str())?;
        let operation = Operation::from_value(required_value(object, "operation")?)?;
        let namespace = Namespace::from_value(required_value(object, "namespace")?)?;
        let lock = required_string(object, "lock")?;
        let expected = ExpectedState::from_value(required_value(object, "expected")?)?;
        let request = Self {
            schema,
            request_id,
            operation,
            namespace,
            lock,
            expected,
        };
        request.validate()?;
        Ok(request)
    }

    pub fn from_canonical_json(bytes: &[u8]) -> Result<Self> {
        let value = canonical::parse_json(bytes, ParseLimits::PROTOCOL)?;
        let canonical = canonical::canonical_serialize(&value)?;
        if canonical != bytes {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        Self::from_value(value)
    }
}

impl Namespace {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(object, &["child_issue", "parent_issue", "repository"])?;
        let namespace = Self {
            repository: required_string(object, "repository")?,
            parent_issue: required_u64(object, "parent_issue")?,
            child_issue: required_u64(object, "child_issue")?,
        };
        namespace.validate()?;
        Ok(namespace)
    }
}

impl ExpectedState {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(object, &["state_digest"])?;
        let state_digest = match required_value(object, "state_digest")? {
            Value::Null => None,
            Value::String(value) => Some(Digest::parse(value)?),
            _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
        };
        Ok(Self { state_digest })
    }
}

impl Operation {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        let kind = required_string(object, "kind")?;
        match kind.as_str() {
            "READBACK_INSPECTION" => {
                require_exact_keys(object, &["kind", "target"])?;
                Ok(Self::ReadbackInspection {
                    target: parse_readback_target(required_string(object, "target")?.as_str())?,
                })
            }
            "ALLOCATE_RUN" => {
                require_exact_keys(object, &["kind", "lease_ms"])?;
                Ok(Self::AllocateRun {
                    lease_ms: required_u64(object, "lease_ms")?,
                })
            }
            "START_RUN" => {
                require_exact_keys(object, &["allocation_id", "kind"])?;
                Ok(Self::StartRun {
                    allocation_id: parse_identifier(required_string(object, "allocation_id")?)?,
                })
            }
            "APPEND_RECEIPT" => {
                require_exact_keys(object, &["kind", "receipt"])?;
                Ok(Self::AppendReceipt {
                    receipt: ReceiptInput::from_value(required_value(object, "receipt")?)?,
                })
            }
            "INTERRUPT_RUN" => {
                require_exact_keys(object, &["kind", "reason"])?;
                Ok(Self::InterruptRun {
                    reason: parse_interrupt_reason(required_string(object, "reason")?.as_str())?,
                })
            }
            "MUTATION_ADMIT" => {
                require_exact_keys(object, &["descriptor", "kind"])?;
                Ok(Self::MutationAdmit {
                    descriptor: MutationDescriptor::from_value(required_value(
                        object,
                        "descriptor",
                    )?)?,
                })
            }
            "MUTATION_DISPATCH" => {
                require_exact_keys(object, &["kind", "operation_id"])?;
                Ok(Self::MutationDispatch {
                    operation_id: parse_identifier(required_string(object, "operation_id")?)?,
                })
            }
            "MUTATION_OUTCOME" => {
                require_exact_keys(object, &["kind", "operation_id", "outcome"])?;
                Ok(Self::MutationOutcome {
                    operation_id: parse_identifier(required_string(object, "operation_id")?)?,
                    outcome: parse_mutation_state(required_string(object, "outcome")?.as_str())?,
                })
            }
            "MUTATION_RECONCILE" => {
                require_exact_keys(object, &["kind", "operation_id"])?;
                Ok(Self::MutationReconcile {
                    operation_id: parse_identifier(required_string(object, "operation_id")?)?,
                })
            }
            "ORPHAN_RECOVERY" => {
                require_exact_keys(object, &["evidence_digest", "kind", "old_run_digest"])?;
                Ok(Self::OrphanRecovery {
                    old_run_digest: required_digest(object, "old_run_digest")?,
                    evidence_digest: required_digest(object, "evidence_digest")?,
                })
            }
            "MIGRATE_V2_TO_V3" => {
                require_exact_keys(object, &["kind", "source_schema_fingerprint"])?;
                Ok(Self::MigrateV2ToV3 {
                    source_schema_fingerprint: required_digest(
                        object,
                        "source_schema_fingerprint",
                    )?,
                })
            }
            _ => Err(BrokerError::new(ErrorCode::UnsupportedOperation)),
        }
    }
}

impl ReceiptInput {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &["prior_receipt_id", "receipt_digest", "receipt_type"],
        )?;
        let prior_receipt_id = match required_value(object, "prior_receipt_id")? {
            Value::Null => None,
            Value::String(value) => Some(Digest::parse(value)?),
            _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
        };
        Ok(Self {
            receipt_type: parse_receipt_type(required_string(object, "receipt_type")?.as_str())?,
            receipt_digest: required_digest(object, "receipt_digest")?,
            prior_receipt_id,
        })
    }
}

impl MutationDescriptor {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &[
                "adapter_identity_digest",
                "cas_digest",
                "expected_post_state_digest",
                "expected_source_digest",
                "operation_kind",
                "retry_of_operation_id",
                "safety_class",
                "target_digest",
            ],
        )?;
        let expected_post_state_digest = optional_digest(object, "expected_post_state_digest")?;
        let retry_of_operation_id = optional_identifier(object, "retry_of_operation_id")?;
        Ok(Self {
            operation_kind: parse_mutation_operation_kind(
                required_string(object, "operation_kind")?.as_str(),
            )?,
            safety_class: parse_safety_class(required_string(object, "safety_class")?.as_str())?,
            target_digest: required_digest(object, "target_digest")?,
            expected_source_digest: required_digest(object, "expected_source_digest")?,
            cas_digest: required_digest(object, "cas_digest")?,
            expected_post_state_digest,
            adapter_identity_digest: required_digest(object, "adapter_identity_digest")?,
            retry_of_operation_id,
        })
    }
}

fn validate_operation(operation: &Operation) -> Result<()> {
    match operation {
        Operation::AllocateRun { lease_ms } => {
            if *lease_ms == 0 || *lease_ms > MAX_SAFE_INTEGER {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        Operation::StartRun { allocation_id }
        | Operation::MutationDispatch {
            operation_id: allocation_id,
        }
        | Operation::MutationReconcile {
            operation_id: allocation_id,
        } => {
            parse_identifier(allocation_id.clone())?;
        }
        Operation::MutationOutcome {
            operation_id,
            outcome,
        } => {
            parse_identifier(operation_id.clone())?;
            if matches!(outcome, MutationState::Prepared | MutationState::InFlight) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        Operation::MutationAdmit { descriptor } => {
            if let Some(operation_id) = &descriptor.retry_of_operation_id {
                parse_identifier(operation_id.clone())?;
            }
        }
        Operation::ReadbackInspection { .. }
        | Operation::AppendReceipt { .. }
        | Operation::InterruptRun { .. }
        | Operation::OrphanRecovery { .. }
        | Operation::MigrateV2ToV3 { .. } => {}
    }
    Ok(())
}

fn require_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> Result<()> {
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn required_value<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a Value> {
    object
        .get(key)
        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))
}

fn required_string(object: &Map<String, Value>, key: &str) -> Result<String> {
    match required_value(object, key)? {
        Value::String(value) => Ok(value.clone()),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn required_u64(object: &Map<String, Value>, key: &str) -> Result<u64> {
    match required_value(object, key)? {
        Value::Number(value) => value
            .as_u64()
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField)),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn required_digest(object: &Map<String, Value>, key: &str) -> Result<Digest> {
    Digest::parse(&required_string(object, key)?)
}

fn optional_digest(object: &Map<String, Value>, key: &str) -> Result<Option<Digest>> {
    match required_value(object, key)? {
        Value::Null => Ok(None),
        Value::String(value) => Ok(Some(Digest::parse(value)?)),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn optional_identifier(object: &Map<String, Value>, key: &str) -> Result<Option<String>> {
    match required_value(object, key)? {
        Value::Null => Ok(None),
        Value::String(value) => Ok(Some(parse_identifier(value.clone())?)),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_identifier(value: String) -> Result<String> {
    if value.is_empty()
        || value.len() > 160
        || value.starts_with('-')
        || value.contains("..")
        || value.bytes().any(|byte| matches!(byte, 0..=31 | 127))
        || !value
            .bytes()
            .all(|byte| matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b':' | b'/' | b'-'))
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(value)
}

fn parse_readback_target(value: &str) -> Result<ReadbackTarget> {
    match value {
        "NAMESPACE" => Ok(ReadbackTarget::Namespace),
        "RUN" => Ok(ReadbackTarget::Run),
        "RECEIPT_CHAIN" => Ok(ReadbackTarget::ReceiptChain),
        "MUTATION" => Ok(ReadbackTarget::Mutation),
        "RECOVERY" => Ok(ReadbackTarget::Recovery),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_receipt_type(value: &str) -> Result<ReceiptType> {
    match value {
        "RUN_STARTED" => Ok(ReceiptType::RunStarted),
        "TRANSITION_PREVIEW" => Ok(ReceiptType::TransitionPreview),
        "EXECUTOR_TERMINAL" => Ok(ReceiptType::ExecutorTerminal),
        "G4_TERMINAL" => Ok(ReceiptType::G4Terminal),
        "RUN_INTERRUPTED" => Ok(ReceiptType::RunInterrupted),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_interrupt_reason(value: &str) -> Result<InterruptReason> {
    match value {
        "REQUESTED" => Ok(InterruptReason::Requested),
        "BROKER_RECOVERY" => Ok(InterruptReason::BrokerRecovery),
        "SHUTDOWN" => Ok(InterruptReason::Shutdown),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_mutation_operation_kind(value: &str) -> Result<MutationOperationKind> {
    match value {
        "GIT_REF_UPDATE" => Ok(MutationOperationKind::GitRefUpdate),
        "CONDITIONAL_PROVIDER_UPDATE" => Ok(MutationOperationKind::ConditionalProviderUpdate),
        "IDEMPOTENT_SET" => Ok(MutationOperationKind::IdempotentSet),
        "APPEND_CREATE" => Ok(MutationOperationKind::AppendCreate),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_safety_class(value: &str) -> Result<SafetyClass> {
    match value {
        "CAS" => Ok(SafetyClass::Cas),
        "IDEMPOTENT" => Ok(SafetyClass::Idempotent),
        "APPEND_IDEMPOTENT" => Ok(SafetyClass::AppendIdempotent),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_mutation_state(value: &str) -> Result<MutationState> {
    match value {
        "PREPARED" => Ok(MutationState::Prepared),
        "IN_FLIGHT" => Ok(MutationState::InFlight),
        "APPLIED" => Ok(MutationState::Applied),
        "NOT_APPLIED" => Ok(MutationState::NotApplied),
        "UNKNOWN" => Ok(MutationState::Unknown),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn request_limits() -> ParseLimits {
    ParseLimits {
        max_depth: MAX_NESTING_DEPTH,
        max_object_keys: MAX_OBJECT_KEYS,
        max_array_items: MAX_ARRAY_ITEMS,
        max_string_bytes: MAX_STRING_BYTES,
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub schema: String,
    pub request_id: Option<RequestId>,
    pub ok: bool,
    pub result: Option<ResponseResult>,
    pub error: Option<WireError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseResult {
    pub result_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    pub code: String,
}

impl Response {
    pub fn success(request_id: RequestId, result_digest: Digest) -> Self {
        Self {
            schema: PROTOCOL_ID.to_owned(),
            request_id: Some(request_id),
            ok: true,
            result: Some(ResponseResult { result_digest }),
            error: None,
        }
    }

    pub fn failure(request_id: Option<RequestId>, error: &BrokerError) -> Self {
        Self {
            schema: PROTOCOL_ID.to_owned(),
            request_id,
            ok: false,
            result: None,
            error: Some(WireError {
                code: error.as_str().to_owned(),
            }),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema != PROTOCOL_ID {
            return Err(BrokerError::new(ErrorCode::UnsupportedSchema));
        }
        if self.ok == self.error.is_some() {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if self.ok && self.result.is_none() {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if !self.ok && self.result.is_some() {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(error) = &self.error
            && !ErrorCode::is_known(&error.code)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() > MAX_FRAME_PAYLOAD_BYTES {
        return Err(BrokerError::new(ErrorCode::LimitViolation));
    }
    let length =
        u32::try_from(payload.len()).map_err(|_| BrokerError::new(ErrorCode::LimitViolation))?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn decode_frame(frame: &[u8]) -> Result<&[u8]> {
    if frame.len() < 4 {
        return Err(BrokerError::new(ErrorCode::MalformedFrame));
    }
    let length = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
    if length > MAX_FRAME_PAYLOAD_BYTES {
        return Err(BrokerError::new(ErrorCode::LimitViolation));
    }
    let expected_length = 4_usize
        .checked_add(length)
        .ok_or_else(|| BrokerError::new(ErrorCode::MalformedFrame))?;
    if frame.len() < expected_length || frame.len() > expected_length {
        return Err(BrokerError::new(ErrorCode::MalformedFrame));
    }
    Ok(&frame[4..expected_length])
}

pub fn encode_request_frame(request: &Request) -> Result<Vec<u8>> {
    request.validate()?;
    let payload = canonical::canonical_serialize_value(request)?;
    encode_frame(&payload)
}

pub fn decode_request_frame(frame: &[u8]) -> Result<Request> {
    let payload = decode_frame(frame)?;
    if core::str::from_utf8(payload).is_err() {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    let value = canonical::parse_json(payload, request_limits())?;
    let canonical = canonical::canonical_serialize(&value)?;
    if canonical != payload {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    Request::from_value(value)
}

pub fn encode_response_frame(response: &Response) -> Result<Vec<u8>> {
    response.validate()?;
    encode_frame(&canonical::canonical_serialize_value(response)?)
}

pub fn decode_response_frame(frame: &[u8]) -> Result<Response> {
    let payload = decode_frame(frame)?;
    if core::str::from_utf8(payload).is_err() {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    let value = canonical::parse_json(payload, request_limits())?;
    let canonical = canonical::canonical_serialize(&value)?;
    if canonical != payload {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    response_from_value(value)
}

fn response_from_value(value: Value) -> Result<Response> {
    let object = value
        .as_object()
        .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
    require_exact_keys(object, &["error", "ok", "request_id", "result", "schema"])?;
    let schema = required_string(object, "schema")?;
    if schema != PROTOCOL_ID {
        return Err(BrokerError::new(ErrorCode::UnsupportedSchema));
    }
    let request_id = match required_value(object, "request_id")? {
        Value::Null => None,
        Value::String(value) => Some(RequestId::parse(value)?),
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    let ok = match required_value(object, "ok")? {
        Value::Bool(value) => *value,
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    let result = match required_value(object, "result")? {
        Value::Null => None,
        Value::Object(value) => {
            require_exact_keys(value, &["result_digest"])?;
            Some(ResponseResult {
                result_digest: required_digest(value, "result_digest")?,
            })
        }
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    let error = match required_value(object, "error")? {
        Value::Null => None,
        Value::Object(value) => {
            require_exact_keys(value, &["code"])?;
            let code = required_string(value, "code")?;
            if !ErrorCode::is_known(&code) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            Some(WireError { code })
        }
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    let response = Response {
        schema,
        request_id,
        ok,
        result,
        error,
    };
    response.validate()?;
    Ok(response)
}
