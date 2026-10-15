#![forbid(unsafe_code)]

mod accounting;
mod encoding;

pub use accounting::{
    allocate, proportional_entitlement_parts, rounding_residual, validate_participants,
    validate_state, AllocationResult, CoreError, CoreResult, CumulativeState, Participant,
};
pub use encoding::{
    agreement_hash_v1, agreement_preimage_v1, allocation_commitment_v1,
    allocation_preimage_v1, AgreementHashInputV1, AllocationCommitmentInputV1,
    AllocationCommitmentParticipantV1, AllocationMode, RevenuePoolKind, SettlementBasis,
    AGREEMENT_DOMAIN_V1, ALLOCATION_DOMAIN_V1,
};

pub const TOTAL_SHARE_UNITS: u32 = 100_000_000;
pub const MIN_PARTICIPANTS: usize = 1;
pub const MAX_PARTICIPANTS: usize = 16;
