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
    #[msg("agreement lifecycle operations are paused")]
    AgreementsPaused,
    #[msg("the revenue pool already has a pending agreement")]
    PendingAgreementExists,
    #[msg("agreement version overflow")]
    AgreementVersionOverflow,
    #[msg("the supplied agreement version is not the next monotonic version")]
    UnexpectedAgreementVersion,
    #[msg("participant count must be between one and sixteen")]
    InvalidParticipantCount,
    #[msg("participant authority must be non-zero")]
    InvalidParticipantAuthority,
    #[msg("participant authorities must be strictly sorted and unique")]
    NonCanonicalParticipants,
    #[msg("participant share is invalid")]
    InvalidShare,
    #[msg("participant shares must total exactly 100,000,000 share units")]
    InvalidShareTotal,
    #[msg("the agreement definition cannot be encoded under v1 rules")]
    InvalidAgreementDefinition,
    #[msg("the agreement is not Proposed")]
    AgreementNotProposed,
    #[msg("the agreement is not Active")]
    AgreementNotActive,
    #[msg("the expected agreement hash does not match stored terms")]
    AgreementHashMismatch,
    #[msg("the signer is not a participant in the required consent set")]
    ParticipantNotFound,
    #[msg("that consent bit is already set")]
    DuplicateApproval,
    #[msg("payout wallet must be non-zero")]
    InvalidPayoutWallet,
    #[msg("participant payout revision is inconsistent with lifecycle state")]
    InvalidPayoutRevision,
    #[msg("not every proposed participant has approved")]
    ApprovalIncomplete,
    #[msg("not every predecessor participant has approved supersession")]
    SupersessionConsentIncomplete,
    #[msg("the predecessor relationship is invalid")]
    InvalidPredecessor,
    #[msg("the agreement is not the revenue pool's pending version")]
    PendingAgreementMismatch,
    #[msg("the predecessor is not the revenue pool's current Active version")]
    ActiveAgreementMismatch,
    #[msg("the revenue pool version pointers are inconsistent")]
    InvalidPoolVersionState,
    #[msg("initial activation conflicts with an existing active agreement")]
    InitialActivationConflict,
    #[msg("a participant payout route has not been initialized")]
    PayoutRouteUninitialized,
    #[msg("payout-wallet rotation is unavailable for this agreement status")]
    PayoutRotationUnavailable,
    #[msg("a Proposed participant must approve before rotating payout routing")]
    ParticipantNotApproved,
    #[msg("the new payout wallet is unchanged")]
    PayoutWalletUnchanged,
    #[msg("payout revision overflow")]
    PayoutRevisionOverflow,
    #[msg("checked arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("settlement is available only for Active or Superseded agreements")]
    SettlementUnavailable,
    #[msg("agreement settlement configuration does not match ProtocolConfig")]
    SettlementConfigMismatch,
    #[msg("agreement allocation/claim counters violate settlement invariants")]
    AllocationStateInvariantViolation,
    #[msg("Royalty Inbox balance is below allocated-but-unclaimed liabilities")]
    RoyaltyInboxInsolvent,
    #[msg("participant index is outside the agreement participant set")]
    InvalidParticipantIndex,
    #[msg("current claim amount exceeds the SPL token u64 amount domain")]
    ClaimAmountExceedsTokenWidth,
}
