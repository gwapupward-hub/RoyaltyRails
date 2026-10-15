use anchor_lang::prelude::*;

#[error_code]
pub enum RoyaltyRailError {
    #[msg("deployment_id must be non-zero")]
    InvalidDeploymentId,
    #[msg("authority must be a non-zero public key")]
    ZeroAuthority,
    #[msg("governance and guardian authorities must be distinct")]
    AuthoritiesMustDiffer,
    #[msg("the configured token program must be the original SPL Token Program")]
    InvalidTokenProgram,
    #[msg("the token program account must be executable")]
    TokenProgramNotExecutable,
    #[msg("the settlement mint must be owned by the configured token program")]
    InvalidSettlementMintOwner,
    #[msg("the settlement mint account has an invalid SPL Mint layout")]
    InvalidSettlementMintData,
    #[msg("the settlement mint must use six decimal places")]
    InvalidSettlementMintDecimals,
    #[msg("the settlement mint must already be initialized")]
    SettlementMintNotInitialized,
    #[msg("the account schema version is unsupported")]
    UnsupportedSchemaVersion,
    #[msg("the signer is not authorized for this action")]
    Unauthorized,
    #[msg("at least one pause domain must be requested")]
    NoPauseRequested,
    #[msg("the new guardian must differ from the current guardian")]
    GuardianUnchanged,
    #[msg("metadata hash is unchanged")]
    MetadataUnchanged,
    #[msg("metadata version overflow")]
    MetadataVersionOverflow,
    #[msg("the new manager must differ from the current manager")]
    ManagerUnchanged,
    #[msg("that manager is already pending")]
    ManagerAlreadyPending,
    #[msg("there is no pending manager transfer")]
    NoPendingManager,
    #[msg("only the pending manager may accept this transfer")]
    PendingManagerMismatch,
}
