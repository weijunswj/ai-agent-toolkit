use core::fmt;

use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::Sha256;
use zeroize::Zeroize;

use crate::canonical::{
    Digest, MAX_SAFE_INTEGER, canonical_digest, canonical_serialize, decode_hex, encode_hex,
};
use crate::error::{BrokerError, ErrorCode, Result};

pub const HOLDER_ATTESTATION_SCHEMA: &str = "toolkit.github-program.holder-attestation.v1";
pub const HOLDER_ATTESTATION_ALGORITHM: &str = "HMAC-SHA-256";
pub const HOLDER_TAG_DOMAIN: &[u8] = b"toolkit.github-program.holder-attestation-tag.v1\0";
pub const PRINCIPAL_DOMAIN: &str = "toolkit.github-program.principal.v1";
pub const BROKER_IDENTITY_DOMAIN: &str = "toolkit.github-program.broker-identity.v1";
pub const PROCESS_IDENTITY_DOMAIN: &str = "toolkit.github-program.process-identity.v1";
pub const PROCESS_START_IDENTITY_DOMAIN: &str = "toolkit.github-program.process-start-identity.v1";
pub const BOOT_IDENTITY_DOMAIN: &str = "toolkit.github-program.boot-identity.v1";
pub const PID_NAMESPACE_IDENTITY_DOMAIN: &str = "toolkit.github-program.pid-namespace-identity.v1";
pub const PROCESS_INCARNATION_DOMAIN: &str = "toolkit.github-program.process-incarnation.v1";
pub const STORE_BINDING_DOMAIN: &str = "toolkit.github-program.store-binding.v1";
pub const PATH_BINDING_DOMAIN: &str = "toolkit.github-program.path-binding.v1";

pub struct HolderKey([u8; 32]);

impl fmt::Debug for HolderKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("HolderKey([REDACTED])")
    }
}

impl HolderKey {
    pub fn from_bytes(value: [u8; 32]) -> Self {
        Self(value)
    }

