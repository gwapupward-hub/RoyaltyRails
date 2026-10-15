#![forbid(unsafe_code)]

pub const TOTAL_SHARE_UNITS: u32 = 100_000_000;
pub const MIN_PARTICIPANTS: usize = 1;
pub const MAX_PARTICIPANTS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Participant {
    pub authority: [u8; 32],
    pub share_units: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    ParticipantCount,
    ZeroAuthority,
    NonCanonicalAuthorityOrder,
    InvalidShare,
    InvalidShareTotal,
    ArithmeticOverflow,
    ResidualOutOfBounds,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn authority(index: u8) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[31] = index;
        out
    }

    #[test]
    fn validates_six_decimal_share_domain() {
        let participants = [
            Participant { authority: authority(1), share_units: 33_333_333 },
            Participant { authority: authority(2), share_units: 33_333_333 },
            Participant { authority: authority(3), share_units: 33_333_334 },
        ];
        assert_eq!(validate_participants(&participants), Ok(()));
    }

    #[test]
    fn rejects_noncanonical_authority_order() {
        let participants = [
            Participant { authority: authority(2), share_units: 50_000_000 },
            Participant { authority: authority(1), share_units: 50_000_000 },
        ];
        assert_eq!(
            validate_participants(&participants),
            Err(CoreError::NonCanonicalAuthorityOrder)
        );
    }

    #[test]
    fn near_u128_max_entitlement_does_not_require_wide_multiplication() {
        let gross = u128::MAX;
        let (floor, remainder) = proportional_entitlement_parts(gross, 50_000_000).unwrap();
        assert_eq!(floor, 170_141_183_460_469_231_731_687_303_715_884_105_727u128);
        assert_eq!(remainder, 50_000_000);
        assert_eq!(rounding_residual(gross, floor + 1, 50_000_000), Ok(-50_000_000));
    }
}
