use core::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    MalformedFrame,
    MalformedRequest,
    UnsupportedSchema,
    UnsupportedOperation,
    InvalidField,
    LimitViolation,
    RequestConflict,
    Busy,
    StaleExpectedState,
    UnverifiableIdentity,
    UnsupportedPlatform,
    InternalInvariant,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MalformedFrame => "BROKER_MALFORMED_FRAME",
            Self::MalformedRequest => "BROKER_MALFORMED_REQUEST",
            Self::UnsupportedSchema => "BROKER_UNSUPPORTED_SCHEMA",
            Self::UnsupportedOperation => "BROKER_UNSUPPORTED_OPERATION",
            Self::InvalidField => "BROKER_INVALID_FIELD",
            Self::LimitViolation => "BROKER_LIMIT_VIOLATION",
            Self::RequestConflict => "BROKER_REQUEST_CONFLICT",
            Self::Busy => "BROKER_BUSY",
            Self::StaleExpectedState => "BROKER_STALE_EXPECTED_STATE",
            Self::UnverifiableIdentity => "BROKER_UNVERIFIABLE_IDENTITY",
            Self::UnsupportedPlatform => "BROKER_UNSUPPORTED_PLATFORM",
            Self::InternalInvariant => "BROKER_INTERNAL_INVARIANT",
        }
    }

    pub fn is_known(value: &str) -> bool {
        matches!(
            value,
            "BROKER_MALFORMED_FRAME"
                | "BROKER_MALFORMED_REQUEST"
                | "BROKER_UNSUPPORTED_SCHEMA"
                | "BROKER_UNSUPPORTED_OPERATION"
                | "BROKER_INVALID_FIELD"
                | "BROKER_LIMIT_VIOLATION"
                | "BROKER_REQUEST_CONFLICT"
                | "BROKER_BUSY"
                | "BROKER_STALE_EXPECTED_STATE"
                | "BROKER_UNVERIFIABLE_IDENTITY"
                | "BROKER_UNSUPPORTED_PLATFORM"
                | "BROKER_INTERNAL_INVARIANT"
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerError {
    code: ErrorCode,
}

impl BrokerError {
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }

    pub const fn code(&self) -> ErrorCode {
        self.code
    }

    pub const fn as_str(&self) -> &'static str {
        self.code.as_str()
    }
}

impl fmt::Display for BrokerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code.as_str())
    }
}

impl std::error::Error for BrokerError {}

pub type Result<T> = core::result::Result<T, BrokerError>;
