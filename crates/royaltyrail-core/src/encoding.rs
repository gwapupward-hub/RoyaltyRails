use sha2::{Digest, Sha256};

use crate::{
    validate_participants, CoreError, CoreResult, Participant, MAX_PARTICIPANTS,
    MIN_PARTICIPANTS,
};

pub const AGREEMENT_DOMAIN_V1: &str = "ROYALTYRAIL_AGREEMENT_V1";
pub const ALLOCATION_DOMAIN_V1: &str = "ROYALTYRAIL_ALLOCATION_V1";

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevenuePoolKind {
    MasterReceipts = 0,
    CompositionReceipts = 1,
    Custom = 2,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementBasis {
    OwnershipSplit = 0,
    RevenueParticipation = 1,
    PaymentDirection = 2,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllocationMode {
    DirectFunding = 0,
    Inbox = 1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgreementHashInputV1<'a> {
    pub deployment_id: [u8; 32],
    pub program_id: [u8; 32],
    pub revenue_pool: [u8; 32],
    pub version: u32,
    pub predecessor_version: u32,
    pub settlement_mint: [u8; 32],
    pub token_program: [u8; 32],
    pub pool_kind: RevenuePoolKind,
    pub settlement_basis: SettlementBasis,
    pub pool_metadata_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    pub participants: &'a [Participant],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocationCommitmentParticipantV1 {
    pub participant_authority: [u8; 32],
    pub allocation_amount: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllocationCommitmentInputV1<'a> {
    pub deployment_id: [u8; 32],
    pub agreement: [u8; 32],
    pub allocation_sequence: u64,
    pub mode: AllocationMode,
    pub gross_amount: u64,
    pub payment_reference: [u8; 32],
    pub allocations: &'a [AllocationCommitmentParticipantV1],
}

fn nonzero(value: &[u8; 32]) -> CoreResult<()> {
    if *value == [0u8; 32] {
        return Err(CoreError::ZeroBytes32);
    }
    Ok(())
}

fn hash(preimage: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(preimage);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub fn agreement_preimage_v1(input: &AgreementHashInputV1<'_>) -> CoreResult<Vec<u8>> {
    validate_participants(input.participants)?;

    if input.version == 0 || input.predecessor_version >= input.version {
        return Err(CoreError::InvalidVersion);
    }

    nonzero(&input.deployment_id)?;
    nonzero(&input.program_id)?;
    nonzero(&input.revenue_pool)?;
    nonzero(&input.settlement_mint)?;
    nonzero(&input.token_program)?;

    let mut out = Vec::with_capacity(
        AGREEMENT_DOMAIN_V1.len() + 32 * 7 + 4 + 4 + 1 + 1 + 1
            + input.participants.len() * 36,
    );

    out.extend_from_slice(AGREEMENT_DOMAIN_V1.as_bytes());
    out.extend_from_slice(&input.deployment_id);
    out.extend_from_slice(&input.program_id);
    out.extend_from_slice(&input.revenue_pool);
    out.extend_from_slice(&input.version.to_le_bytes());
    out.extend_from_slice(&input.predecessor_version.to_le_bytes());
    out.extend_from_slice(&input.settlement_mint);
    out.extend_from_slice(&input.token_program);
    out.push(input.pool_kind as u8);
    out.push(input.settlement_basis as u8);
    out.extend_from_slice(&input.pool_metadata_hash);
    out.extend_from_slice(&input.terms_hash);
    out.push(u8::try_from(input.participants.len()).map_err(|_| CoreError::ParticipantCount)?);

    for participant in input.participants {
        out.extend_from_slice(&participant.authority);
        out.extend_from_slice(&participant.share_units.to_le_bytes());
    }

    Ok(out)
}

pub fn agreement_hash_v1(input: &AgreementHashInputV1<'_>) -> CoreResult<[u8; 32]> {
    Ok(hash(&agreement_preimage_v1(input)?))
}

pub fn allocation_preimage_v1(
    input: &AllocationCommitmentInputV1<'_>,
) -> CoreResult<Vec<u8>> {
    if input.allocation_sequence == 0 {
        return Err(CoreError::InvalidAllocationSequence);
    }
    if input.gross_amount == 0 {
        return Err(CoreError::InvalidGrossAmount);
    }

    nonzero(&input.deployment_id)?;
    nonzero(&input.agreement)?;

    if input.allocations.len() < MIN_PARTICIPANTS
        || input.allocations.len() > MAX_PARTICIPANTS
    {
        return Err(CoreError::ParticipantCount);
    }

    let mut previous: Option<[u8; 32]> = None;
    let mut total = 0u128;

    for allocation in input.allocations {
        nonzero(&allocation.participant_authority)?;
        if let Some(previous_authority) = previous {
            if previous_authority >= allocation.participant_authority {
                return Err(CoreError::NonCanonicalAuthorityOrder);
            }
        }
        previous = Some(allocation.participant_authority);

        total = total
            .checked_add(u128::from(allocation.allocation_amount))
            .ok_or(CoreError::ArithmeticOverflow)?;
    }

    if total != u128::from(input.gross_amount) {
        return Err(CoreError::ConservationFailure);
    }

    let mut out = Vec::with_capacity(
        ALLOCATION_DOMAIN_V1.len() + 32 + 32 + 8 + 1 + 8 + 32 + 1
            + input.allocations.len() * 40,
    );

    out.extend_from_slice(ALLOCATION_DOMAIN_V1.as_bytes());
    out.extend_from_slice(&input.deployment_id);
    out.extend_from_slice(&input.agreement);
    out.extend_from_slice(&input.allocation_sequence.to_le_bytes());
    out.push(input.mode as u8);
    out.extend_from_slice(&input.gross_amount.to_le_bytes());
    out.extend_from_slice(&input.payment_reference);
    out.push(u8::try_from(input.allocations.len()).map_err(|_| CoreError::ParticipantCount)?);

    for allocation in input.allocations {
        out.extend_from_slice(&allocation.participant_authority);
        out.extend_from_slice(&allocation.allocation_amount.to_le_bytes());
    }

    Ok(out)
}

pub fn allocation_commitment_v1(
    input: &AllocationCommitmentInputV1<'_>,
) -> CoreResult<[u8; 32]> {
    Ok(hash(&allocation_preimage_v1(input)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repeated(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn hex(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            use core::fmt::Write as _;
            write!(&mut out, "{byte:02x}").expect("write to string");
        }
        out
    }

    #[test]
    fn agreement_hash_matches_typescript_vector() {
        let participants = [
            Participant {
                authority: repeated(0x10),
                share_units: 70_000_000,
            },
            Participant {
                authority: repeated(0x11),
                share_units: 30_000_000,
            },
        ];
        let input = AgreementHashInputV1 {
            deployment_id: repeated(0x0a),
            program_id: repeated(0x01),
            revenue_pool: repeated(0x02),
            version: 1,
            predecessor_version: 0,
            settlement_mint: repeated(0x03),
            token_program: repeated(0x04),
            pool_kind: RevenuePoolKind::MasterReceipts,
            settlement_basis: SettlementBasis::RevenueParticipation,
            pool_metadata_hash: repeated(0x05),
            terms_hash: repeated(0x06),
            participants: &participants,
        };

        assert_eq!(
            hex(&agreement_hash_v1(&input).expect("agreement hash")),
            "7c3864a1ad4ed61713d694523cd2737bc69ad81bd1428c72f5bd3dcba76b2032"
        );
    }

    #[test]
    fn allocation_commitment_matches_typescript_vector() {
        let allocations = [
            AllocationCommitmentParticipantV1 {
                participant_authority: repeated(0x10),
                allocation_amount: 700_001,
            },
            AllocationCommitmentParticipantV1 {
                participant_authority: repeated(0x11),
                allocation_amount: 300_000,
            },
        ];
        let input = AllocationCommitmentInputV1 {
            deployment_id: repeated(0x0a),
            agreement: repeated(0x33),
            allocation_sequence: 7,
            mode: AllocationMode::DirectFunding,
            gross_amount: 1_000_001,
            payment_reference: repeated(0x44),
            allocations: &allocations,
        };

        assert_eq!(
            hex(&allocation_commitment_v1(&input).expect("allocation hash")),
            "bbbb4c0ef0d9617c5427d85cf9828d5767689a59bd696324adde3e03d9316950"
        );
    }
}