    pub fn generate() -> Result<Self> {
        let mut value = [0_u8; 32];
        getrandom::fill(&mut value).map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        Ok(Self(value))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Drop for HolderKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct KeyId(String);

impl KeyId {
    pub fn parse(value: &str) -> Result<Self> {
        if value.len() == 32
            && value
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            Ok(Self(value.to_owned()))
        } else {
            Err(BrokerError::new(ErrorCode::InvalidField))
        }
    }

    pub fn generate() -> Result<Self> {
        let mut value = [0_u8; 16];
        getrandom::fill(&mut value).map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
        Ok(Self(encode_hex(&value)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for KeyId {
    fn serialize<S>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for KeyId {
    fn deserialize<D>(deserializer: D) -> core::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(|_| serde::de::Error::custom("invalid key id"))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HolderAttestation {
    pub schema: String,
    pub attestation_id: String,
    pub repository: String,
    pub parent_issue: u64,
    pub child_issue: u64,
    pub lock: String,
    pub allocation_id: String,
    pub allocation_digest: Digest,
    pub run_id: String,
    pub run_digest: Digest,
    pub lease_id: String,
    pub fence_id: String,
    pub fence_sequence: u64,
    pub authority_digest: Digest,
    pub start_digest: Digest,
    pub algorithm: String,
    pub key_id: KeyId,
    pub broker_identity_digest: Digest,
    pub platform: String,
    pub process_id_digest: Digest,
    pub process_start_digest: Digest,
    pub boot_id_digest: Digest,
    pub pid_namespace_digest: Digest,
    pub process_incarnation_digest: Digest,
    pub lease_issued_at: String,
    pub lease_expires_at: String,
    pub attestation_digest: Digest,
    pub attestation_tag: Digest,
}

impl HolderAttestation {
    pub fn validate(&self) -> Result<()> {
        validate_platform(&self.platform)?;
        if self.schema != HOLDER_ATTESTATION_SCHEMA
            || self.algorithm != HOLDER_ATTESTATION_ALGORITHM
            || self.fence_sequence == 0
            || self.fence_sequence > MAX_SAFE_INTEGER
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        validate_repository(&self.repository)?;
        validate_issue(self.parent_issue)?;
        validate_issue(self.child_issue)?;
        validate_identifier(&self.lock)?;
        for value in [
            &self.attestation_id,
            &self.allocation_id,
            &self.run_id,
            &self.lease_id,
            &self.fence_id,
        ] {
            validate_identifier(value)?;
        }
        if !is_timestamp(&self.lease_issued_at)
            || !is_timestamp(&self.lease_expires_at)
            || self.lease_expires_at.as_str() <= self.lease_issued_at.as_str()
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        Ok(())
    }
}

pub fn holder_tag(attestation: &HolderAttestation, key: &HolderKey) -> Result<Digest> {
    attestation.validate()?;
    let payload = holder_tag_payload(attestation)?;
    let payload = canonical_serialize(&payload)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes())
        .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    mac.update(HOLDER_TAG_DOMAIN);
    mac.update(&payload);
    let tag = mac.finalize().into_bytes();
    let tag: [u8; 32] = tag.into();
    Ok(Digest::from_bytes(tag))
}

pub fn holder_attestation_digest(attestation: &HolderAttestation) -> Result<Digest> {
    attestation.validate()?;
    let payload = attestation_value_without(attestation, &["attestation_digest"])?;
    canonical_digest(&payload)
}

pub fn sign_holder_attestation(
    mut attestation: HolderAttestation,
    key: &HolderKey,
) -> Result<HolderAttestation> {
    attestation.validate()?;
    attestation.attestation_tag = holder_tag(&attestation, key)?;
    attestation.attestation_digest = holder_attestation_digest(&attestation)?;
    Ok(attestation)
}

pub fn verify_holder_attestation(attestation: &HolderAttestation, key: &HolderKey) -> Result<()> {
    attestation.validate()?;
    let payload = canonical_serialize(&holder_tag_payload(attestation)?)?;
    let tag = decode_hex(attestation.attestation_tag.as_str())
        .filter(|value| value.len() == 32)
        .ok_or_else(|| BrokerError::new(ErrorCode::UnverifiableIdentity))?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes())
        .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    mac.update(HOLDER_TAG_DOMAIN);
    mac.update(&payload);
    mac.verify_slice(&tag)
        .map_err(|_| BrokerError::new(ErrorCode::UnverifiableIdentity))?;

    let expected_digest = holder_attestation_digest(attestation)?;
    if expected_digest != attestation.attestation_digest {
        return Err(BrokerError::new(ErrorCode::UnverifiableIdentity));
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Principal {
    Windows { sid: String },
    Linux { machine_id: String, uid: u64 },
}

pub fn principal_digest(platform: &str, principal: &Principal) -> Result<Digest> {
    validate_platform(platform)?;
    let principal = match (platform, principal) {
        ("windows", Principal::Windows { sid }) => {
            validate_windows_sid(sid)?;
            Value::String(sid.clone())
        }
        ("linux", Principal::Linux { machine_id, uid }) => {
            validate_machine_id(machine_id)?;
            let mut value = Map::new();
            value.insert("machine_id".to_owned(), Value::String(machine_id.clone()));
            value.insert("uid".to_owned(), Value::String(uid.to_string()));
            Value::Object(value)
        }
        _ => return Err(BrokerError::new(ErrorCode::InvalidField)),
    };
    canonical_digest(&Value::Array(vec![
        Value::String(PRINCIPAL_DOMAIN.to_owned()),
        Value::String(platform.to_owned()),
        principal,
    ]))
}

pub fn windows_principal_digest(sid: &str) -> Result<Digest> {
    principal_digest(
        "windows",
        &Principal::Windows {
            sid: sid.to_owned(),
        },
    )
}

pub fn linux_principal_digest(machine_id: &str, uid: u64) -> Result<Digest> {
    principal_digest(
        "linux",
        &Principal::Linux {
            machine_id: machine_id.to_owned(),
            uid,
        },
    )
}

pub fn broker_identity_digest(
    platform: &str,
    executable_sha256: &Digest,
    service_identity: &str,
) -> Result<Digest> {
    validate_platform(platform)?;
    validate_identity_text(service_identity)?;
    let mut value = Map::new();
    value.insert(
        "executable_sha256".to_owned(),
        Value::String(executable_sha256.as_str().to_owned()),
    );
    value.insert("platform".to_owned(), Value::String(platform.to_owned()));
    value.insert(
        "protocol".to_owned(),
        Value::String(crate::protocol::PROTOCOL_ID.to_owned()),
    );
    value.insert(
        "schema".to_owned(),
        Value::String(BROKER_IDENTITY_DOMAIN.to_owned()),
    );
    value.insert(
        "service_identity".to_owned(),
        Value::String(service_identity.to_owned()),
    );
    canonical_digest(&Value::Object(value))
}

pub fn process_identity_digest(platform: &str, process_id: u64) -> Result<Digest> {
    validate_platform(platform)?;
    domain_digest(
        PROCESS_IDENTITY_DOMAIN,
        &[platform, &process_id.to_string()],
    )
}

pub fn process_start_identity_digest(
    platform: &str,
    process_id_digest: &Digest,
    process_start: u64,
) -> Result<Digest> {
    validate_platform(platform)?;
    let mut value = Map::new();
    value.insert(
        "process_id_digest".to_owned(),
        Value::String(process_id_digest.as_str().to_owned()),
    );
    value.insert("platform".to_owned(), Value::String(platform.to_owned()));
    value.insert(
        "process_start".to_owned(),
        Value::String(process_start.to_string()),
    );
    value.insert(
        "schema".to_owned(),
        Value::String(PROCESS_START_IDENTITY_DOMAIN.to_owned()),
    );
    canonical_digest(&Value::Object(value))
}

pub fn process_start_identity_digest_from_ids(
    platform: &str,
    process_id: u64,
    process_start: u64,
) -> Result<Digest> {
    let process_id_digest = process_identity_digest(platform, process_id)?;
    process_start_identity_digest(platform, &process_id_digest, process_start)
}

pub fn boot_identity_digest(platform: &str, boot_id: &str) -> Result<Digest> {
    validate_platform(platform)?;
    domain_digest(BOOT_IDENTITY_DOMAIN, &[platform, boot_id])
}

pub fn pid_namespace_identity_digest(platform: &str, namespace_id: &str) -> Result<Digest> {
    validate_platform(platform)?;
    domain_digest(PID_NAMESPACE_IDENTITY_DOMAIN, &[platform, namespace_id])
}

pub fn process_incarnation_digest(
    platform: &str,
    principal_digest: &Digest,
    process_id_digest: &Digest,
    process_start_digest: &Digest,
    boot_id_digest: &Digest,
    pid_namespace_digest: &Digest,
    session_peer_scope: &str,
) -> Result<Digest> {
    validate_platform(platform)?;
    validate_identity_text(session_peer_scope)?;
    let mut value = Map::new();
    value.insert(
        "boot_id_digest".to_owned(),
        Value::String(boot_id_digest.as_str().to_owned()),
    );
    value.insert(
        "pid_namespace_digest".to_owned(),
        Value::String(pid_namespace_digest.as_str().to_owned()),
    );
    value.insert("platform".to_owned(), Value::String(platform.to_owned()));
    value.insert(
        "principal_digest".to_owned(),
        Value::String(principal_digest.as_str().to_owned()),
    );
    value.insert(
        "process_id_digest".to_owned(),
        Value::String(process_id_digest.as_str().to_owned()),
    );
    value.insert(
        "process_start_digest".to_owned(),
        Value::String(process_start_digest.as_str().to_owned()),
    );
    value.insert(
        "schema".to_owned(),
        Value::String(PROCESS_INCARNATION_DOMAIN.to_owned()),
    );
    value.insert(
        "session_peer_scope".to_owned(),
        Value::String(session_peer_scope.to_owned()),
    );
    canonical_digest(&Value::Object(value))
}

pub fn store_binding_identity_digest(
    namespace_digest: &Digest,
    store_identity_digest: &Digest,
) -> Result<Digest> {
    domain_digest(
        STORE_BINDING_DOMAIN,
        &[namespace_digest.as_str(), store_identity_digest.as_str()],
    )
}

pub fn path_binding_identity_digest(
    store_identity_digest: &Digest,
    trusted_path_identity_digest: &Digest,
) -> Result<Digest> {
    domain_digest(
        PATH_BINDING_DOMAIN,
        &[
            store_identity_digest.as_str(),
            trusted_path_identity_digest.as_str(),
        ],
    )
}

fn domain_digest(domain: &str, values: &[&str]) -> Result<Digest> {
    validate_identifier_text(domain)?;
    for value in values {
        validate_identifier_text(value)?;
    }
    let mut payload = Vec::with_capacity(values.len() + 1);
    payload.push(Value::String(domain.to_owned()));
    payload.extend(
        values
            .iter()
            .map(|value| Value::String((*value).to_owned())),
    );
    canonical_digest(&Value::Array(payload))
}

fn holder_tag_payload(attestation: &HolderAttestation) -> Result<Value> {
    attestation_value_without(attestation, &["attestation_digest", "attestation_tag"])
}

fn attestation_value_without(attestation: &HolderAttestation, excluded: &[&str]) -> Result<Value> {
    let value = serde_json::to_value(attestation)
        .map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    let mut object = value
        .as_object()
        .cloned()
        .ok_or_else(|| BrokerError::new(ErrorCode::InternalInvariant))?;
    for key in excluded {
        object.remove(*key);
    }
    Ok(Value::Object(object))
}

fn validate_identifier(value: &str) -> Result<()> {
    if !is_contract_identifier(value, 160) {
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

fn validate_windows_sid(value: &str) -> Result<()> {
    let mut parts = value.split('-');
    if parts.next() != Some("S") || parts.next() != Some("1") {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    let parts = parts.collect::<Vec<_>>();
    if parts.is_empty()
        || parts.iter().any(|part| {
            part.is_empty()
                || (part.len() > 1 && part.starts_with('0'))
                || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn validate_machine_id(value: &str) -> Result<()> {
    if !crate::canonical::is_lower_hex(value, 32) {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn validate_identity_text(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 4_096
        || value.bytes().any(|byte| matches!(byte, 0..=31 | 127))
    {
        Err(BrokerError::new(ErrorCode::InvalidField))
    } else {
        Ok(())
    }
}

fn validate_identifier_text(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 4_096
        || value.bytes().any(|byte| matches!(byte, 0..=31 | 127))
    {
        return Err(BrokerError::new(ErrorCode::InvalidField));
    }
    Ok(())
}

fn validate_platform(value: &str) -> Result<()> {
    if matches!(value, "windows" | "linux") {
        Ok(())
    } else {
        Err(BrokerError::new(ErrorCode::UnsupportedPlatform))
    }
}

fn is_contract_identifier(value: &str, max_bytes: usize) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= max_bytes
        && bytes[0].is_ascii_alphanumeric()
        && !value.contains("..")
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b':' | b'-'))
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
    let year = decimal(&bytes[0..4]);
    let month = decimal(&bytes[5..7]);
    let day = decimal(&bytes[8..10]);
    let hour = decimal(&bytes[11..13]);
    let minute = decimal(&bytes[14..16]);
    let second = decimal(&bytes[17..19]);
    let millis = decimal(&bytes[20..23]);
    match (year, month, day, hour, minute, second, millis) {
        (
            Some(year),
            Some(month),
            Some(day),
            Some(hour),
            Some(minute),
            Some(second),
            Some(millis),
        ) => {
            (1..=12).contains(&month)
                && (1..=days_in_month(year, month)).contains(&day)
                && hour <= 23
                && minute <= 59
                && second <= 59
                && millis <= 999
        }
        _ => false,
    }
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
