use core::cmp::Ordering;
use core::fmt;

use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use sha2::{Digest as ShaDigest, Sha256};

use crate::error::{BrokerError, ErrorCode, Result};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ParseLimits {
    pub max_depth: usize,
    pub max_object_keys: usize,
    pub max_array_items: usize,
    pub max_string_bytes: usize,
}

impl ParseLimits {
    pub const PROTOCOL: Self = Self {
        max_depth: 16,
        max_object_keys: 64,
        max_array_items: 256,
        max_string_bytes: 4_096,
    };
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Digest(String);

impl Digest {
    pub fn parse(value: &str) -> Result<Self> {
        if is_lower_hex(value, 64) {
            Ok(Self(value.to_owned()))
        } else {
            Err(BrokerError::new(ErrorCode::InvalidField))
        }
    }

    pub fn from_bytes(value: &[u8]) -> Self {
        Self(encode_hex(value))
    }

    pub fn zero() -> Self {
        Self("0".repeat(64))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for Digest {
    fn serialize<S>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Digest {
    fn deserialize<D>(deserializer: D) -> core::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct DigestVisitor;

        impl<'de> Visitor<'de> for DigestVisitor {
            type Value = Digest;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a lowercase 64-character SHA-256 digest")
            }

            fn visit_str<E>(self, value: &str) -> core::result::Result<Self::Value, E>
            where
                E: de::Error,
            {
                Digest::parse(value).map_err(|_| E::custom("invalid digest"))
            }

            fn visit_string<E>(self, value: String) -> core::result::Result<Self::Value, E>
            where
                E: de::Error,
            {
                self.visit_str(&value)
            }
        }

        deserializer.deserialize_string(DigestVisitor)
    }
}

pub fn canonical_serialize(value: &Value) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    write_value(value, &mut output)?;
    Ok(output)
}

pub fn canonical_serialize_value<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let value =
        serde_json::to_value(value).map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    canonical_serialize(&value)
}

pub fn canonical_digest(value: &Value) -> Result<Digest> {
    let bytes = canonical_serialize(value)?;
    Ok(digest_bytes(&bytes))
}

pub fn canonical_digest_value<T: Serialize>(value: &T) -> Result<Digest> {
    let bytes = canonical_serialize_value(value)?;
    Ok(digest_bytes(&bytes))
}

pub fn digest_bytes(value: &[u8]) -> Digest {
    let mut hasher = Sha256::new();
    hasher.update(value);
    let digest = hasher.finalize();
    Digest::from_bytes(&digest)
}

pub fn parse_json(bytes: &[u8], limits: ParseLimits) -> Result<Value> {
    validate_number_lexemes(bytes)?;
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValueSeed { depth: 1, limits }
        .deserialize(&mut deserializer)
        .map_err(classify_parse_error)?;
    deserializer.end().map_err(classify_parse_error)?;
    Ok(value)
}

fn write_value(value: &Value, output: &mut Vec<u8>) -> Result<()> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        Value::String(value) => write_string(value, output),
        Value::Number(value) => write_number(value, output)?,
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_value(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            let mut entries: Vec<(&String, &Value)> = values.iter().collect();
            entries.sort_by(|left, right| utf16_key_cmp(left.0, right.0));
            output.push(b'{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_string(key, output);
                output.push(b':');
                write_value(value, output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn write_number(value: &Number, output: &mut Vec<u8>) -> Result<()> {
    if let Some(value) = value.as_f64()
        && value == 0.0
        && value.is_sign_negative()
    {
        output.push(b'0');
        return Ok(());
    }
    if let Some(value) = value.as_i64() {
        if value.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        output.extend_from_slice(value.to_string().as_bytes());
        return Ok(());
    }
    if let Some(value) = value.as_u64() {
        if value > MAX_SAFE_INTEGER {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        output.extend_from_slice(value.to_string().as_bytes());
        return Ok(());
    }
    Err(BrokerError::new(ErrorCode::InvalidField))
}

fn write_string(value: &str, output: &mut Vec<u8>) {
    output.push(b'"');
    for character in value.chars() {
        match character {
            '"' => output.extend_from_slice(b"\\\""),
            '\\' => output.extend_from_slice(b"\\\\"),
            '\u{0008}' => output.extend_from_slice(b"\\b"),
            '\u{000c}' => output.extend_from_slice(b"\\f"),
            '\n' => output.extend_from_slice(b"\\n"),
            '\r' => output.extend_from_slice(b"\\r"),
            '\t' => output.extend_from_slice(b"\\t"),
            '\u{0000}'..='\u{001f}' => write_unicode_escape(character as u32, output),
            _ => {
                let mut buffer = [0_u8; 4];
                output.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
            }
        }
    }
    output.push(b'"');
}

fn write_unicode_escape(value: u32, output: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.extend_from_slice(b"\\u");
    output.push(HEX[((value >> 12) & 0x0f) as usize]);
    output.push(HEX[((value >> 8) & 0x0f) as usize]);
    output.push(HEX[((value >> 4) & 0x0f) as usize]);
    output.push(HEX[(value & 0x0f) as usize]);
}

fn utf16_key_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn classify_parse_error(error: serde_json::Error) -> BrokerError {
    let message = error.to_string();
    if message.contains("BROKER_LIMIT_VIOLATION") {
        BrokerError::new(ErrorCode::LimitViolation)
    } else if message.contains("BROKER_INVALID_FIELD") {
        BrokerError::new(ErrorCode::InvalidField)
    } else {
        BrokerError::new(ErrorCode::MalformedRequest)
    }
}

fn validate_number_lexemes(bytes: &[u8]) -> Result<()> {
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = true;
            index += 1;
            continue;
        }
        if byte == b'-' || byte.is_ascii_digit() {
            let start = index;
            index += 1;
            while index < bytes.len()
                && !matches!(
                    bytes[index],
                    b',' | b']' | b'}' | b' ' | b'\t' | b'\r' | b'\n'
                )
            {
                index += 1;
            }
            let token = &bytes[start..index];
            if token.iter().any(|byte| matches!(*byte, b'.' | b'e' | b'E')) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            let digits = token.strip_prefix(b"-").unwrap_or(token);
            if !digits.is_empty() && digits.iter().all(|digit| digit.is_ascii_digit()) {
                let mut magnitude = 0_u64;
                for digit in digits {
                    magnitude = magnitude
                        .checked_mul(10)
                        .and_then(|value| value.checked_add(u64::from(*digit - b'0')))
                        .ok_or_else(|| BrokerError::new(ErrorCode::InvalidField))?;
                }
                if magnitude > MAX_SAFE_INTEGER {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
            }
            continue;
        }
        index += 1;
    }
    Ok(())
}

struct StrictValueSeed {
    depth: usize,
    limits: ParseLimits,
}

impl<'de> DeserializeSeed<'de> for StrictValueSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> core::result::Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictValueVisitor {
            depth: self.depth,
            limits: self.limits,
        })
    }
}

