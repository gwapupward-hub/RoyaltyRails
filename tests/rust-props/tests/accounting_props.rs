//! Property tests for `royaltyrail_core::allocate` and `rounding_residual`.
//! They mirror docs/SECURITY_V1.md §3: conservation, and each participant's
//! cumulative allocation staying within one base unit of its exact entitlement.

use proptest::prelude::*;
use royaltyrail_core::{
    allocate, proportional_entitlement_parts, rounding_residual, validate_state, CoreError,
    CumulativeState, Participant, MAX_PARTICIPANTS, TOTAL_SHARE_UNITS,
};

const D: u128 = TOTAL_SHARE_UNITS as u128;

fn authority(index: usize) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[31] = u8::try_from(index + 1).expect("at most 16 participants");
    out
}

/// 1–16 positive shares summing to exactly 100,000,000, from distinct cut points.
fn shares() -> impl Strategy<Value = Vec<u32>> {
    (1usize..=MAX_PARTICIPANTS).prop_flat_map(|count| {
        proptest::collection::btree_set(1u32..TOTAL_SHARE_UNITS, count - 1).prop_map(|cuts| {
            let mut points = vec![0u32];
            points.extend(cuts);
            points.push(TOTAL_SHARE_UNITS);
            points.windows(2).map(|pair| pair[1] - pair[0]).collect()
        })
    })
}

fn participants(shares: &[u32]) -> Vec<Participant> {
    shares
        .iter()
        .enumerate()
        .map(|(index, &share_units)| Participant {
            authority: authority(index),
            share_units,
        })
        .collect()
}

fn amount() -> impl Strategy<Value = u64> {
    prop_oneof![1u64..=16, 1u64..=1_000_000_000, 1u64..=u64::MAX]
}

/// |allocated·D − gross·share| < D, computed exactly (inputs keep products below 2^128).
fn within_one_unit(gross: u128, allocated: u128, share_units: u32) -> bool {
    let exact = gross * u128::from(share_units);
    let scaled = allocated * D;
    scaled.abs_diff(exact) < D
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn allocate_sequences_conserve_and_stay_within_one_unit(
        shares in shares(),
        amounts in proptest::collection::vec(amount(), 1..40),
    ) {
        let participants = participants(&shares);
        let mut state = CumulativeState { gross: 0, allocated: vec![0; participants.len()] };

        for amount in amounts {
            let result = allocate(&participants, &state, amount).expect("valid allocation");
            let allocated_now: u128 = result.allocations.iter().map(|&a| u128::from(a)).sum();
            prop_assert_eq!(allocated_now, u128::from(amount));
            prop_assert_eq!(result.next_state.gross, state.gross + u128::from(amount));
            prop_assert_eq!(result.next_state.allocated.iter().sum::<u128>(), result.next_state.gross);
            for (index, participant) in participants.iter().enumerate() {
                let before = state.allocated[index];
                let after = result.next_state.allocated[index];
                prop_assert_eq!(after, before + u128::from(result.allocations[index]));
                prop_assert!(within_one_unit(result.next_state.gross, after, participant.share_units));
                prop_assert!(rounding_residual(result.next_state.gross, after, participant.share_units).is_ok());
            }
            prop_assert!(validate_state(&participants, &result.next_state).is_ok());
            // Deterministic: the same input yields the same result.
            prop_assert_eq!(allocate(&participants, &state, amount).expect("valid allocation"), result.clone());
            state = result.next_state;
        }
    }

    #[test]
    fn allocate_rejects_zero_amount(shares in shares()) {
        let participants = participants(&shares);
        let state = CumulativeState { gross: 0, allocated: vec![0; participants.len()] };
        prop_assert_eq!(allocate(&participants, &state, 0), Err(CoreError::AllocationAmountZero));
    }

    #[test]
    fn allocate_rejects_states_outside_the_rounding_bound(
        shares in shares(),
        amount in amount(),
        donor in 0usize..MAX_PARTICIPANTS,
        recipient in 0usize..MAX_PARTICIPANTS,
    ) {
        let participants = participants(&shares);
        let count = participants.len();
        let (donor, recipient) = (donor % count, recipient % count);
        prop_assume!(donor != recipient);
        let first = allocate(
            &participants,
            &CumulativeState { gross: 0, allocated: vec![0; count] },
            amount,
        )
        .expect("valid allocation");
        // Moving two units keeps conservation but always breaks the one-unit bound.
        let mut tampered = first.next_state.clone();
        prop_assume!(tampered.allocated[donor] >= 2);
        tampered.allocated[donor] -= 2;
        tampered.allocated[recipient] += 2;
        prop_assert!(allocate(&participants, &tampered, 1).is_err());
        prop_assert!(validate_state(&participants, &tampered).is_err());
    }

    #[test]
    fn rounding_residual_accepts_exactly_floor_and_floor_plus_one(
        gross in 0u128..(1u128 << 100),
        share in 1u32..=TOTAL_SHARE_UNITS,
    ) {
        let (floor, remainder) = proportional_entitlement_parts(gross, share).expect("in domain");
        // floor·D + remainder == gross·share, with 0 ≤ remainder < D.
        prop_assert!(remainder < D);
        prop_assert_eq!(floor * D + remainder, gross * u128::from(share));

        let remainder = i128::try_from(remainder).expect("remainder < D");
        let d = i128::try_from(D).expect("D fits");
        prop_assert_eq!(rounding_residual(gross, floor, share), Ok(remainder));
        prop_assert_eq!(rounding_residual(gross, floor + 1, share), Ok(remainder - d));
        prop_assert_eq!(rounding_residual(gross, floor + 2, share), Err(CoreError::ResidualOutOfBounds));
        if floor > 0 {
            prop_assert_eq!(rounding_residual(gross, floor - 1, share), Err(CoreError::ResidualOutOfBounds));
        }
        let residual = rounding_residual(gross, floor, share).expect("floor is valid");
        prop_assert!(residual > -d && residual < d);
    }

    #[test]
    fn rounding_residual_is_total_over_the_u128_domain(
        gross in any::<u128>(),
        allocated in any::<u128>(),
        share in 1u32..=TOTAL_SHARE_UNITS,
    ) {
        // Never panics or overflows: always Ok within (-D, D) or a typed error.
        let d = i128::try_from(D).expect("D fits");
        match rounding_residual(gross, allocated, share) {
            Ok(residual) => prop_assert!(residual > -d && residual < d),
            Err(error) => prop_assert_eq!(error, CoreError::ResidualOutOfBounds),
        }
        let (floor, _) = proportional_entitlement_parts(gross, share).expect("full u128 domain");
        prop_assert!(floor <= gross);
    }

    #[test]
    fn rounding_residual_rejects_out_of_domain_shares(gross in any::<u128>(), allocated in any::<u128>()) {
        prop_assert!(rounding_residual(gross, allocated, 0).is_err());
        prop_assert!(rounding_residual(gross, allocated, TOTAL_SHARE_UNITS + 1).is_err());
    }
}
