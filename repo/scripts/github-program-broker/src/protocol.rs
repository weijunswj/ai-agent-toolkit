use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::canonical::{self, Digest, MAX_SAFE_INTEGER, ParseLimits};
use crate::error::{BrokerError, ErrorCode, Result};

pub const PROTOCOL_ID: &str = "toolkit.github-program.broker-ipc.v1";
pub const RECEIPT_SCHEMA_ID: &str = "toolkit.github-program.run-receipt.v1";

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

impl<'de> Deserialize<'de> for RequestId {
    fn deserialize<D>(deserializer: D) -> core::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(|_| D::Error::custom("invalid request id"))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Namespace {
    pub repository: String,
    pub parent_issue: u64,
    pub child_issue: u64,
}

impl Namespace {
    pub fn validate(&self) -> Result<()> {
        validate_repository(&self.repository)?;
        validate_issue(self.parent_issue)?;
        validate_issue(self.child_issue)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedState {
    pub state_digest: Option<Digest>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorAssociation {
    Owner,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoritySnapshot {
    pub child_comment_id: u64,
    pub parent_comment_id: u64,
    pub node_id: String,
    pub author_login: String,
    pub author_association: AuthorAssociation,
    pub body_digest: Digest,
    pub updated_at: String,
    pub update_identity_digest: Digest,
    pub scope_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefSnapshot {
    pub detached: bool,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartSnapshot {
    pub base_sha: String,
    pub head_sha: String,
    pub tree_sha: String,
    pub status_digest: Digest,
    pub clean_worktree: bool,
    #[serde(rename = "ref")]
    pub ref_snapshot: RefSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub pr_number: u64,
    pub branch: String,
    pub base_ref: String,
    pub base_sha: String,
    pub head_sha: String,
    pub tree_sha: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lease {
    pub lease_id: String,
    pub fence_id: String,
    pub fence_sequence: u64,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    pub id: String,
    pub digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptPayload {
    pub classification: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome_digest: Option<Digest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_digest: Option<Digest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_digest: Option<Digest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_digest: Option<Digest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_outcome: Option<PayloadMutationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_refs: Option<Vec<EvidenceRef>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayloadMutationOutcome {
    Known,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptInput {
    pub receipt_type: ReceiptType,
    pub candidate: Option<Candidate>,
    pub payload: ReceiptPayload,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetIdentity {
    pub resource_type: String,
    pub resource_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeEvidence {
    pub operation_id: String,
    pub logical_operation_digest: Digest,
    pub adapter_identity_digest: Digest,
    pub target_identity: TargetIdentity,
    pub target_digest: Digest,
    pub provider_operation_key: String,
    pub cas_digest: Digest,
    pub classification: MutationState,
    pub observed_post_state_digest: Option<Digest>,
    pub rejection_digest: Option<Digest>,
    pub delayed_completion_excluded: bool,
    pub evidence_at: String,
    pub evidence_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunAllocation {
    pub allocation_id: String,
    pub run_id: String,
    pub lock: String,
    pub lease: Lease,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptRecord {
    pub schema: String,
    pub receipt_type: ReceiptType,
    pub receipt_id: Digest,
    pub sequence: u64,
    pub prior_receipt_id: Option<Digest>,
    pub run_id: String,
    pub allocation_id: String,
    pub repository: String,
    pub parent_issue: u64,
    pub child_issue: u64,
    pub lock: String,
    pub authority: AuthoritySnapshot,
    pub start: StartSnapshot,
    pub candidate: Option<Candidate>,
    pub lease: Lease,
    pub payload: ReceiptPayload,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationOperation {
    pub operation_id: String,
    pub logical_operation_digest: Digest,
    pub run_id: String,
    pub allocation_id: String,
    pub lock: String,
    pub authority_digest: Digest,
    pub lease_id: String,
    pub fence_id: String,
    pub fence_sequence: u64,
    pub operation_kind: MutationOperationKind,
    pub safety_class: SafetyClass,
    pub target_identity: TargetIdentity,
    pub target_digest: Digest,
    pub expected_source_digest: Digest,
    pub cas_digest: Digest,
    pub expected_post_state_digest: Option<Digest>,
    pub provider_operation_key: String,
    pub adapter_identity_digest: Digest,
    pub retry_of_operation_id: Option<String>,
    pub created_at: String,
    pub operation_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationEvent {
    pub event_id: String,
    pub operation_id: String,
    pub sequence: u64,
    pub prior_event_id: Option<String>,
    pub event_type: String,
    pub state: MutationState,
    pub event_at: String,
    pub authority_digest: Digest,
    pub provider_evidence_digest: Digest,
    pub readback_digest: Option<Digest>,
    pub detail_digest: Digest,
    pub event_digest: Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryStatus {
    RunNotFound,
    Terminal,
    UnstartedAllocationExpired,
    UnstartedAllocationActive,
    StartedLeaseExpired,
    LiveRunNotAdoptable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Readback {
    #[serde(rename = "NAMESPACE")]
    Namespace {
        namespace: Namespace,
        namespace_digest: Digest,
    },
    #[serde(rename = "RUN")]
    Run {
        allocation: RunAllocation,
        started: bool,
        run_started_receipt_id: Option<Digest>,
    },
    #[serde(rename = "RECEIPT_CHAIN")]
    ReceiptChain {
        run_id: String,
        receipts: Vec<ReceiptRecord>,
        chain_digest: Digest,
    },
    #[serde(rename = "MUTATION")]
    Mutation {
        operation: Box<MutationOperation>,
        state: MutationState,
        events: Vec<MutationEvent>,
    },
    #[serde(rename = "RECOVERY")]
    Recovery {
        run_id: String,
        status: RecoveryStatus,
        receipt_id: Option<Digest>,
    },
}

impl Readback {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Namespace {
                namespace,
                namespace_digest: expected_digest,
            } => {
                namespace.validate()?;
                if namespace_digest(namespace)? != *expected_digest {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            Self::Run {
                allocation,
                started,
                run_started_receipt_id,
            } => {
                allocation.validate()?;
                if *started != run_started_receipt_id.is_some() {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                if let Some(receipt_id) = run_started_receipt_id
                    && !is_digest(receipt_id)
                {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            Self::ReceiptChain {
                run_id,
                receipts,
                chain_digest,
            } => {
                validate_identifier(run_id)?;
                if receipts.is_empty() || receipts.len() > 128 {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                for (index, receipt) in receipts.iter().enumerate() {
                    receipt.validate()?;
                    if receipt.run_id != *run_id || receipt.sequence != (index + 1) as u64 {
                        return Err(BrokerError::new(ErrorCode::InvalidField));
                    }
                    if index == 0 {
                        if receipt.prior_receipt_id.is_some()
                            || receipt.receipt_type != ReceiptType::RunStarted
                        {
                            return Err(BrokerError::new(ErrorCode::InvalidField));
                        }
                    } else if receipt.prior_receipt_id.as_ref()
                        != Some(&receipts[index - 1].receipt_id)
                    {
                        return Err(BrokerError::new(ErrorCode::InvalidField));
                    }
                    if index > 0 {
                        let prior = &receipts[index - 1];
                        if receipt.created_at < prior.created_at
                            || !same_receipt_binding(receipt, prior)
                        {
                            return Err(BrokerError::new(ErrorCode::InvalidField));
                        }
                        if prior.receipt_type == ReceiptType::ExecutorTerminal
                            || prior.receipt_type == ReceiptType::G4Terminal
                            || prior.receipt_type == ReceiptType::RunInterrupted
                        {
                            return Err(BrokerError::new(ErrorCode::InvalidField));
                        }
                        match (&prior.candidate, &receipt.candidate) {
                            (None, Some(_))
                                if receipt.receipt_type != ReceiptType::TransitionPreview =>
                            {
                                return Err(BrokerError::new(ErrorCode::InvalidField));
                            }
                            (Some(previous), Some(current)) if previous != current => {
                                return Err(BrokerError::new(ErrorCode::InvalidField));
                            }
                            (Some(_), None) => {
                                return Err(BrokerError::new(ErrorCode::InvalidField));
                            }
                            _ => {}
                        }
                    }
                }
                let expected = canonical::canonical_digest_value(receipts)?;
                if expected != *chain_digest {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            Self::Mutation {
                operation,
                state,
                events,
            } => {
                operation.validate()?;
                if events.is_empty() {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                for (index, event) in events.iter().enumerate() {
                    event.validate(operation)?;
                    if event.sequence != (index + 1) as u64 {
                        return Err(BrokerError::new(ErrorCode::InvalidField));
                    }
                    if index == 0 {
                        if event.event_type != "PREPARED"
                            || event.state != MutationState::Prepared
                            || event.prior_event_id.is_some()
                        {
                            return Err(BrokerError::new(ErrorCode::InvalidField));
                        }
                    } else if index == 1 {
                        if event.event_type != "IN_FLIGHT"
                            || event.state != MutationState::InFlight
                            || event.prior_event_id.as_ref() != Some(&events[index - 1].event_id)
                        {
                            return Err(BrokerError::new(ErrorCode::InvalidField));
                        }
                    } else if event.prior_event_id.as_ref() != Some(&events[index - 1].event_id)
                        || !valid_mutation_transition(
                            events[index - 1].state.clone(),
                            event.state.clone(),
                        )
                    {
                        return Err(BrokerError::new(ErrorCode::InvalidField));
                    }
                }
                if events.last().is_none_or(|event| event.state != *state) {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            Self::Recovery {
                run_id,
                status,
                receipt_id,
            } => {
                validate_identifier(run_id)?;
                if matches!(status, RecoveryStatus::Terminal) != receipt_id.is_some() {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                if let Some(receipt_id) = receipt_id
                    && !is_digest(receipt_id)
                {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Operation {
    #[serde(rename = "READBACK_INSPECTION")]
    ReadbackInspection { target: ReadbackTarget },
    #[serde(rename = "ALLOCATE_RUN")]
    AllocateRun {
        authority: AuthoritySnapshot,
        start: StartSnapshot,
        candidate: Option<Candidate>,
        lease_ms: u64,
    },
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
        evidence: OutcomeEvidence,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReadbackTarget {
    Namespace,
    Run,
    ReceiptChain,
    Mutation,
    Recovery,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReceiptType {
    RunStarted,
    TransitionPreview,
    ExecutorTerminal,
    G4Terminal,
    RunInterrupted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InterruptReason {
    Requested,
    BrokerRecovery,
    Shutdown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationDescriptor {
    pub operation_kind: MutationOperationKind,
    pub safety_class: SafetyClass,
    pub target_identity: TargetIdentity,
    pub target_digest: Digest,
    pub expected_source_digest: Digest,
    pub cas_digest: Digest,
    pub expected_post_state_digest: Option<Digest>,
    pub adapter_identity_digest: Digest,
    pub retry_of_operation_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MutationOperationKind {
    GitRefUpdate,
    ConditionalProviderUpdate,
    IdempotentSet,
    AppendCreate,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SafetyClass {
    Cas,
    Idempotent,
    AppendIdempotent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
        if self.schema != PROTOCOL_ID {
            return Err(BrokerError::new(if self.schema != PROTOCOL_ID {
                ErrorCode::UnsupportedSchema
            } else {
                ErrorCode::InvalidField
            }));
        }
        parse_identifier(self.lock.clone())?;
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
        Self::from_value(value.to_serde()?)
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
                require_exact_keys(
                    object,
                    &["authority", "candidate", "kind", "lease_ms", "start"],
                )?;
                Ok(Self::AllocateRun {
                    authority: AuthoritySnapshot::from_value(required_value(object, "authority")?)?,
                    start: StartSnapshot::from_value(required_value(object, "start")?)?,
                    candidate: optional_candidate(object, "candidate")?,
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
                require_exact_keys(object, &["evidence", "kind", "operation_id"])?;
                let evidence = OutcomeEvidence::from_value(required_value(object, "evidence")?)?;
                Ok(Self::MutationOutcome {
                    operation_id: parse_identifier(required_string(object, "operation_id")?)?,
                    evidence,
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
            &["candidate", "created_at", "payload", "receipt_type"],
        )?;
        let receipt = Self {
            receipt_type: parse_receipt_type(required_string(object, "receipt_type")?.as_str())?,
            candidate: optional_candidate(object, "candidate")?,
            payload: ReceiptPayload::from_value(required_value(object, "payload")?)?,
            created_at: required_string(object, "created_at")?,
        };
        receipt.validate()?;
        Ok(receipt)
    }

    fn validate(&self) -> Result<()> {
        if self.receipt_type == ReceiptType::RunStarted || !is_timestamp(&self.created_at) {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        self.payload.validate()?;
        if let Some(candidate) = &self.candidate {
            candidate.validate()?;
        }
        Ok(())
    }
}

impl AuthoritySnapshot {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &[
                "author_association",
                "author_login",
                "body_digest",
                "child_comment_id",
                "node_id",
                "parent_comment_id",
                "scope_digest",
                "update_identity_digest",
                "updated_at",
            ],
        )?;
        let authority = Self {
            child_comment_id: required_u64(object, "child_comment_id")?,
            parent_comment_id: required_u64(object, "parent_comment_id")?,
            node_id: required_string(object, "node_id")?,
            author_login: required_string(object, "author_login")?,
            author_association: parse_author_association(
                required_string(object, "author_association")?.as_str(),
            )?,
            body_digest: required_digest(object, "body_digest")?,
            updated_at: required_string(object, "updated_at")?,
            update_identity_digest: required_digest(object, "update_identity_digest")?,
            scope_digest: required_digest(object, "scope_digest")?,
        };
        authority.validate()?;
        Ok(authority)
    }

    fn validate(&self) -> Result<()> {
        validate_issue(self.child_comment_id)?;
        validate_issue(self.parent_comment_id)?;
        parse_identifier(self.node_id.clone())?;
        if self.author_login.is_empty()
            || self.author_login.len() > 39
            || !self
                .author_login
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || self.author_association != AuthorAssociation::Owner
            || !is_timestamp(&self.updated_at)
            || !is_digest(&self.body_digest)
            || !is_digest(&self.update_identity_digest)
            || !is_digest(&self.scope_digest)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

impl RefSnapshot {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(object, &["detached", "name"])?;
        let detached = required_bool(object, "detached")?;
        let name = match required_value(object, "name")? {
            Value::Null => None,
            Value::String(value) => Some(value.clone()),
            _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
        };
        let reference = Self { detached, name };
        reference.validate()?;
        Ok(reference)
    }

    fn validate(&self) -> Result<()> {
        if self.detached {
            if self.name.is_some() {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        } else if !self.name.as_deref().is_some_and(is_safe_git_ref) {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

impl StartSnapshot {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &[
                "base_sha",
                "clean_worktree",
                "head_sha",
                "ref",
                "status_digest",
                "tree_sha",
            ],
        )?;
        let start = Self {
            base_sha: required_string(object, "base_sha")?,
            head_sha: required_string(object, "head_sha")?,
            tree_sha: required_string(object, "tree_sha")?,
            status_digest: required_digest(object, "status_digest")?,
            clean_worktree: required_bool(object, "clean_worktree")?,
            ref_snapshot: RefSnapshot::from_value(required_value(object, "ref")?)?,
        };
        start.validate()?;
        Ok(start)
    }

    fn validate(&self) -> Result<()> {
        for value in [&self.base_sha, &self.head_sha, &self.tree_sha] {
            if !canonical::is_lower_hex(value, 40) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        if !self.clean_worktree || !is_digest(&self.status_digest) {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        self.ref_snapshot.validate()
    }
}

impl Candidate {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &[
                "base_ref",
                "base_sha",
                "branch",
                "head_sha",
                "pr_number",
                "tree_sha",
            ],
        )?;
        let candidate = Self {
            pr_number: required_u64(object, "pr_number")?,
            branch: required_string(object, "branch")?,
            base_ref: required_string(object, "base_ref")?,
            base_sha: required_string(object, "base_sha")?,
            head_sha: required_string(object, "head_sha")?,
            tree_sha: required_string(object, "tree_sha")?,
        };
        candidate.validate()?;
        Ok(candidate)
    }

    fn validate(&self) -> Result<()> {
        validate_issue(self.pr_number)?;
        if !is_safe_git_ref(&self.branch) || !is_safe_git_ref(&self.base_ref) {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        for value in [&self.base_sha, &self.head_sha, &self.tree_sha] {
            if !canonical::is_lower_hex(value, 40) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        Ok(())
    }
}

impl Lease {
    fn validate(&self) -> Result<()> {
        validate_issue(self.fence_sequence)?;
        if !is_timestamp(&self.issued_at)
            || !is_timestamp(&self.expires_at)
            || self.expires_at <= self.issued_at
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

impl RunAllocation {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.allocation_id)?;
        validate_identifier(&self.run_id)?;
        validate_identifier(&self.lock)?;
        self.lease.validate()
    }
}

impl EvidenceRef {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(object, &["digest", "id"])?;
        let reference = Self {
            id: parse_identifier(required_string(object, "id")?)?,
            digest: required_digest(object, "digest")?,
        };
        reference.validate()?;
        Ok(reference)
    }

    fn validate(&self) -> Result<()> {
        validate_identifier(&self.id)?;
        if !is_digest(&self.digest) {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

impl ReceiptPayload {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        let allowed = [
            "classification",
            "detail_digest",
            "evidence_digest",
            "evidence_refs",
            "mutation_outcome",
            "operation_digest",
            "outcome_digest",
            "reason_code",
        ];
        if object.keys().any(|key| !allowed.contains(&key.as_str()))
            || !object.contains_key("classification")
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        let evidence_refs = match object.get("evidence_refs") {
            None => None,
            Some(Value::Array(values)) if values.len() <= 50 => Some(
                values
                    .iter()
                    .map(EvidenceRef::from_value)
                    .collect::<Result<Vec<_>>>()?,
            ),
            _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
        };
        let payload = Self {
            classification: parse_identifier(required_string(object, "classification")?)?,
            reason_code: optional_identifier_field(object, "reason_code")?,
            outcome_digest: optional_digest_field(object, "outcome_digest")?,
            evidence_digest: optional_digest_field(object, "evidence_digest")?,
            operation_digest: optional_digest_field(object, "operation_digest")?,
            detail_digest: optional_digest_field(object, "detail_digest")?,
            mutation_outcome: optional_payload_mutation_outcome(object, "mutation_outcome")?,
            evidence_refs,
        };
        payload.validate()?;
        Ok(payload)
    }

    fn validate(&self) -> Result<()> {
        validate_identifier(&self.classification)?;
        if let Some(value) = &self.reason_code {
            validate_identifier(value)?;
        }
        if let Some(values) = &self.evidence_refs {
            if values.len() > 50 {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            for value in values {
                value.validate()?;
            }
        }
        for value in [
            &self.outcome_digest,
            &self.evidence_digest,
            &self.operation_digest,
            &self.detail_digest,
        ]
        .into_iter()
        .flatten()
        {
            if !is_digest(value) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        if canonical::canonical_serialize_value(self)?.len() > 8_192 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
}

impl TargetIdentity {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(object, &["resource_id", "resource_type"])?;
        let identity = Self {
            resource_type: required_string(object, "resource_type")?,
            resource_id: required_string(object, "resource_id")?,
        };
        identity.validate()?;
        Ok(identity)
    }

    fn validate(&self) -> Result<()> {
        validate_bounded_identifier(&self.resource_type, 80)?;
        validate_bounded_identifier(&self.resource_id, 512)?;
        if canonical::canonical_serialize_value(self)?.len() > 2_048 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
}

impl OutcomeEvidence {
    fn from_value(value: &Value) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
        require_exact_keys(
            object,
            &[
                "adapter_identity_digest",
                "cas_digest",
                "classification",
                "delayed_completion_excluded",
                "evidence_at",
                "evidence_digest",
                "logical_operation_digest",
                "observed_post_state_digest",
                "operation_id",
                "provider_operation_key",
                "rejection_digest",
                "target_digest",
                "target_identity",
            ],
        )?;
        let evidence = Self {
            operation_id: parse_identifier(required_string(object, "operation_id")?)?,
            logical_operation_digest: required_digest(object, "logical_operation_digest")?,
            adapter_identity_digest: required_digest(object, "adapter_identity_digest")?,
            target_identity: TargetIdentity::from_value(required_value(
                object,
                "target_identity",
            )?)?,
            target_digest: required_digest(object, "target_digest")?,
            provider_operation_key: parse_identifier(required_string(
                object,
                "provider_operation_key",
            )?)?,
            cas_digest: required_digest(object, "cas_digest")?,
            classification: parse_mutation_state(
                required_string(object, "classification")?.as_str(),
            )?,
            observed_post_state_digest: optional_digest(object, "observed_post_state_digest")?,
            rejection_digest: optional_digest(object, "rejection_digest")?,
            delayed_completion_excluded: required_bool(object, "delayed_completion_excluded")?,
            evidence_at: required_string(object, "evidence_at")?,
            evidence_digest: required_digest(object, "evidence_digest")?,
        };
        evidence.validate()?;
        Ok(evidence)
    }

    fn validate(&self) -> Result<()> {
        validate_identifier(&self.operation_id)?;
        if !is_digest(&self.logical_operation_digest)
            || !is_digest(&self.adapter_identity_digest)
            || !is_digest(&self.target_digest)
            || !is_digest(&self.cas_digest)
            || !is_digest(&self.evidence_digest)
            || !is_timestamp(&self.evidence_at)
            || !self.delayed_completion_excluded && self.classification == MutationState::NotApplied
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        self.target_identity.validate()?;
        if canonical::canonical_digest_value(&self.target_identity)? != self.target_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        validate_identifier(&self.provider_operation_key)?;
        if let Some(value) = &self.observed_post_state_digest
            && !is_digest(value)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(value) = &self.rejection_digest
            && !is_digest(value)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if matches!(
            self.classification,
            MutationState::Prepared | MutationState::InFlight
        ) || !is_timestamp(&self.evidence_at)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_digest_value(&evidence_value_without_digest(self)?)?
            != self.evidence_digest
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_serialize_value(self)?.len() > 4_096 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        match self.classification {
            MutationState::Applied => {
                if self.observed_post_state_digest.is_none() || self.rejection_digest.is_some() {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            MutationState::NotApplied => {
                if self.observed_post_state_digest.is_some()
                    || self.rejection_digest.is_none()
                    || !self.delayed_completion_excluded
                {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            MutationState::Unknown => {}
            MutationState::Prepared | MutationState::InFlight => unreachable!(),
        }
        Ok(())
    }
}

impl ReceiptRecord {
    fn validate(&self) -> Result<()> {
        if self.schema != RECEIPT_SCHEMA_ID
            || !matches!(
                self.receipt_type,
                ReceiptType::RunStarted
                    | ReceiptType::TransitionPreview
                    | ReceiptType::ExecutorTerminal
                    | ReceiptType::G4Terminal
                    | ReceiptType::RunInterrupted
            )
            || self.sequence == 0
            || self.sequence > 128
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        validate_identifier(&self.run_id)?;
        validate_identifier(&self.allocation_id)?;
        validate_repository(&self.repository)?;
        validate_issue(self.parent_issue)?;
        validate_issue(self.child_issue)?;
        validate_identifier(&self.lock)?;
        self.authority.validate()?;
        self.start.validate()?;
        if let Some(candidate) = &self.candidate {
            candidate.validate()?;
        }
        self.lease.validate()?;
        self.payload.validate()?;
        if !is_timestamp(&self.created_at) || self.created_at < self.lease.issued_at {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if self.sequence == 1
            && (self.receipt_type != ReceiptType::RunStarted
                || self.prior_receipt_id.is_some()
                || self.candidate.is_some())
            || self.sequence > 1
                && (self.receipt_type == ReceiptType::RunStarted || self.prior_receipt_id.is_none())
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_digest_value(&receipt_value_without_id(self)?)? != self.receipt_id {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_serialize_value(self)?.len() > 16_384 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
}

impl MutationOperation {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.operation_id)?;
        validate_identifier(&self.run_id)?;
        validate_identifier(&self.allocation_id)?;
        validate_identifier(&self.lock)?;
        validate_identifier(&self.lease_id)?;
        validate_identifier(&self.fence_id)?;
        validate_identifier(&self.provider_operation_key)?;
        if !is_digest(&self.logical_operation_digest)
            || !is_digest(&self.authority_digest)
            || !is_digest(&self.target_digest)
            || !is_digest(&self.expected_source_digest)
            || !is_digest(&self.cas_digest)
            || !is_digest(&self.adapter_identity_digest)
            || self.provider_operation_key != format!("gpr:{}", self.operation_id)
            || self.fence_sequence == 0
            || !is_timestamp(&self.created_at)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(value) = &self.retry_of_operation_id {
            validate_identifier(value)?;
        }
        let descriptor = MutationDescriptor {
            operation_kind: self.operation_kind.clone(),
            safety_class: self.safety_class.clone(),
            target_identity: self.target_identity.clone(),
            target_digest: self.target_digest.clone(),
            expected_source_digest: self.expected_source_digest.clone(),
            cas_digest: self.cas_digest.clone(),
            expected_post_state_digest: self.expected_post_state_digest.clone(),
            adapter_identity_digest: self.adapter_identity_digest.clone(),
            retry_of_operation_id: self.retry_of_operation_id.clone(),
        };
        descriptor.validate()?;
        let logical_payload = serde_json::json!({
            "operation_kind": self.operation_kind,
            "safety_class": self.safety_class,
            "target_identity": self.target_identity,
            "target_digest": self.target_digest,
            "expected_post_state_digest": self.expected_post_state_digest,
            "adapter_identity_digest": self.adapter_identity_digest,
        });
        if canonical::canonical_digest_value(&logical_payload)? != self.logical_operation_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        let operation_payload = serde_json::json!({
            "operation_id": self.operation_id,
            "logical_operation_digest": self.logical_operation_digest,
            "run_id": self.run_id,
            "allocation_id": self.allocation_id,
            "lock_id": self.lock,
            "authority_digest": self.authority_digest,
            "lease_id": self.lease_id,
            "fence_id": self.fence_id,
            "fence_sequence": self.fence_sequence,
            "operation_kind": self.operation_kind,
            "safety_class": self.safety_class,
            "target_identity_json": canonical::canonical_serialize_value(&self.target_identity)
                .map(|value| String::from_utf8(value).map_err(|_| BrokerError::new(ErrorCode::InternalInvariant)))??,
            "target_digest": self.target_digest,
            "source_digest": self.expected_source_digest,
            "cas_digest": self.cas_digest,
            "expected_post_state_digest": self.expected_post_state_digest,
            "provider_operation_key": self.provider_operation_key,
            "adapter_identity_digest": self.adapter_identity_digest,
            "retry_of_operation_id": self.retry_of_operation_id,
            "created_at": self.created_at,
        });
        if canonical::canonical_digest_value(&operation_payload)? != self.operation_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

impl MutationEvent {
    fn validate(&self, operation: &MutationOperation) -> Result<()> {
        validate_identifier(&self.event_id)?;
        if self.operation_id != operation.operation_id
            || self.sequence == 0
            || !is_timestamp(&self.event_at)
            || self.event_at < operation.created_at
            || !is_digest(&self.authority_digest)
            || !is_digest(&self.provider_evidence_digest)
            || self
                .readback_digest
                .as_ref()
                .is_some_and(|value| !is_digest(value))
            || !is_digest(&self.detail_digest)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(value) = &self.prior_event_id {
            validate_identifier(value)?;
        }
        validate_event_type(&self.event_type)?;
        let event_payload = serde_json::json!({
            "event_id": self.event_id,
            "operation_id": self.operation_id,
            "sequence": self.sequence,
            "prior_event_id": self.prior_event_id,
            "event_type": self.event_type,
            "state": self.state,
            "event_at": self.event_at,
            "authority_digest": self.authority_digest,
            "provider_evidence_digest": self.provider_evidence_digest,
            "readback_digest": self.readback_digest,
            "detail_digest": self.detail_digest,
        });
        if canonical::canonical_digest_value(&event_payload)? != self.event_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
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
                "target_identity",
            ],
        )?;
        let expected_post_state_digest = optional_digest(object, "expected_post_state_digest")?;
        let retry_of_operation_id = optional_identifier(object, "retry_of_operation_id")?;
        Ok(Self {
            operation_kind: parse_mutation_operation_kind(
                required_string(object, "operation_kind")?.as_str(),
            )?,
            safety_class: parse_safety_class(required_string(object, "safety_class")?.as_str())?,
            target_identity: TargetIdentity::from_value(required_value(
                object,
                "target_identity",
            )?)?,
            target_digest: required_digest(object, "target_digest")?,
            expected_source_digest: required_digest(object, "expected_source_digest")?,
            cas_digest: required_digest(object, "cas_digest")?,
            expected_post_state_digest,
            adapter_identity_digest: required_digest(object, "adapter_identity_digest")?,
            retry_of_operation_id,
        })
    }

    fn validate(&self) -> Result<()> {
        self.target_identity.validate()?;
        if !is_digest(&self.target_digest)
            || !is_digest(&self.expected_source_digest)
            || !is_digest(&self.cas_digest)
            || !is_digest(&self.adapter_identity_digest)
            || self
                .expected_post_state_digest
                .as_ref()
                .is_some_and(|value| !is_digest(value))
            || self.retry_of_operation_id.is_some()
                && self
                    .retry_of_operation_id
                    .as_deref()
                    .is_some_and(|value| validate_identifier(value).is_err())
            || canonical::canonical_digest_value(&self.target_identity)? != self.target_digest
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        let expected_class = match self.operation_kind {
            MutationOperationKind::IdempotentSet => SafetyClass::Idempotent,
            MutationOperationKind::AppendCreate => SafetyClass::AppendIdempotent,
            MutationOperationKind::GitRefUpdate
            | MutationOperationKind::ConditionalProviderUpdate => SafetyClass::Cas,
        };
        let expected_resource_type = match self.operation_kind {
            MutationOperationKind::GitRefUpdate => "git_ref",
            MutationOperationKind::AppendCreate => "provider_collection",
            MutationOperationKind::ConditionalProviderUpdate
            | MutationOperationKind::IdempotentSet => "provider_resource",
        };
        if self.safety_class != expected_class
            || self.target_identity.resource_type != expected_resource_type
            || self
                .target_identity
                .resource_id
                .bytes()
                .any(|byte| byte.is_ascii_whitespace() || byte == b',')
            || (self.operation_kind != MutationOperationKind::AppendCreate
                && self.expected_post_state_digest.is_none())
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

fn validate_operation(operation: &Operation) -> Result<()> {
    match operation {
        Operation::AllocateRun {
            authority,
            start,
            candidate,
            lease_ms,
        } => {
            authority.validate()?;
            start.validate()?;
            if candidate.is_some() {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            if *lease_ms < 1_000 || *lease_ms > 86_400_000 {
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
            evidence,
        } => {
            parse_identifier(operation_id.clone())?;
            if evidence.operation_id != *operation_id {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            evidence.validate()?;
        }
        Operation::MutationAdmit { descriptor } => descriptor.validate()?,
        Operation::ReadbackInspection { .. }
        | Operation::InterruptRun { .. }
        | Operation::OrphanRecovery { .. }
        | Operation::MigrateV2ToV3 { .. } => {}
        Operation::AppendReceipt { receipt } => receipt.validate()?,
    }
    Ok(())
}

fn require_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> Result<()> {
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn is_digest(value: &Digest) -> bool {
    canonical::is_lower_hex(value.as_str(), 64)
}

fn namespace_digest(namespace: &Namespace) -> Result<Digest> {
    canonical::canonical_digest_value(&serde_json::json!({
        "schema": RECEIPT_SCHEMA_ID,
        "repository": &namespace.repository,
        "parent_issue": namespace.parent_issue,
        "child_issue": namespace.child_issue,
    }))
}

fn same_receipt_binding(left: &ReceiptRecord, right: &ReceiptRecord) -> bool {
    left.repository == right.repository
        && left.parent_issue == right.parent_issue
        && left.child_issue == right.child_issue
        && left.lock == right.lock
        && left.run_id == right.run_id
        && left.allocation_id == right.allocation_id
        && left.authority == right.authority
        && left.start == right.start
        && left.lease == right.lease
}

fn valid_mutation_transition(prior: MutationState, next: MutationState) -> bool {
    match prior {
        MutationState::Prepared => next == MutationState::InFlight,
        MutationState::InFlight | MutationState::Unknown => matches!(
            next,
            MutationState::Applied | MutationState::NotApplied | MutationState::Unknown
        ),
        MutationState::Applied | MutationState::NotApplied => false,
    }
}

fn receipt_value_without_id(receipt: &ReceiptRecord) -> Result<Value> {
    let mut value = serde_json::to_value(receipt)
        .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    value
        .as_object_mut()
        .ok_or_else(|| BrokerError::new(ErrorCode::InternalInvariant))?
        .remove("receipt_id");
    Ok(value)
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

fn required_bool(object: &Map<String, Value>, key: &str) -> Result<bool> {
    match required_value(object, key)? {
        Value::Bool(value) => Ok(*value),
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

fn optional_identifier_field(object: &Map<String, Value>, key: &str) -> Result<Option<String>> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(parse_identifier(value.clone())?)),
        Some(_) => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn optional_digest_field(object: &Map<String, Value>, key: &str) -> Result<Option<Digest>> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(Digest::parse(value)?)),
        Some(_) => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn optional_candidate(object: &Map<String, Value>, key: &str) -> Result<Option<Candidate>> {
    match required_value(object, key)? {
        Value::Null => Ok(None),
        value => Candidate::from_value(value).map(Some),
    }
}

fn optional_payload_mutation_outcome(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<PayloadMutationOutcome>> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(parse_payload_mutation_outcome(value)?)),
        Some(_) => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn evidence_value_without_digest(evidence: &OutcomeEvidence) -> Result<Value> {
    let mut value = serde_json::to_value(evidence)
        .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    value
        .as_object_mut()
        .ok_or_else(|| BrokerError::new(ErrorCode::InternalInvariant))?
        .remove("evidence_digest");
    Ok(value)
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

fn validate_identifier(value: &str) -> Result<()> {
    parse_identifier(value.to_owned()).map(|_| ())
}

fn validate_event_type(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn validate_bounded_identifier(value: &str, max_bytes: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.starts_with('-')
        || value.contains("..")
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn validate_repository(value: &str) -> Result<()> {
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || owner.is_empty()
        || owner.len() > 100
        || name.is_empty()
        || name.len() > 100
        || !value.is_ascii()
        || !owner.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.' | b'-')
        })
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.' | b'-')
        })
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn validate_issue(value: u64) -> Result<()> {
    if value == 0 || value > MAX_SAFE_INTEGER {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn is_safe_git_ref(value: &str) -> bool {
    value.len() <= 240
        && !value.is_empty()
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.ends_with('.')
        && !value.contains("..")
        && !value.contains("@{")
        && value != "@"
        && !value.bytes().any(|byte| {
            matches!(
                byte,
                0..=32 | 127 | b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\'
            )
        })
        && value
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}

fn is_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return false;
    }
    let fields = [
        (&bytes[0..4], 9_999_u32),
        (&bytes[5..7], 12),
        (&bytes[8..10], 31),
        (&bytes[11..13], 23),
        (&bytes[14..16], 59),
        (&bytes[17..19], 59),
        (&bytes[20..23], 999),
    ];
    if fields
        .iter()
        .any(|(part, maximum)| decimal(part).is_none_or(|value| value > *maximum))
    {
        return false;
    }
    let year = decimal(&bytes[0..4]).unwrap_or_default();
    let month = decimal(&bytes[5..7]).unwrap_or_default();
    let day = decimal(&bytes[8..10]).unwrap_or_default();
    (1..=12).contains(&month) && (1..=days_in_month(year, month)).contains(&day)
}

fn decimal(value: &[u8]) -> Option<u32> {
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    value.iter().try_fold(0_u32, |total, digit| {
        total
            .checked_mul(10)
            .and_then(|total| total.checked_add(u32::from(*digit - b'0')))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
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

fn parse_author_association(value: &str) -> Result<AuthorAssociation> {
    match value {
        "OWNER" => Ok(AuthorAssociation::Owner),
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

fn parse_payload_mutation_outcome(value: &str) -> Result<PayloadMutationOutcome> {
    match value {
        "KNOWN" => Ok(PayloadMutationOutcome::Known),
        "UNKNOWN" => Ok(PayloadMutationOutcome::Unknown),
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub schema: String,
    pub request_id: Option<RequestId>,
    pub ok: bool,
    pub result: Option<ResponseResult>,
    pub error: Option<WireError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseResult {
    pub result_digest: Digest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readback: Option<Readback>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
            result: Some(ResponseResult {
                result_digest,
                readback: None,
            }),
            error: None,
        }
    }

    pub fn success_with_readback(request_id: RequestId, readback: Readback) -> Result<Self> {
        readback.validate()?;
        let result_digest = canonical::canonical_digest_value(&readback)?;
        Ok(Self {
            schema: PROTOCOL_ID.to_owned(),
            request_id: Some(request_id),
            ok: true,
            result: Some(ResponseResult {
                result_digest,
                readback: Some(readback),
            }),
            error: None,
        })
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
        if let Some(result) = &self.result
            && let Some(readback) = &result.readback
        {
            readback.validate()?;
            if canonical::canonical_digest_value(readback)? != result.result_digest {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
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
    Request::from_value(value.to_serde()?)
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
    response_from_value(value.to_serde()?)
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
            if value.is_empty()
                || value.len() > 2
                || value
                    .keys()
                    .any(|key| !["readback", "result_digest"].contains(&key.as_str()))
            {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            let readback = match value.get("readback") {
                None => None,
                Some(Value::Object(readback)) => Some(
                    serde_json::from_value(Value::Object(readback.clone()))
                        .map_err(|_| BrokerError::new(ErrorCode::InvalidField))?,
                ),
                Some(_) => return Err(BrokerError::new(ErrorCode::InvalidField)),
            };
            Some(ResponseResult {
                result_digest: required_digest(value, "result_digest")?,
                readback,
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