struct StrictValueVisitor {
    depth: usize,
    limits: ParseLimits,
}

impl<'de> Visitor<'de> for StrictValueVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a strict JSON value")
    }

    fn visit_unit<E>(self) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Null)
    }

    fn visit_bool<E>(self, value: bool) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err(E::custom("BROKER_INVALID_FIELD unsafe integer"));
        }
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_u64<E>(self, value: u64) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value > MAX_SAFE_INTEGER {
            return Err(E::custom("BROKER_INVALID_FIELD unsafe integer"));
        }
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_f64<E>(self, value: f64) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value == 0.0 && value.is_sign_negative() {
            return Number::from_f64(value)
                .map(Value::Number)
                .ok_or_else(|| E::custom("BROKER_INVALID_FIELD floating-point number"));
        }
        Err(E::custom(
            "BROKER_INVALID_FIELD floating-point or exponent number",
        ))
    }

    fn visit_str<E>(self, value: &str) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string_value(value.to_owned())
    }

    fn visit_string<E>(self, value: String) -> core::result::Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string_value(value)
    }

    fn visit_seq<A>(self, mut access: A) -> core::result::Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        self.check_depth()?;
        let mut values = Vec::new();
        while let Some(value) = access.next_element_seed(StrictValueSeed {
            depth: self.depth + 1,
            limits: self.limits,
        })? {
            if values.len() >= self.limits.max_array_items {
                return Err(de::Error::custom("BROKER_LIMIT_VIOLATION array items"));
            }
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut access: A) -> core::result::Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        self.check_depth()?;
        let mut values = Map::new();
        while let Some(key) = access.next_key::<String>()? {
            if values.len() >= self.limits.max_object_keys {
                return Err(de::Error::custom("BROKER_LIMIT_VIOLATION object keys"));
            }
            if key.len() > self.limits.max_string_bytes {
                return Err(de::Error::custom("BROKER_LIMIT_VIOLATION string bytes"));
            }
            if values.contains_key(&key) {
                return Err(de::Error::custom(
                    "BROKER_INVALID_FIELD duplicate object key",
                ));
            }
            let value = access.next_value_seed(StrictValueSeed {
                depth: self.depth + 1,
                limits: self.limits,
            })?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

impl StrictValueVisitor {
    fn check_depth<E>(&self) -> core::result::Result<(), E>
    where
        E: de::Error,
    {
        if self.depth > self.limits.max_depth {
            Err(E::custom("BROKER_LIMIT_VIOLATION nesting depth"))
        } else {
            Ok(())
        }
    }

    fn visit_string_value<E>(self, value: String) -> core::result::Result<Value, E>
    where
        E: de::Error,
    {
        if value.len() > self.limits.max_string_bytes {
            return Err(E::custom("BROKER_LIMIT_VIOLATION string bytes"));
        }
        Ok(Value::String(value))
    }
}

pub(crate) fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(crate) fn encode_hex(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(crate) fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut output = Vec::with_capacity(value.len() / 2);
    let bytes = value.as_bytes();
    for pair in bytes.as_chunks::<2>().0 {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        output.push((high << 4) | low);
    }
    Some(output)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
