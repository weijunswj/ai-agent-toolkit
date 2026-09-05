use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::canonical::{self, Digest, MAX_SAFE_INTEGER, ParseLimits};
use crate::crypto;
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

impl AuthoritySnapshot {
    fn validate(&self) -> Result<()> {
        validate_issue(self.child_comment_id)?;
        validate_issue(self.parent_comment_id)?;
        validate_identifier(&self.node_id)?;
        if self.author_login.is_empty()
            || self.author_login.len() > 39
            || !self
                .author_login
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || self.author_association != AuthorAssociation::Owner
            || !crypto::is_timestamp(&self.updated_at)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefSnapshot {
    pub detached: bool,
    pub name: Option<String>,
}

impl RefSnapshot {
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

impl StartSnapshot {
    fn validate(&self) -> Result<()> {
        for value in [&self.base_sha, &self.head_sha, &self.tree_sha] {
            if !canonical::is_lower_hex(value, 40) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
        }
        if !self.clean_worktree {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        self.ref_snapshot.validate()
    }
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

impl Candidate {
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lease {
    pub lease_id: String,
    pub fence_id: String,
    pub fence_sequence: u64,
    pub issued_at: String,
    pub expires_at: String,
}

impl Lease {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.lease_id)?;
        validate_identifier(&self.fence_id)?;
        validate_issue(self.fence_sequence)?;
        if !crypto::is_timestamp(&self.issued_at)
            || !crypto::is_timestamp(&self.expires_at)
            || self.expires_at <= self.issued_at
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    pub id: String,
    pub digest: Digest,
}

impl EvidenceRef {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.id)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayloadMutationOutcome {
    Known,
    Unknown,
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

impl ReceiptPayload {
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
        if canonical::canonical_serialize_value(self)?.len() > 8_192 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
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
#[serde(deny_unknown_fields)]
pub struct ReceiptInput {
    pub receipt_type: ReceiptType,
    pub candidate: Option<Candidate>,
    pub payload: ReceiptPayload,
    pub created_at: String,
}

impl ReceiptInput {
    fn validate(&self) -> Result<()> {
        if matches!(self.receipt_type, ReceiptType::RunStarted)
            || !crypto::is_timestamp(&self.created_at)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(candidate) = &self.candidate {
            candidate.validate()?;
        }
        self.payload.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetIdentity {
    pub resource_type: String,
    pub resource_id: String,
}

impl TargetIdentity {
    pub fn validate(&self) -> Result<()> {
        validate_bounded_identifier(&self.resource_type, 80)?;
        validate_bounded_identifier(&self.resource_id, 512)?;
        if canonical::canonical_serialize_value(self)?.len() > 2_048 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
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

impl OutcomeEvidence {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.operation_id)?;
        validate_identifier(&self.provider_operation_key)?;
        self.target_identity.validate()?;
        if self.target_digest != canonical::canonical_digest_value(&self.target_identity)?
            || !crypto::is_timestamp(&self.evidence_at)
            || matches!(
                self.classification,
                MutationState::Prepared | MutationState::InFlight
            )
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
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
        let mut value = serde_json::to_value(self)
            .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        value
            .as_object_mut()
            .ok_or_else(|| BrokerError::new(ErrorCode::InternalInvariant))?
            .remove("evidence_digest");
        if canonical::canonical_digest(&value)? != self.evidence_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_serialize_value(self)?.len() > 4_096 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunAllocation {
    pub allocation_id: String,
    pub run_id: String,
    pub lock: String,
    pub lease: Lease,
}

impl RunAllocation {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.allocation_id)?;
        validate_identifier(&self.run_id)?;
        validate_identifier(&self.lock)?;
        self.lease.validate()
    }
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

impl ReceiptRecord {
    fn validate(&self) -> Result<()> {
        if self.schema != RECEIPT_SCHEMA_ID || self.sequence == 0 || self.sequence > 128 {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if matches!(self.receipt_type, ReceiptType::RunStarted) != (self.sequence == 1)
            || (self.sequence == 1 && self.prior_receipt_id.is_some())
            || (self.sequence > 1 && self.prior_receipt_id.is_none())
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
        if !crypto::is_timestamp(&self.created_at) || self.created_at < self.lease.issued_at {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        let mut value = serde_json::to_value(self)
            .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        value
            .as_object_mut()
            .ok_or_else(|| BrokerError::new(ErrorCode::InternalInvariant))?
            .remove("receipt_id");
        if canonical::canonical_digest(&value)? != self.receipt_id {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if canonical::canonical_serialize_value(self)?.len() > 16_384 {
            return Err(BrokerError::new(ErrorCode::LimitViolation));
        }
        Ok(())
    }
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

impl MutationDescriptor {
    fn validate(&self) -> Result<()> {
        self.target_identity.validate()?;
        if self.target_digest != canonical::canonical_digest_value(&self.target_identity)? {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if let Some(value) = &self.retry_of_operation_id {
            validate_identifier(value)?;
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
            || self.operation_kind != MutationOperationKind::AppendCreate
                && self.expected_post_state_digest.is_none()
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
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

impl MutationOperation {
    fn validate(&self) -> Result<()> {
        validate_identifier(&self.operation_id)?;
        validate_identifier(&self.run_id)?;
        validate_identifier(&self.allocation_id)?;
        validate_identifier(&self.lock)?;
        validate_identifier(&self.lease_id)?;
        validate_identifier(&self.fence_id)?;
        validate_identifier(&self.provider_operation_key)?;
        validate_issue(self.fence_sequence)?;
        if !crypto::is_timestamp(&self.created_at)
            || self.provider_operation_key != format!("gpr:{}", self.operation_id)
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
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
        Ok(())
    }
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

impl MutationEvent {
    fn validate(&self, operation: &MutationOperation) -> Result<()> {
        validate_identifier(&self.event_id)?;
        if self.operation_id != operation.operation_id
            || self.sequence == 0
            || !crypto::is_timestamp(&self.event_at)
            || !self
                .event_type
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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
                namespace_digest,
            } => {
                namespace.validate()?;
                if namespace_digest != &namespace_digest_value(namespace)? {
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
                for receipt in receipts {
                    receipt.validate()?;
                }
                if chain_digest != &canonical::canonical_digest_value(receipts)? {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            Self::Mutation {
                operation,
                state,
                events,
            } => {
                operation.validate()?;
                if events.is_empty() || events.last().is_none_or(|event| &event.state != state) {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                for event in events {
                    event.validate(operation)?;
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
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub enum ReadbackTarget {
    #[serde(rename = "NAMESPACE")]
    Namespace,
    #[serde(rename = "RUN")]
    Run,
    #[serde(rename = "RECEIPT_CHAIN")]
    ReceiptChain,
    #[serde(rename = "MUTATION")]
    Mutation,
    #[serde(rename = "RECOVERY")]
    Recovery,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub enum InterruptReason {
    #[serde(rename = "REQUESTED")]
    Requested,
    #[serde(rename = "BROKER_RECOVERY")]
    BrokerRecovery,
    #[serde(rename = "SHUTDOWN")]
    Shutdown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationKind {
    ReadbackInspection,
    AllocateRun,
    StartRun,
    AppendReceipt,
    InterruptRun,
    MutationAdmit,
    MutationDispatch,
    MutationOutcome,
    MutationReconcile,
    OrphanRecovery,
    MigrateV2ToV3,
}

impl OperationKind {
    pub const ALL: [Self; 11] = [
        Self::ReadbackInspection,
        Self::AllocateRun,
        Self::StartRun,
        Self::AppendReceipt,
        Self::InterruptRun,
        Self::MutationAdmit,
        Self::MutationDispatch,
        Self::MutationOutcome,
        Self::MutationReconcile,
        Self::OrphanRecovery,
        Self::MigrateV2ToV3,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadbackInspection => "READBACK_INSPECTION",
            Self::AllocateRun => "ALLOCATE_RUN",
            Self::StartRun => "START_RUN",
            Self::AppendReceipt => "APPEND_RECEIPT",
            Self::InterruptRun => "INTERRUPT_RUN",
            Self::MutationAdmit => "MUTATION_ADMIT",
            Self::MutationDispatch => "MUTATION_DISPATCH",
            Self::MutationOutcome => "MUTATION_OUTCOME",
            Self::MutationReconcile => "MUTATION_RECONCILE",
            Self::OrphanRecovery => "ORPHAN_RECOVERY",
            Self::MigrateV2ToV3 => "MIGRATE_V2_TO_V3",
        }
    }
}

impl Operation {
    pub fn kind(&self) -> OperationKind {
        match self {
            Self::ReadbackInspection { .. } => OperationKind::ReadbackInspection,
            Self::AllocateRun { .. } => OperationKind::AllocateRun,
            Self::StartRun { .. } => OperationKind::StartRun,
            Self::AppendReceipt { .. } => OperationKind::AppendReceipt,
            Self::InterruptRun { .. } => OperationKind::InterruptRun,
            Self::MutationAdmit { .. } => OperationKind::MutationAdmit,
            Self::MutationDispatch { .. } => OperationKind::MutationDispatch,
            Self::MutationOutcome { .. } => OperationKind::MutationOutcome,
            Self::MutationReconcile { .. } => OperationKind::MutationReconcile,
            Self::OrphanRecovery { .. } => OperationKind::OrphanRecovery,
            Self::MigrateV2ToV3 { .. } => OperationKind::MigrateV2ToV3,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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
            return Err(BrokerError::new(ErrorCode::UnsupportedSchema));
        }
        validate_identifier(&self.lock)?;
        self.namespace.validate()?;
        validate_operation(&self.operation)
    }

    pub fn digest(&self) -> Result<Digest> {
        self.validate()?;
        canonical::canonical_digest_value(self)
    }

    pub fn from_canonical_json(bytes: &[u8]) -> Result<Self> {
        let value = canonical::parse_json(bytes, ParseLimits::PROTOCOL)?;
        if canonical::canonical_serialize(&value)? != bytes {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        Self::from_value(value.to_serde()?)
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
        let request = Self {
            schema,
            request_id: RequestId::parse(&required_string(object, "request_id")?)?,
            operation: operation_from_value(required_value(object, "operation")?)?,
            namespace: typed_value(required_value(object, "namespace")?)?,
            lock: required_string(object, "lock")?,
            expected: typed_value(required_value(object, "expected")?)?,
        };
        request.validate()?;
        Ok(request)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum SuccessValue {
    #[serde(rename = "READBACK_INSPECTION")]
    ReadbackInspection { readback: Readback },
    #[serde(rename = "ALLOCATE_RUN")]
    AllocateRun { allocation: RunAllocation },
    #[serde(rename = "START_RUN")]
    StartRun {
        allocation: RunAllocation,
        started: bool,
        run_started_receipt_id: Option<Digest>,
    },
    #[serde(rename = "APPEND_RECEIPT")]
    AppendReceipt {
        receipt: ReceiptRecord,
        chain_digest: Digest,
    },
    #[serde(rename = "INTERRUPT_RUN")]
    InterruptRun { receipt: ReceiptRecord },
    #[serde(rename = "MUTATION_ADMIT")]
    MutationAdmit { operation: MutationOperation },
    #[serde(rename = "MUTATION_DISPATCH")]
    MutationDispatch { event: MutationEvent },
    #[serde(rename = "MUTATION_OUTCOME")]
    MutationOutcome {
        operation: MutationOperation,
        event: MutationEvent,
    },
    #[serde(rename = "MUTATION_RECONCILE")]
    MutationReconcile { readback: Readback },
    #[serde(rename = "ORPHAN_RECOVERY")]
    OrphanRecovery { recovery: Readback },
    #[serde(rename = "MIGRATE_V2_TO_V3")]
    MigrateV2ToV3 {
        source_schema_fingerprint: Digest,
        result_digest: Digest,
    },
}

impl SuccessValue {
    pub fn kind(&self) -> OperationKind {
        match self {
            Self::ReadbackInspection { .. } => OperationKind::ReadbackInspection,
            Self::AllocateRun { .. } => OperationKind::AllocateRun,
            Self::StartRun { .. } => OperationKind::StartRun,
            Self::AppendReceipt { .. } => OperationKind::AppendReceipt,
            Self::InterruptRun { .. } => OperationKind::InterruptRun,
            Self::MutationAdmit { .. } => OperationKind::MutationAdmit,
            Self::MutationDispatch { .. } => OperationKind::MutationDispatch,
            Self::MutationOutcome { .. } => OperationKind::MutationOutcome,
            Self::MutationReconcile { .. } => OperationKind::MutationReconcile,
            Self::OrphanRecovery { .. } => OperationKind::OrphanRecovery,
            Self::MigrateV2ToV3 { .. } => OperationKind::MigrateV2ToV3,
        }
    }

    fn validate(&self) -> Result<()> {
        match self {
            Self::ReadbackInspection { readback } | Self::MutationReconcile { readback } => {
                readback.validate()
            }
            Self::AllocateRun { allocation } => allocation.validate(),
            Self::StartRun {
                allocation,
                started,
                run_started_receipt_id,
            } => {
                allocation.validate()?;
                if *started != run_started_receipt_id.is_some() {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                Ok(())
            }
            Self::AppendReceipt { receipt, .. } | Self::InterruptRun { receipt } => {
                receipt.validate()
            }
            Self::MutationAdmit { operation } => operation.validate(),
            Self::MutationDispatch { event } => {
                if event.sequence == 0 {
                    Err(BrokerError::new(ErrorCode::InvalidField))
                } else {
                    Ok(())
                }
            }
            Self::MutationOutcome { operation, event } => {
                operation.validate()?;
                event.validate(operation)
            }
            Self::OrphanRecovery { recovery } => recovery.validate(),
            Self::MigrateV2ToV3 { .. } => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseResult {
    pub operation: String,
    pub value: SuccessValue,
    pub result_digest: Digest,
}

impl ResponseResult {
    fn validate(&self) -> Result<()> {
        let operation = operation_kind_from_str(&self.operation)?;
        if self.value.kind() != operation {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        self.value.validate()?;
        let value = serde_json::to_value(&self.value)
            .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        let expected = canonical::canonical_digest_value(&serde_json::json!({
            "operation": self.operation,
            "value": value
        }))?;
        if expected != self.result_digest {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    pub code: String,
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

impl Response {
    pub fn success(
        request_id: RequestId,
        operation: OperationKind,
        value: SuccessValue,
    ) -> Result<Self> {
        if value.kind() != operation {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        let value_json = serde_json::to_value(&value)
            .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        let result_digest = canonical::canonical_digest_value(&serde_json::json!({
            "operation": operation.as_str(),
            "value": value_json
        }))?;
        let response = Self {
            schema: PROTOCOL_ID.to_owned(),
            request_id: Some(request_id),
            ok: true,
            result: Some(ResponseResult {
                operation: operation.as_str().to_owned(),
                value,
                result_digest,
            }),
            error: None,
        };
        response.validate()?;
        Ok(response)
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
        if self.ok {
            if self.request_id.is_none() || self.result.is_none() || self.error.is_some() {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            self.result.as_ref().expect("checked result").validate()
        } else {
            if self.result.is_some() || self.error.is_none() {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            if !ErrorCode::is_known(&self.error.as_ref().expect("checked error").code) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            Ok(())
        }
    }
}

pub fn namespace_digest(namespace: &Namespace) -> Result<Digest> {
    namespace.validate()?;
    canonical::canonical_digest_value(&serde_json::json!({
        "schema": RECEIPT_SCHEMA_ID,
        "repository": namespace.repository,
        "parent_issue": namespace.parent_issue,
        "child_issue": namespace.child_issue
    }))
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() > MAX_FRAME_PAYLOAD_BYTES {
        return Err(BrokerError::new(ErrorCode::LimitViolation));
    }
    let length =
        u32::try_from(payload.len()).map_err(|_| BrokerError::new(ErrorCode::LimitViolation))?;
    let mut frame = Vec::with_capacity(payload.len() + 4);
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
    let expected = length
        .checked_add(4)
        .ok_or_else(|| BrokerError::new(ErrorCode::MalformedFrame))?;
    if frame.len() != expected {
        return Err(BrokerError::new(ErrorCode::MalformedFrame));
    }
    Ok(&frame[4..])
}

pub fn encode_request_frame(request: &Request) -> Result<Vec<u8>> {
    request.validate()?;
    encode_frame(&canonical::canonical_serialize_value(request)?)
}

pub fn decode_request_frame(frame: &[u8]) -> Result<Request> {
    let payload = decode_frame(frame)?;
    decode_canonical_payload(payload).and_then(Request::from_value)
}

pub fn encode_response_frame(response: &Response) -> Result<Vec<u8>> {
    response.validate()?;
    encode_frame(&canonical::canonical_serialize_value(response)?)
}

pub fn decode_response_frame(frame: &[u8]) -> Result<Response> {
    let payload = decode_frame(frame)?;
    let value = decode_canonical_payload(payload)?;
    response_from_value(value)
}

fn decode_canonical_payload(payload: &[u8]) -> Result<Value> {
    if core::str::from_utf8(payload).is_err() {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    let value = canonical::parse_json(payload, ParseLimits::PROTOCOL)?;
    if canonical::canonical_serialize(&value)? != payload {
        return Err(BrokerError::new(ErrorCode::MalformedRequest));
    }
    value.to_serde()
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
        value => Some(response_result_from_value(value)?),
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

fn response_result_from_value(value: &Value) -> Result<ResponseResult> {
    let object = value
        .as_object()
        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
    require_exact_keys(object, &["operation", "result_digest", "value"])?;
    let result = ResponseResult {
        operation: required_string(object, "operation")?,
        value: success_value_from_value(required_value(object, "value")?)?,
        result_digest: required_digest(object, "result_digest")?,
    };
    result.validate()?;
    Ok(result)
}

fn success_value_from_value(value: &Value) -> Result<SuccessValue> {
    let object = value
        .as_object()
        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
    let kind = required_string(object, "kind")?;
    match kind.as_str() {
        "READBACK_INSPECTION" => {
            require_exact_keys(object, &["kind", "readback"])?;
            Ok(SuccessValue::ReadbackInspection {
                readback: readback_from_value(required_value(object, "readback")?)?,
            })
        }
        "ALLOCATE_RUN" => {
            require_exact_keys(object, &["allocation", "kind"])?;
            Ok(SuccessValue::AllocateRun {
                allocation: typed_value(required_value(object, "allocation")?)?,
            })
        }
        "START_RUN" => {
            require_exact_keys(
                object,
                &["allocation", "kind", "run_started_receipt_id", "started"],
            )?;
            Ok(SuccessValue::StartRun {
                allocation: typed_value(required_value(object, "allocation")?)?,
                started: required_bool(object, "started")?,
                run_started_receipt_id: optional_digest(object, "run_started_receipt_id")?,
            })
        }
        "APPEND_RECEIPT" => {
            require_exact_keys(object, &["chain_digest", "kind", "receipt"])?;
            Ok(SuccessValue::AppendReceipt {
                receipt: typed_value(required_value(object, "receipt")?)?,
                chain_digest: required_digest(object, "chain_digest")?,
            })
        }
        "INTERRUPT_RUN" => {
            require_exact_keys(object, &["kind", "receipt"])?;
            Ok(SuccessValue::InterruptRun {
                receipt: typed_value(required_value(object, "receipt")?)?,
            })
        }
        "MUTATION_ADMIT" => {
            require_exact_keys(object, &["kind", "operation"])?;
            Ok(SuccessValue::MutationAdmit {
                operation: typed_value(required_value(object, "operation")?)?,
            })
        }
        "MUTATION_DISPATCH" => {
            require_exact_keys(object, &["event", "kind"])?;
            Ok(SuccessValue::MutationDispatch {
                event: typed_value(required_value(object, "event")?)?,
            })
        }
        "MUTATION_OUTCOME" => {
            require_exact_keys(object, &["event", "kind", "operation"])?;
            Ok(SuccessValue::MutationOutcome {
                operation: typed_value(required_value(object, "operation")?)?,
                event: typed_value(required_value(object, "event")?)?,
            })
        }
        "MUTATION_RECONCILE" => {
            require_exact_keys(object, &["kind", "readback"])?;
            Ok(SuccessValue::MutationReconcile {
                readback: readback_from_value(required_value(object, "readback")?)?,
            })
        }
        "ORPHAN_RECOVERY" => {
            require_exact_keys(object, &["kind", "recovery"])?;
            Ok(SuccessValue::OrphanRecovery {
                recovery: readback_from_value(required_value(object, "recovery")?)?,
            })
        }
        "MIGRATE_V2_TO_V3" => {
            require_exact_keys(
                object,
                &["kind", "result_digest", "source_schema_fingerprint"],
            )?;
            Ok(SuccessValue::MigrateV2ToV3 {
                source_schema_fingerprint: required_digest(object, "source_schema_fingerprint")?,
                result_digest: required_digest(object, "result_digest")?,
            })
        }
        _ => Err(BrokerError::new(ErrorCode::UnsupportedOperation)),
    }
}

fn readback_from_value(value: &Value) -> Result<Readback> {
    let object = value
        .as_object()
        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
    let kind = required_string(object, "kind")?;
    let readback = match kind.as_str() {
        "NAMESPACE" => {
            require_exact_keys(object, &["kind", "namespace", "namespace_digest"])?;
            Readback::Namespace {
                namespace: typed_value(required_value(object, "namespace")?)?,
                namespace_digest: required_digest(object, "namespace_digest")?,
            }
        }
        "RUN" => {
            require_exact_keys(
                object,
                &["allocation", "kind", "run_started_receipt_id", "started"],
            )?;
            Readback::Run {
                allocation: typed_value(required_value(object, "allocation")?)?,
                started: required_bool(object, "started")?,
                run_started_receipt_id: optional_digest(object, "run_started_receipt_id")?,
            }
        }
        "RECEIPT_CHAIN" => {
            require_exact_keys(object, &["chain_digest", "kind", "receipts", "run_id"])?;
            Readback::ReceiptChain {
                run_id: parse_identifier(required_string(object, "run_id")?)?,
                receipts: typed_array(required_value(object, "receipts")?)?,
                chain_digest: required_digest(object, "chain_digest")?,
            }
        }
        "MUTATION" => {
            require_exact_keys(object, &["events", "kind", "operation", "state"])?;
            Readback::Mutation {
                operation: Box::new(typed_value(required_value(object, "operation")?)?),
                state: typed_value(required_value(object, "state")?)?,
                events: typed_array(required_value(object, "events")?)?,
            }
        }
        "RECOVERY" => {
            require_exact_keys(object, &["kind", "receipt_id", "run_id", "status"])?;
            Readback::Recovery {
                run_id: parse_identifier(required_string(object, "run_id")?)?,
                status: typed_value(required_value(object, "status")?)?,
                receipt_id: optional_digest(object, "receipt_id")?,
            }
        }
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    readback.validate()?;
    Ok(readback)
}

fn operation_from_value(value: &Value) -> Result<Operation> {
    let object = value
        .as_object()
        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
    let kind = required_string(object, "kind")?;
    let operation = match kind.as_str() {
        "READBACK_INSPECTION" => {
            require_exact_keys(object, &["kind", "target"])?;
            Operation::ReadbackInspection {
                target: parse_readback_target(&required_string(object, "target")?)?,
            }
        }
        "ALLOCATE_RUN" => {
            require_exact_keys(
                object,
                &["authority", "candidate", "kind", "lease_ms", "start"],
            )?;
            if !matches!(required_value(object, "candidate")?, Value::Null) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            Operation::AllocateRun {
                authority: typed_value(required_value(object, "authority")?)?,
                start: typed_value(required_value(object, "start")?)?,
                candidate: None,
                lease_ms: required_u64(object, "lease_ms")?,
            }
        }
        "START_RUN" => {
            require_exact_keys(object, &["allocation_id", "kind"])?;
            Operation::StartRun {
                allocation_id: parse_identifier(required_string(object, "allocation_id")?)?,
            }
        }
        "APPEND_RECEIPT" => {
            require_exact_keys(object, &["kind", "receipt"])?;
            Operation::AppendReceipt {
                receipt: typed_value(required_value(object, "receipt")?)?,
            }
        }
        "INTERRUPT_RUN" => {
            require_exact_keys(object, &["kind", "reason"])?;
            Operation::InterruptRun {
                reason: parse_interrupt_reason(&required_string(object, "reason")?)?,
            }
        }
        "MUTATION_ADMIT" => {
            require_exact_keys(object, &["descriptor", "kind"])?;
            Operation::MutationAdmit {
                descriptor: typed_value(required_value(object, "descriptor")?)?,
            }
        }
        "MUTATION_DISPATCH" => {
            require_exact_keys(object, &["kind", "operation_id"])?;
            Operation::MutationDispatch {
                operation_id: parse_identifier(required_string(object, "operation_id")?)?,
            }
        }
        "MUTATION_OUTCOME" => {
            require_exact_keys(object, &["evidence", "kind", "operation_id"])?;
            Operation::MutationOutcome {
                operation_id: parse_identifier(required_string(object, "operation_id")?)?,
                evidence: typed_value(required_value(object, "evidence")?)?,
            }
        }
        "MUTATION_RECONCILE" => {
            require_exact_keys(object, &["kind", "operation_id"])?;
            Operation::MutationReconcile {
                operation_id: parse_identifier(required_string(object, "operation_id")?)?,
            }
        }
        "ORPHAN_RECOVERY" => {
            require_exact_keys(object, &["evidence_digest", "kind", "old_run_digest"])?;
            Operation::OrphanRecovery {
                old_run_digest: required_digest(object, "old_run_digest")?,
                evidence_digest: required_digest(object, "evidence_digest")?,
            }
        }
        "MIGRATE_V2_TO_V3" => {
            require_exact_keys(object, &["kind", "source_schema_fingerprint"])?;
            Operation::MigrateV2ToV3 {
                source_schema_fingerprint: required_digest(object, "source_schema_fingerprint")?,
            }
        }
        _ => return Err(BrokerError::new(ErrorCode::UnsupportedOperation)),
    };
    validate_operation(&operation)?;
    Ok(operation)
}

fn validate_operation(operation: &Operation) -> Result<()> {
    match operation {
        Operation::ReadbackInspection { .. }
        | Operation::InterruptRun { .. }
        | Operation::OrphanRecovery { .. }
        | Operation::MigrateV2ToV3 { .. } => Ok(()),
        Operation::AllocateRun {
            authority,
            start,
            candidate,
            lease_ms,
        } => {
            authority.validate()?;
            start.validate()?;
            if candidate.is_some() || !(1_000..=86_400_000).contains(lease_ms) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            Ok(())
        }
        Operation::StartRun { allocation_id }
        | Operation::MutationDispatch {
            operation_id: allocation_id,
        }
        | Operation::MutationReconcile {
            operation_id: allocation_id,
        } => validate_identifier(allocation_id),
        Operation::AppendReceipt { receipt } => receipt.validate(),
        Operation::MutationAdmit { descriptor } => descriptor.validate(),
        Operation::MutationOutcome {
            operation_id,
            evidence,
        } => {
            validate_identifier(operation_id)?;
            if evidence.operation_id != *operation_id {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            evidence.validate()
        }
    }
}

fn namespace_digest_value(namespace: &Namespace) -> Result<Digest> {
    namespace_digest(namespace)
}

fn typed_value<T: DeserializeOwned>(value: &Value) -> Result<T> {
    serde_json::from_value(value.clone()).map_err(|_| BrokerError::new(ErrorCode::InvalidField))
}

fn typed_array<T: DeserializeOwned>(value: &Value) -> Result<Vec<T>> {
    match value {
        Value::Array(values) if values.len() <= MAX_ARRAY_ITEMS => {
            values.iter().map(typed_value).collect()
        }
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn require_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> Result<()> {
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
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
        Value::String(value) => Digest::parse(value).map(Some),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}

fn parse_identifier(value: String) -> Result<String> {
    validate_identifier(&value)?;
    Ok(value)
}

fn validate_identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 160
        || value.starts_with('-')
        || value.contains("..")
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
    {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn validate_bounded_identifier(value: &str, maximum: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > maximum
        || value.starts_with('-')
        || value.contains("..")
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
    {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
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
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn validate_issue(value: u64) -> Result<()> {
    if value == 0 || value > MAX_SAFE_INTEGER {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn is_safe_git_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
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

fn operation_kind_from_str(value: &str) -> Result<OperationKind> {
    OperationKind::ALL
        .into_iter()
        .find(|kind| kind.as_str() == value)
        .ok_or_else(|| BrokerError::new(ErrorCode::UnsupportedOperation))
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

fn parse_interrupt_reason(value: &str) -> Result<InterruptReason> {
    match value {
        "REQUESTED" => Ok(InterruptReason::Requested),
        "BROKER_RECOVERY" => Ok(InterruptReason::BrokerRecovery),
        "SHUTDOWN" => Ok(InterruptReason::Shutdown),
        _ => Err(BrokerError::new(ErrorCode::InvalidField)),
    }
}
