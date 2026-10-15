use crate::{MAX_PARTICIPANTS, MIN_PARTICIPANTS, TOTAL_SHARE_UNITS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Participant {
    pub authority: [u8; 32],
    pub share_units: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CumulativeState {
    pub gross: u128,
    pub allocated: Vec<u128>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllocationResult {
    pub allocations: Vec<u64>,
    pub next_state: CumulativeState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    ParticipantCount,
    ZeroAuthority,
    NonCanonicalAuthorityOrder,
    InvalidShare,
    InvalidShareTotal,
    InvalidVersion,
    InvalidAllocationSequence,
    InvalidGrossAmount,
    ZeroBytes32,
    StateLength,
    AllocationAmountZero,
    ArithmeticOverflow,
    ResidualOutOfBounds,
    ConservationFailure,
    RoundingRecipientBounds,
    InvalidRoundingCandidate,
}

pub type CoreResult<T> = Result<T, CoreError>;

pub fn validate_participants(participants: &[Participant]) -> CoreResult<()> {
    if !(MIN_PARTICIPANTS..=MAX_PARTICIPANTS).contains(&participants.len()) {
        return Err(CoreError::ParticipantCount);
    }

    let mut total: u64 = 0;
    let mut previous: Option<[u8; 32]> = None;

    for participant in participants {
        if participant.authority == [0u8; 32] {
            return Err(CoreError::ZeroAuthority);
        }

        if let Some(previous_authority) = previous {
            if previous_authority >= participant.authority {
                return Err(CoreError::NonCanonicalAuthorityOrder);
            }
        }
        previous = Some(participant.authority);

        if participant.share_units == 0 || participant.share_units > TOTAL_SHARE_UNITS {
            return Err(CoreError::InvalidShare);
        }

        total = total
            .checked_add(u64::from(participant.share_units))
            .ok_or(CoreError::ArithmeticOverflow)?;
    }

    if total != u64::from(TOTAL_SHARE_UNITS) {
        return Err(CoreError::InvalidShareTotal);
    }

    Ok(())
}

/// Computes floor(gross * share / D) and its positive fractional numerator
/// without multiplying the full u128 cumulative gross by the share.
///
/// Let gross = qD + t, 0 <= t < D:
/// floor(gross*share/D) = q*share + floor(t*share/D).
pub fn proportional_entitlement_parts(gross: u128, share_units: u32) -> CoreResult<(u128, u128)> {
    if share_units == 0 || share_units > TOTAL_SHARE_UNITS {
        return Err(CoreError::InvalidShare);
    }

    let denominator = u128::from(TOTAL_SHARE_UNITS);
    let share = u128::from(share_units);
    let quotient = gross / denominator;
    let tail = gross % denominator;
    let tail_product = tail
        .checked_mul(share)
        .ok_or(CoreError::ArithmeticOverflow)?;

    let floor = quotient
        .checked_mul(share)
        .and_then(|value| value.checked_add(tail_product / denominator))
        .ok_or(CoreError::ArithmeticOverflow)?;
    let remainder = tail_product % denominator;

    Ok((floor, remainder))
}

/// Returns the signed proportional residual numerator in (-D, D).
///
/// A valid bounded-error state can only be at floor(exact entitlement) or
/// exactly one settlement-asset base unit above that floor.
pub fn rounding_residual(gross: u128, allocated: u128, share_units: u32) -> CoreResult<i128> {
    let (floor, remainder) = proportional_entitlement_parts(gross, share_units)?;
    let remainder = i128::try_from(remainder).map_err(|_| CoreError::ArithmeticOverflow)?;
    let denominator = i128::from(TOTAL_SHARE_UNITS);

    if allocated == floor {
        return Ok(remainder);
    }

    if floor < u128::MAX && allocated == floor + 1 {
        return Ok(remainder - denominator);
    }

    Err(CoreError::ResidualOutOfBounds)
}

pub fn validate_state(participants: &[Participant], state: &CumulativeState) -> CoreResult<()> {
    validate_participants(participants)?;

    if state.allocated.len() != participants.len() {
        return Err(CoreError::StateLength);
    }

    let mut total_allocated = 0u128;
    let mut residual_total = 0i128;

    for (participant, allocated) in participants.iter().zip(state.allocated.iter().copied()) {
        total_allocated = total_allocated
            .checked_add(allocated)
            .ok_or(CoreError::ArithmeticOverflow)?;

        residual_total = residual_total
            .checked_add(rounding_residual(
                state.gross,
                allocated,
                participant.share_units,
            )?)
            .ok_or(CoreError::ArithmeticOverflow)?;
    }

    if total_allocated != state.gross {
        return Err(CoreError::ConservationFailure);
    }

    if residual_total != 0 {
        return Err(CoreError::ResidualOutOfBounds);
    }

    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct ScoredAllocation {
    index: usize,
    prior_allocated: u128,
    base_allocation: u128,
    score: i128,
}

/// Deterministic bounded-error allocation parity target for the TypeScript
/// reference engine.
///
/// - `amount` is a positive SPL-token amount (`u64`);
/// - lifetime counters are `u128`;
/// - the cumulative residual uses the overflow-safe quotient/remainder form;
/// - tie breaks use canonical participant index, which is raw authority-byte order.
pub fn allocate(
    participants: &[Participant],
    state: &CumulativeState,
    amount: u64,
) -> CoreResult<AllocationResult> {
    validate_state(participants, state)?;

    if amount == 0 {
        return Err(CoreError::AllocationAmountZero);
    }

    let next_gross = state
        .gross
        .checked_add(u128::from(amount))
        .ok_or(CoreError::ArithmeticOverflow)?;

    let denominator = i128::from(TOTAL_SHARE_UNITS);
    let mut scored = Vec::with_capacity(participants.len());

    for (index, participant) in participants.iter().enumerate() {
        let prior_allocated = *state.allocated.get(index).ok_or(CoreError::StateLength)?;

        let residual_before =
            rounding_residual(state.gross, prior_allocated, participant.share_units)?;

        let current_numerator = i128::from(amount)
            .checked_mul(i128::from(participant.share_units))
            .ok_or(CoreError::ArithmeticOverflow)?;

        let accrued_numerator = residual_before
            .checked_add(current_numerator)
            .ok_or(CoreError::ArithmeticOverflow)?;

        let base_allocation = if accrued_numerator <= 0 {
            0
        } else {
            u128::try_from(accrued_numerator / denominator)
                .map_err(|_| CoreError::ArithmeticOverflow)?
        };

        let base_numerator = i128::try_from(base_allocation)
            .map_err(|_| CoreError::ArithmeticOverflow)?
            .checked_mul(denominator)
            .ok_or(CoreError::ArithmeticOverflow)?;

        let score = accrued_numerator
            .checked_sub(base_numerator)
            .ok_or(CoreError::ArithmeticOverflow)?;

        scored.push(ScoredAllocation {
            index,
            prior_allocated,
            base_allocation,
            score,
        });
    }

    let base_total = scored.iter().try_fold(0u128, |sum, entry| {
        sum.checked_add(entry.base_allocation)
            .ok_or(CoreError::ArithmeticOverflow)
    })?;

    let amount_u128 = u128::from(amount);
    if base_total > amount_u128 {
        return Err(CoreError::RoundingRecipientBounds);
    }

    let remaining = amount_u128 - base_total;
    if remaining > participants.len() as u128 {
        return Err(CoreError::RoundingRecipientBounds);
    }

    let mut ranked = scored.clone();
    ranked.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.index.cmp(&right.index))
    });

    let extra_count = usize::try_from(remaining).map_err(|_| CoreError::ArithmeticOverflow)?;
    let mut extra = vec![false; participants.len()];

    for entry in ranked.iter().take(extra_count) {
        if entry.score < 0 {
            return Err(CoreError::InvalidRoundingCandidate);
        }
        extra[entry.index] = true;
    }

    let mut allocations = Vec::with_capacity(participants.len());
    let mut next_allocated = Vec::with_capacity(participants.len());
    let mut allocation_total = 0u128;

    for entry in scored {
        let extra_unit = if extra[entry.index] { 1u128 } else { 0u128 };
        let allocation_u128 = entry
            .base_allocation
            .checked_add(extra_unit)
            .ok_or(CoreError::ArithmeticOverflow)?;

        let allocation =
            u64::try_from(allocation_u128).map_err(|_| CoreError::ArithmeticOverflow)?;

        allocation_total = allocation_total
            .checked_add(allocation_u128)
            .ok_or(CoreError::ArithmeticOverflow)?;

        allocations.push(allocation);
        next_allocated.push(
            entry
                .prior_allocated
                .checked_add(allocation_u128)
                .ok_or(CoreError::ArithmeticOverflow)?,
        );
    }

    if allocation_total != amount_u128 {
        return Err(CoreError::ConservationFailure);
    }

    let next_state = CumulativeState {
        gross: next_gross,
        allocated: next_allocated,
    };

    validate_state(participants, &next_state)?;

    Ok(AllocationResult {
        allocations,
        next_state,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use sha2::{Digest, Sha256};

    fn authority(index: u8) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[31] = index;
        out
    }

    fn hex(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            use core::fmt::Write as _;
            write!(&mut out, "{byte:02x}").expect("write to string");
        }
        out
    }

    fn vector_digest(
        shares: &[u32],
        initial_state: &CumulativeState,
        deposits: &[u64],
        digest_domain: &str,
    ) -> String {
        let participants: Vec<Participant> = shares
            .iter()
            .enumerate()
            .map(|(index, share_units)| Participant {
                authority: authority(u8::try_from(index + 1).expect("vector authority")),
                share_units: *share_units,
            })
            .collect();

        validate_state(&participants, initial_state).expect("valid initial vector state");

        let mut hasher = Sha256::new();
        hasher.update(digest_domain.as_bytes());
        hasher.update([u8::try_from(shares.len()).expect("participant count")]);
        hasher.update(initial_state.gross.to_le_bytes());
        for allocated in &initial_state.allocated {
            hasher.update(allocated.to_le_bytes());
        }

        let mut state = initial_state.clone();
        for deposit in deposits {
            let result = allocate(&participants, &state, *deposit).expect("vector allocation");
            hasher.update(deposit.to_le_bytes());
            for allocation in &result.allocations {
                hasher.update(allocation.to_le_bytes());
            }
            state = result.next_state;
        }

        validate_state(&participants, &state).expect("valid final vector state");
        hasher.update(state.gross.to_le_bytes());
        for allocated in &state.allocated {
            hasher.update(allocated.to_le_bytes());
        }

        hex(&hasher.finalize())
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VectorFile {
        schema_version: u32,
        total_share_units: u32,
        percentage_decimal_places: u32,
        authority_scheme: String,
        digest_domain: String,
        generated_corpus: GeneratedCorpus,
        named_vectors: Vec<NamedVector>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GeneratedCorpus {
        algorithm: String,
        seed: u32,
        count: usize,
        expected_corpus_digest: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NamedVector {
        name: String,
        shares: Vec<u32>,
        initial_gross: String,
        initial_allocated: Vec<String>,
        deposits: Vec<String>,
        expected_digest: String,
    }

    fn vector_file() -> VectorFile {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/royaltyrail-accounting/test-vectors/v1.json"
        )))
        .expect("parse canonical TypeScript vector file")
    }

    fn xorshift32(mut value: u32) -> u32 {
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        value
    }

    fn generated_case(mut state: u32) -> (u32, Vec<u32>, Vec<u64>) {
        state = xorshift32(state);
        let participant_count = 1 + usize::try_from(state % 16).expect("count");

        let shares = if participant_count == 1 {
            vec![TOTAL_SHARE_UNITS]
        } else {
            let mut weights = Vec::with_capacity(participant_count);
            for _ in 0..participant_count {
                state = xorshift32(state);
                weights.push(1 + (state % 1_000_000));
            }

            let distributable =
                u64::from(TOTAL_SHARE_UNITS) - u64::try_from(participant_count).expect("count");
            let total_weight: u64 = weights.iter().map(|weight| u64::from(*weight)).sum();

            let mut shares: Vec<u32> = weights
                .iter()
                .map(|weight| {
                    1 + u32::try_from(
                        distributable
                            .checked_mul(u64::from(*weight))
                            .expect("generated share product")
                            / total_weight,
                    )
                    .expect("generated share")
                })
                .collect();

            let mut remainder = u64::from(TOTAL_SHARE_UNITS)
                - shares.iter().map(|share| u64::from(*share)).sum::<u64>();

            let mut index = 0usize;
            while remainder > 0 {
                shares[index] = shares[index].checked_add(1).expect("share increment");
                remainder -= 1;
                index = (index + 1) % shares.len();
            }

            shares
        };

        state = xorshift32(state);
        let deposit_count = 1 + usize::try_from(state % 20).expect("deposit count");
        let mut deposits = Vec::with_capacity(deposit_count);

        for _ in 0..deposit_count {
            state = xorshift32(state);
            deposits.push(1 + u64::from(state % 1_000_000_000));
        }

        (state, shares, deposits)
    }

    #[test]
    fn validates_six_decimal_share_domain() {
        let participants = [
            Participant {
                authority: authority(1),
                share_units: 33_333_333,
            },
            Participant {
                authority: authority(2),
                share_units: 33_333_333,
            },
            Participant {
                authority: authority(3),
                share_units: 33_333_334,
            },
        ];
        assert_eq!(validate_participants(&participants), Ok(()));
    }

    #[test]
    fn rejects_noncanonical_authority_order() {
        let participants = [
            Participant {
                authority: authority(2),
                share_units: 50_000_000,
            },
            Participant {
                authority: authority(1),
                share_units: 50_000_000,
            },
        ];
        assert_eq!(
            validate_participants(&participants),
            Err(CoreError::NonCanonicalAuthorityOrder)
        );
    }

    #[test]
    fn near_u128_max_entitlement_does_not_require_wide_multiplication() {
        let gross = u128::MAX;
        let (floor, remainder) =
            proportional_entitlement_parts(gross, 50_000_000).expect("entitlement");
        assert_eq!(
            floor,
            170_141_183_460_469_231_731_687_303_715_884_105_727u128
        );
        assert_eq!(remainder, 50_000_000);
        assert_eq!(
            rounding_residual(gross, floor + 1, 50_000_000),
            Ok(-50_000_000)
        );
    }

    #[test]
    fn allocator_matches_micro_tie_behavior() {
        let participants = [
            Participant {
                authority: authority(1),
                share_units: 50_000_000,
            },
            Participant {
                authority: authority(2),
                share_units: 50_000_000,
            },
        ];
        let state = CumulativeState {
            gross: 0,
            allocated: vec![0, 0],
        };

        let first = allocate(&participants, &state, 1).expect("first");
        assert_eq!(first.allocations, vec![1, 0]);

        let second = allocate(&participants, &first.next_state, 1).expect("second");
        assert_eq!(second.allocations, vec![0, 1]);
    }

    #[test]
    fn matches_all_named_typescript_vectors() {
        let vectors = vector_file();
        assert_eq!(vectors.schema_version, 6);
        assert_eq!(vectors.total_share_units, TOTAL_SHARE_UNITS);
        assert_eq!(vectors.percentage_decimal_places, 6);
        assert_eq!(
            vectors.authority_scheme,
            "sequential-u256-big-endian-from-1"
        );

        for vector in vectors.named_vectors {
            let state = CumulativeState {
                gross: vector.initial_gross.parse().expect("gross"),
                allocated: vector
                    .initial_allocated
                    .iter()
                    .map(|value| value.parse().expect("allocation"))
                    .collect(),
            };
            let deposits: Vec<u64> = vector
                .deposits
                .iter()
                .map(|value| value.parse().expect("deposit"))
                .collect();

            assert_eq!(
                vector_digest(&vector.shares, &state, &deposits, &vectors.digest_domain),
                vector.expected_digest,
                "named vector {}",
                vector.name
            );
        }
    }

    #[test]
    fn matches_deterministic_100_case_typescript_corpus() {
        let vectors = vector_file();
        assert_eq!(vectors.generated_corpus.algorithm, "xorshift32-v1");
        assert!(vectors.generated_corpus.count >= 100);

        let mut corpus_hasher = Sha256::new();
        let mut state = vectors.generated_corpus.seed;

        for _ in 0..vectors.generated_corpus.count {
            let (next_state, shares, deposits) = generated_case(state);
            state = next_state;

            let initial_state = CumulativeState {
                gross: 0,
                allocated: vec![0; shares.len()],
            };
            let digest = vector_digest(&shares, &initial_state, &deposits, &vectors.digest_domain);

            let digest_bytes = (0..digest.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&digest[index..index + 2], 16).expect("hex"))
                .collect::<Vec<_>>();
            corpus_hasher.update(digest_bytes);
        }

        assert_eq!(
            hex(&corpus_hasher.finalize()),
            vectors.generated_corpus.expected_corpus_digest
        );
    }
}
