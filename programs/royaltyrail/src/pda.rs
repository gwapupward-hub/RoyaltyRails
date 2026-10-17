use anchor_lang::prelude::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const WORK_SEED: &[u8] = b"work";
pub const POOL_SEED: &[u8] = b"pool";
pub const AGREEMENT_SEED: &[u8] = b"agreement";
pub const VAULT_SEED: &[u8] = b"vault";

const ASSOCIATED_TOKEN_PROGRAM_BYTES: [u8; 32] = [
    0x8c, 0x97, 0x25, 0x8f, 0x4e, 0x24, 0x89, 0xf1, 0xbb, 0x3d, 0x10, 0x29, 0x14, 0x8e, 0x0d, 0x83,
    0x0b, 0x5a, 0x13, 0x99, 0xda, 0xff, 0x10, 0x84, 0x04, 0x8e, 0x7b, 0xd8, 0xdb, 0xe9, 0xf8, 0x59,
];

pub fn associated_token_program_id() -> Pubkey {
    Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_BYTES)
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn work_pda(
    program_id: &Pubkey,
    origin_authority: &Pubkey,
    work_id: &[u8; 32],
) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[WORK_SEED, origin_authority.as_ref(), work_id], program_id)
}

pub fn pool_pda(program_id: &Pubkey, work: &Pubkey, pool_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_SEED, work.as_ref(), pool_id], program_id)
}

pub fn agreement_pda(program_id: &Pubkey, revenue_pool: &Pubkey, version: u32) -> (Pubkey, u8) {
    let version_bytes = version.to_le_bytes();
    Pubkey::find_program_address(
        &[AGREEMENT_SEED, revenue_pool.as_ref(), &version_bytes],
        program_id,
    )
}

pub fn vault_pda(program_id: &Pubkey, agreement: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, agreement.as_ref()], program_id)
}

pub fn royalty_inbox_address(
    program_id: &Pubkey,
    agreement: &Pubkey,
    settlement_mint: &Pubkey,
    token_program: &Pubkey,
) -> (Pubkey, u8, Pubkey) {
    let (vault, vault_bump) = vault_pda(program_id, agreement);
    let inbox = Pubkey::find_program_address(
        &[
            vault.as_ref(),
            token_program.as_ref(),
            settlement_mint.as_ref(),
        ],
        &associated_token_program_id(),
    )
    .0;
    (vault, vault_bump, inbox)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTOR_PROGRAM_ID: [u8; 32] = [
        0xcd, 0xec, 0x7d, 0xb9, 0x6a, 0x93, 0x1a, 0x59, 0x21, 0x92, 0x1d, 0xa5, 0xc8, 0x70, 0x8f,
        0x6b, 0x49, 0x16, 0x2b, 0x0a, 0xae, 0x6b, 0xae, 0xb0, 0x27, 0x00, 0xde, 0xa6, 0xf1, 0x67,
        0xbb, 0x04,
    ];

    #[test]
    fn canonical_pda_vectors_match() {
        let program_id = Pubkey::new_from_array(VECTOR_PROGRAM_ID);
        let origin = Pubkey::new_from_array([0x11; 32]);
        let work_id = [0x22; 32];
        let pool_id = [0x33; 32];

        let (config, config_bump) = config_pda(&program_id);
        assert_eq!(config_bump, 255);
        assert_eq!(
            config.to_bytes(),
            [
                0x20, 0x25, 0x8f, 0xf1, 0x34, 0xde, 0xc7, 0x6c, 0xdd, 0x89, 0x89, 0x56, 0x26, 0xcd,
                0xd5, 0xce, 0x60, 0xdf, 0x87, 0x17, 0xee, 0x9f, 0xec, 0x74, 0x66, 0x5d, 0xad, 0xd1,
                0xe8, 0xa3, 0xae, 0x96,
            ]
        );

        let (work, work_bump) = work_pda(&program_id, &origin, &work_id);
        assert_eq!(work_bump, 254);
        assert_eq!(
            work.to_bytes(),
            [
                0x36, 0xfc, 0xc1, 0xd3, 0x32, 0xf2, 0x10, 0x58, 0xcc, 0xf6, 0x13, 0xca, 0x16, 0xbb,
                0xee, 0xe1, 0x8a, 0xf4, 0x4a, 0xb6, 0xfd, 0x17, 0x56, 0xaf, 0x47, 0x5f, 0xf6, 0x3a,
                0x40, 0x88, 0x6d, 0x05,
            ]
        );

        let (pool, pool_bump) = pool_pda(&program_id, &work, &pool_id);
        assert_eq!(pool_bump, 255);
        assert_eq!(
            pool.to_bytes(),
            [
                0xd4, 0x0b, 0x63, 0x2c, 0x52, 0x21, 0x9e, 0xf7, 0x46, 0x40, 0xe7, 0x88, 0xdd, 0xdf,
                0x1f, 0xea, 0x68, 0xc8, 0x79, 0xee, 0x04, 0x9b, 0x15, 0x45, 0x15, 0x24, 0x1b, 0x5c,
                0xc4, 0x16, 0x23, 0x3e,
            ]
        );

        let (agreement, agreement_bump) = agreement_pda(&program_id, &pool, 7);
        assert_eq!(agreement_bump, 253);
        assert_eq!(
            agreement.to_bytes(),
            [
                0xfc, 0x2c, 0x2c, 0xbd, 0x7f, 0x9f, 0x98, 0xf8, 0x91, 0xda, 0x83, 0x0b, 0xb8, 0xb0,
                0xd1, 0x10, 0xbd, 0x54, 0xee, 0x7d, 0x15, 0xd5, 0xdf, 0x95, 0x62, 0x80, 0x4e, 0x04,
                0x34, 0xbd, 0xd4, 0x5c,
            ]
        );

        let (vault, vault_bump) = vault_pda(&program_id, &agreement);
        assert_eq!(vault_bump, 255);
        assert_eq!(
            vault.to_bytes(),
            [
                0xbf, 0xa9, 0x42, 0x0a, 0x05, 0x3c, 0x09, 0x79, 0xb5, 0x3b, 0x09, 0xdc, 0x6e, 0x68,
                0xa3, 0xc9, 0xc8, 0x9a, 0xa5, 0xd5, 0xa1, 0x19, 0x3f, 0x9b, 0xda, 0xcf, 0x8e, 0xa3,
                0x69, 0x35, 0x9d, 0x15,
            ]
        );
    }

    #[test]
    fn royalty_inbox_uses_canonical_legacy_ata_seed_order() {
        let program_id = Pubkey::new_from_array(VECTOR_PROGRAM_ID);
        let agreement = Pubkey::new_from_array([0x66; 32]);
        let mint = Pubkey::new_from_array([0x44; 32]);
        let token_program = Pubkey::new_from_array([0x55; 32]);

        assert_eq!(
            associated_token_program_id().to_string(),
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        );

        let (vault, vault_bump, inbox) =
            royalty_inbox_address(&program_id, &agreement, &mint, &token_program);
        let (expected_vault, expected_vault_bump) = vault_pda(&program_id, &agreement);
        let expected_inbox = Pubkey::find_program_address(
            &[vault.as_ref(), token_program.as_ref(), mint.as_ref()],
            &associated_token_program_id(),
        )
        .0;

        assert_eq!(vault, expected_vault);
        assert_eq!(vault_bump, expected_vault_bump);
        assert_eq!(inbox, expected_inbox);
    }
}
