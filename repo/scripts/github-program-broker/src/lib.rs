#![forbid(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]

pub mod canonical;
pub mod crypto;
pub mod error;
pub mod protocol;

pub use canonical::{Digest, ParseLimits, canonical_digest, canonical_serialize, parse_json};
pub use error::{BrokerError, ErrorCode, Result};
pub use protocol::{PROTOCOL_ID, Request, RequestId, decode_request_frame, encode_request_frame};
