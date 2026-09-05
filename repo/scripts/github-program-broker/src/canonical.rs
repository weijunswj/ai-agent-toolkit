use core::cmp::Ordering;
use core::fmt;
use core::str;

use serde::de::{self, Deserializer, Visitor};
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JsonNumber {
    Integer { negative: bool, magnitude: u64 },
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct JsonString(Vec<u16>);

impl JsonString {
    pub fn from_text(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }

    pub fn to_string(&self) -> Result<String> {
        String::from_utf16(&self.0).map_err(|_| BrokerError::new(ErrorCode::InvalidField))
    }

    fn utf8_len(&self) -> usize {
        let mut total = 0;
        let mut index = 0;
        while index < self.0.len() {
            let unit = self.0[index];
            if is_high_surrogate(unit)
                && self.0.get(index + 1).copied().is_some_and(is_low_surrogate)
            {
                let codepoint = 0x1_0000
                    + (u32::from(unit - 0xd800) << 10)
                    + u32::from(self.0[index + 1] - 0xdc00);
                total += char::from_u32(codepoint).map_or(3, char::len_utf8);
                index += 2;
            } else if is_surrogate(unit) {
                total += 3;
                index += 1;
            } else {
                total += char::from_u32(u32::from(unit)).map_or(3, char::len_utf8);
                index += 1;
            }
        }
        total
    }
}

impl Ord for JsonString {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

impl PartialOrd for JsonString {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(JsonNumber),
    String(JsonString),
    Array(Vec<JsonValue>),
    Object(Vec<(JsonString, JsonValue)>),
}

impl JsonValue {
    pub fn as_object(&self) -> Option<&[(JsonString, JsonValue)]> {
        match self {
            Self::Object(entries) => Some(entries),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Self> {
        self.as_object()?.iter().find_map(|(name, value)| {
            (name.to_string().ok().as_deref() == Some(key)).then_some(value)
        })
    }

    pub fn from_serde(value: &Value) -> Result<Self> {
        match value {
            Value::Null => Ok(Self::Null),
            Value::Bool(value) => Ok(Self::Bool(*value)),
            Value::Number(value) => number_from_serde(value),
            Value::String(value) => Ok(Self::String(JsonString::from_text(value))),
            Value::Array(values) => values
                .iter()
                .map(Self::from_serde)
                .collect::<Result<Vec<_>>>()
                .map(Self::Array),
            Value::Object(values) => values
                .iter()
                .map(|(key, value)| Ok((JsonString::from_text(key), Self::from_serde(value)?)))
                .collect::<Result<Vec<_>>>()
                .map(Self::Object),
        }
    }

    pub fn to_serde(&self) -> Result<Value> {
        match self {
            Self::Null => Ok(Value::Null),
            Self::Bool(value) => Ok(Value::Bool(*value)),
            Self::Number(JsonNumber::Integer {
                negative,
                magnitude,
            }) => {
                if *magnitude > MAX_SAFE_INTEGER {
                    return Err(BrokerError::new(ErrorCode::InvalidField));
                }
                if *negative && *magnitude > 0 {
                    let value = i64::try_from(*magnitude)
                        .map_err(|_| BrokerError::new(ErrorCode::InvalidField))?;
                    Ok(Value::Number(Number::from(-value)))
                } else {
                    Ok(Value::Number(Number::from(*magnitude)))
                }
            }
            Self::String(value) => Ok(Value::String(value.to_string()?)),
            Self::Array(values) => values
                .iter()
                .map(Self::to_serde)
                .collect::<Result<Vec<_>>>()
                .map(Value::Array),
            Self::Object(entries) => {
                let mut object = Map::new();
                for (key, value) in entries {
                    object.insert(key.to_string()?, value.to_serde()?);
                }
                Ok(Value::Object(object))
            }
        }
    }
}

pub trait CanonicalJson {
    fn write_canonical(&self, output: &mut Vec<u8>) -> Result<()>;
}

impl CanonicalJson for JsonValue {
    fn write_canonical(&self, output: &mut Vec<u8>) -> Result<()> {
        write_value(self, output)
    }
}

impl CanonicalJson for Value {
    fn write_canonical(&self, output: &mut Vec<u8>) -> Result<()> {
        JsonValue::from_serde(self)?.write_canonical(output)
    }
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

    pub fn from_bytes(value: [u8; 32]) -> Self {
        Self(encode_hex(&value))
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

pub fn canonical_serialize<T: CanonicalJson + ?Sized>(value: &T) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    value.write_canonical(&mut output)?;
    Ok(output)
}

pub fn canonical_serialize_value<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let value =
        serde_json::to_value(value).map_err(|_| BrokerError::new(ErrorCode::InternalInvariant))?;
    canonical_serialize(&value)
}

pub fn canonical_digest<T: CanonicalJson + ?Sized>(value: &T) -> Result<Digest> {
    Ok(digest_bytes(&canonical_serialize(value)?))
}

pub fn canonical_digest_value<T: Serialize>(value: &T) -> Result<Digest> {
    Ok(digest_bytes(&canonical_serialize_value(value)?))
}

pub fn digest_bytes(value: &[u8]) -> Digest {
    let mut hasher = Sha256::new();
    hasher.update(value);
    Digest::from_bytes(hasher.finalize().into())
}

pub fn parse_json(bytes: &[u8], limits: ParseLimits) -> Result<JsonValue> {
    JsonParser::new(bytes, limits).parse()
}

fn number_from_serde(value: &Number) -> Result<JsonValue> {
    if let Some(value) = value.as_i64() {
        if value < 0 {
            let magnitude = value.unsigned_abs();
            if magnitude > MAX_SAFE_INTEGER {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            return Ok(JsonValue::Number(JsonNumber::Integer {
                negative: true,
                magnitude,
            }));
        }
        return Ok(JsonValue::Number(JsonNumber::Integer {
            negative: false,
            magnitude: value as u64,
        }));
    }
    if let Some(value) = value.as_u64() {
        return if value <= MAX_SAFE_INTEGER {
            Ok(JsonValue::Number(JsonNumber::Integer {
                negative: false,
                magnitude: value,
            }))
        } else {
            Err(BrokerError::new(ErrorCode::InvalidField))
        };
    }
    if value
        .as_f64()
        .is_some_and(|number| number == 0.0 && number.is_sign_negative())
    {
        return Ok(JsonValue::Number(JsonNumber::Integer {
            negative: true,
            magnitude: 0,
        }));
    }
    Err(BrokerError::new(ErrorCode::InvalidField))
}

fn write_value(value: &JsonValue, output: &mut Vec<u8>) -> Result<()> {
    match value {
        JsonValue::Null => output.extend_from_slice(b"null"),
        JsonValue::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        JsonValue::String(value) => write_string(&value.0, output),
        JsonValue::Number(JsonNumber::Integer {
            negative,
            magnitude,
        }) => {
            if *magnitude > MAX_SAFE_INTEGER {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            if *negative && *magnitude != 0 {
                output.push(b'-');
            }
            output.extend_from_slice(magnitude.to_string().as_bytes());
        }
        JsonValue::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_value(value, output)?;
            }
            output.push(b']');
        }
        JsonValue::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            output.push(b'{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_string(&key.0, output);
                output.push(b':');
                write_value(value, output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn write_string(value: &[u16], output: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.push(b'"');
    let mut index = 0;
    while index < value.len() {
        let unit = value[index];
        match unit {
            0x22 => output.extend_from_slice(b"\\\""),
            0x5c => output.extend_from_slice(b"\\\\"),
            0x08 => output.extend_from_slice(b"\\b"),
            0x0c => output.extend_from_slice(b"\\f"),
            0x0a => output.extend_from_slice(b"\\n"),
            0x0d => output.extend_from_slice(b"\\r"),
            0x09 => output.extend_from_slice(b"\\t"),
            0x00..=0x1f => write_unicode_escape(unit, output, HEX),
            high if is_high_surrogate(high)
                && value.get(index + 1).copied().is_some_and(is_low_surrogate) =>
            {
                let low = value[index + 1];
                let codepoint =
                    0x1_0000 + (u32::from(high - 0xd800) << 10) + u32::from(low - 0xdc00);
                if let Some(scalar) = char::from_u32(codepoint) {
                    let mut buffer = [0_u8; 4];
                    output.extend_from_slice(scalar.encode_utf8(&mut buffer).as_bytes());
                } else {
                    write_unicode_escape(high, output, HEX);
                    write_unicode_escape(low, output, HEX);
                }
                index += 1;
            }
            surrogate if is_surrogate(surrogate) => write_unicode_escape(surrogate, output, HEX),
            scalar => {
                if let Some(character) = char::from_u32(u32::from(scalar)) {
                    let mut buffer = [0_u8; 4];
                    output.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
                }
            }
        }
        index += 1;
    }
    output.push(b'"');
}

fn write_unicode_escape(value: u16, output: &mut Vec<u8>, hex: &[u8; 16]) {
    output.extend_from_slice(b"\\u");
    output.push(hex[((value >> 12) & 0x0f) as usize]);
    output.push(hex[((value >> 8) & 0x0f) as usize]);
    output.push(hex[((value >> 4) & 0x0f) as usize]);
    output.push(hex[(value & 0x0f) as usize]);
}

fn is_high_surrogate(value: u16) -> bool {
    (0xd800..=0xdbff).contains(&value)
}

fn is_low_surrogate(value: u16) -> bool {
    (0xdc00..=0xdfff).contains(&value)
}

fn is_surrogate(value: u16) -> bool {
    is_high_surrogate(value) || is_low_surrogate(value)
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    index: usize,
    limits: ParseLimits,
}

impl<'a> JsonParser<'a> {
    fn new(bytes: &'a [u8], limits: ParseLimits) -> Self {
        Self {
            bytes,
            index: 0,
            limits,
        }
    }

    fn parse(mut self) -> Result<JsonValue> {
        str::from_utf8(self.bytes).map_err(|_| BrokerError::new(ErrorCode::MalformedRequest))?;
        let value = self.parse_value(1)?;
        self.skip_whitespace();
        if self.index != self.bytes.len() {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        Ok(value)
    }

    fn parse_value(&mut self, depth: usize) -> Result<JsonValue> {
        self.skip_whitespace();
        match self.bytes.get(self.index).copied() {
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(JsonValue::Null)
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(JsonValue::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(JsonValue::Bool(false))
            }
            Some(b'"') => self.parse_string().map(JsonValue::String),
            Some(b'[') => self.parse_array(depth),
            Some(b'{') => self.parse_object(depth),
            Some(b'-') | Some(b'0'..=b'9') => self.parse_number(),
            _ => Err(BrokerError::new(ErrorCode::MalformedRequest)),
        }
    }

    fn parse_array(&mut self, depth: usize) -> Result<JsonValue> {
        self.check_depth(depth)?;
        self.index += 1;
        self.skip_whitespace();
        let mut values = Vec::new();
        if self.consume_if(b']') {
            return Ok(JsonValue::Array(values));
        }
        loop {
            if values.len() >= self.limits.max_array_items {
                return Err(BrokerError::new(ErrorCode::LimitViolation));
            }
            values.push(self.parse_value(depth + 1)?);
            self.skip_whitespace();
            if self.consume_if(b']') {
                return Ok(JsonValue::Array(values));
            }
            if !self.consume_if(b',') {
                return Err(BrokerError::new(ErrorCode::MalformedRequest));
            }
            self.skip_whitespace();
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<JsonValue> {
        self.check_depth(depth)?;
        self.index += 1;
        self.skip_whitespace();
        let mut values = Vec::new();
        if self.consume_if(b'}') {
            return Ok(JsonValue::Object(values));
        }
        loop {
            if values.len() >= self.limits.max_object_keys {
                return Err(BrokerError::new(ErrorCode::LimitViolation));
            }
            if self.bytes.get(self.index) != Some(&b'"') {
                return Err(BrokerError::new(ErrorCode::MalformedRequest));
            }
            let key = self.parse_string()?;
            if values.iter().any(|(existing, _)| existing == &key) {
                return Err(BrokerError::new(ErrorCode::InvalidField));
            }
            self.skip_whitespace();
            if !self.consume_if(b':') {
                return Err(BrokerError::new(ErrorCode::MalformedRequest));
            }
            let value = self.parse_value(depth + 1)?;
            values.push((key, value));
            self.skip_whitespace();
            if self.consume_if(b'}') {
                return Ok(JsonValue::Object(values));
            }
            if !self.consume_if(b',') {
                return Err(BrokerError::new(ErrorCode::MalformedRequest));
            }
            self.skip_whitespace();
        }
    }

    fn parse_string(&mut self) -> Result<JsonString> {
        if !self.consume_if(b'"') {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        let mut units = Vec::new();
        loop {
            let byte = self
                .bytes
                .get(self.index)
                .copied()
                .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
            match byte {
                b'"' => {
                    self.index += 1;
                    let value = JsonString(units);
                    if value.utf8_len() > self.limits.max_string_bytes {
                        return Err(BrokerError::new(ErrorCode::LimitViolation));
                    }
                    return Ok(value);
                }
                b'\\' => {
                    self.index += 1;
                    self.parse_escape(&mut units)?;
                }
                0x00..=0x1f => return Err(BrokerError::new(ErrorCode::MalformedRequest)),
                _ => {
                    let start = self.index;
                    while let Some(next) = self.bytes.get(self.index).copied() {
                        if next == b'"' || next == b'\\' || next <= 0x1f {
                            break;
                        }
                        self.index += 1;
                    }
                    let text = str::from_utf8(&self.bytes[start..self.index])
                        .map_err(|_| BrokerError::new(ErrorCode::MalformedRequest))?;
                    units.extend(text.encode_utf16());
                }
            }
        }
    }

    fn parse_escape(&mut self, units: &mut Vec<u16>) -> Result<()> {
        let escape = self
            .bytes
            .get(self.index)
            .copied()
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        self.index += 1;
        match escape {
            b'"' => units.push(0x22),
            b'\\' => units.push(0x5c),
            b'/' => units.push(0x2f),
            b'b' => units.push(0x08),
            b'f' => units.push(0x0c),
            b'n' => units.push(0x0a),
            b'r' => units.push(0x0d),
            b't' => units.push(0x09),
            b'u' => {
                let high = self.parse_hex_u16()?;
                let saved = self.index;
                if is_high_surrogate(high)
                    && self.bytes.get(self.index) == Some(&b'\\')
                    && self.bytes.get(self.index + 1) == Some(&b'u')
                {
                    self.index += 2;
                    let low = self.parse_hex_u16()?;
                    if is_low_surrogate(low) {
                        units.extend([high, low]);
                    } else {
                        self.index = saved;
                        units.push(high);
                    }
                } else {
                    units.push(high);
                }
            }
            _ => return Err(BrokerError::new(ErrorCode::MalformedRequest)),
        }
        Ok(())
    }

    fn parse_hex_u16(&mut self) -> Result<u16> {
        let end = self
            .index
            .checked_add(4)
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        let bytes = self
            .bytes
            .get(self.index..end)
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        self.index = end;
        let mut value = 0_u16;
        for byte in bytes {
            value = value
                .checked_mul(16)
                .and_then(|current| hex_value(*byte).map(|digit| current + u16::from(digit)))
                .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        }
        Ok(value)
    }

    fn parse_number(&mut self) -> Result<JsonValue> {
        let start = self.index;
        let negative = self.consume_if(b'-');
        let first = self
            .bytes
            .get(self.index)
            .copied()
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        if first == b'0' {
            self.index += 1;
            if self
                .bytes
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                return Err(BrokerError::new(ErrorCode::MalformedRequest));
            }
        } else if matches!(first, b'1'..=b'9') {
            self.index += 1;
            while self
                .bytes
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
        } else {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        if self
            .bytes
            .get(self.index)
            .is_some_and(|byte| matches!(byte, b'.' | b'e' | b'E'))
        {
            return Err(BrokerError::new(ErrorCode::InvalidField));
        }
        if self
            .bytes
            .get(self.index)
            .is_some_and(|byte| !matches!(byte, b',' | b']' | b'}' | b' ' | b'\t' | b'\r' | b'\n'))
        {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        let digits = if negative {
            &self.bytes[start + 1..self.index]
        } else {
            &self.bytes[start..self.index]
        };
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
        Ok(JsonValue::Number(JsonNumber::Integer {
            negative,
            magnitude,
        }))
    }

    fn literal(&mut self, value: &[u8]) -> Result<()> {
        let end = self
            .index
            .checked_add(value.len())
            .ok_or_else(|| BrokerError::new(ErrorCode::MalformedRequest))?;
        if self.bytes.get(self.index..end) != Some(value) {
            return Err(BrokerError::new(ErrorCode::MalformedRequest));
        }
        self.index = end;
        Ok(())
    }

    fn check_depth(&self, depth: usize) -> Result<()> {
        if depth > self.limits.max_depth {
            Err(BrokerError::new(ErrorCode::LimitViolation))
        } else {
            Ok(())
        }
    }

    fn skip_whitespace(&mut self) {
        while self
            .bytes
            .get(self.index)
            .is_some_and(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n'))
        {
            self.index += 1;
        }
    }

    fn consume_if(&mut self, expected: u8) -> bool {
        if self.bytes.get(self.index) == Some(&expected) {
            self.index += 1;
            true
        } else {
            false
        }
    }
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
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
    for pair in value.as_bytes().as_chunks::<2>().0 {
        let high = hex_value(pair[0])?;
        let low = hex_value(pair[1])?;
        output.push((high << 4) | low);
    }
    Some(output)
}
