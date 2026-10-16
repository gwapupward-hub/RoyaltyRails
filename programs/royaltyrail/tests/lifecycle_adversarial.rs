use anchor_lang::prelude::Pubkey;
use royaltyrail::{
    lifecycle::{
        activate_initial, activate_replacement, approve_agreement, approve_supersession,
        cancel_proposal, initialize_proposal, reject_by_predecessor_participant,
        reject_by_proposed_participant, update_payout_wallet, AgreementParticipantInput,
        InitializeProposalParams,
    },
    state::{
        AgreementStatus, AgreementVersionState, ParticipantState, ProtocolConfigState,
        RevenuePoolKind, RevenuePoolState, SettlementBasis, SCHEMA_VERSION_V1,
    },
};

fn key(value: u8) -> Pubkey {
    Pubkey::new_from_array([value; 32])
}

fn config() -> ProtocolConfigState {
    ProtocolConfigState {
        schema_version: SCHEMA_VERSION_V1,
        bump: 1,
        deployment_id: [1; 32],
        governance_authority: key(2),
        guardian_authority: key(3),
        settlement_mint: key(4),
        token_program: key(5),
        agreements_paused: false,
        allocations_paused: false,
        claims_paused: false,
        created_slot: 1,
        reserved: [0; 64],
    }
}

fn pool() -> RevenuePoolState {
    RevenuePoolState {
        schema_version: SCHEMA_VERSION_V1,
        bump: 1,
        work: key(10),
        manager_authority: key(11),
        pending_manager_authority: Pubkey::default(),
        pool_id: [12; 32],
        pool_kind: RevenuePoolKind::MasterReceipts,
        settlement_basis: SettlementBasis::RevenueParticipation,
        metadata_hash: [13; 32],
        latest_version: 0,
        active_version: 0,
        pending_version: 0,
        created_slot: 1,
        reserved: [0; 64],
    }
}

fn participant(authority: u8, wallet: u8, share_units: u32) -> ParticipantState {
    ParticipantState {
        participant_authority: key(authority),
        payout_wallet: key(wallet),
        share_units,
        payout_revision: 1,
        cumulative_allocated: 0,
        cumulative_claimed: 0,
    }
}

fn agreement(
    version: u32,
    predecessor_version: u32,
    status: AgreementStatus,
    participants: Vec<ParticipantState>,
) -> AgreementVersionState {
    AgreementVersionState {
        schema_version: SCHEMA_VERSION_V1,
        bump: 1,
        revenue_pool: key(20),
        version,
        predecessor_version,
        status,
        settlement_mint: key(4),
        token_program: key(5),
        terms_hash: [21; 32],
        agreement_hash: [22u8.wrapping_add(version as u8); 32],
        participants,
        approval_bitmap: 0,
        supersession_approval_bitmap: 0,
        cumulative_gross: 0,
        direct_funding_nonce: 0,
        allocation_sequence: 0,
        created_slot: 1,
        activated_slot: 0,
        superseded_slot: 0,
        reserved: [0; 128],
    }
}

fn empty_agreement() -> AgreementVersionState {
    agreement(0, 0, AgreementStatus::Cancelled, Vec::new())
}

fn proposal_inputs_two() -> Vec<AgreementParticipantInput> {
    vec![
        AgreementParticipantInput {
            participant_authority: key(30),
            share_units: 60_000_000,
        },
        AgreementParticipantInput {
            participant_authority: key(31),
            share_units: 40_000_000,
        },
    ]
}

#[test]
fn noncanonical_participant_order_is_rejected_without_mutating_pool_version_state() {
    let cfg = config();
    let mut p = pool();
    let mut a = empty_agreement();
    let inputs = vec![
        AgreementParticipantInput {
            participant_authority: key(31),
            share_units: 50_000_000,
        },
        AgreementParticipantInput {
            participant_authority: key(30),
            share_units: 50_000_000,
        },
    ];

    assert!(initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut a,
        InitializeProposalParams {
            program_id: key(6),
            version: 1,
            terms_hash: [7; 32],
            participant_inputs: &inputs,
            bump: 250,
            created_slot: 9,
        },
    )
    .is_err());

    assert_eq!(p.latest_version, 0);
    assert_eq!(p.pending_version, 0);
}

#[test]
fn second_pending_proposal_and_skipped_version_are_rejected() {
    let cfg = config();
    let mut p = pool();
    let mut first = empty_agreement();
    let inputs = proposal_inputs_two();

    initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut first,
        InitializeProposalParams {
            program_id: key(6),
            version: 1,
            terms_hash: [7; 32],
            participant_inputs: &inputs,
            bump: 250,
            created_slot: 9,
        },
    )
    .expect("first proposal");

    let mut second = empty_agreement();
    assert!(initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut second,
        InitializeProposalParams {
            program_id: key(6),
            version: 2,
            terms_hash: [8; 32],
            participant_inputs: &inputs,
            bump: 249,
            created_slot: 10,
        },
    )
    .is_err());

    cancel_proposal(&mut p, &mut first).expect("cancel first");

    assert!(initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut second,
        InitializeProposalParams {
            program_id: key(6),
            version: 3,
            terms_hash: [8; 32],
            participant_inputs: &inputs,
            bump: 249,
            created_slot: 10,
        },
    )
    .is_err());

    initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut second,
        InitializeProposalParams {
            program_id: key(6),
            version: 2,
            terms_hash: [8; 32],
            participant_inputs: &inputs,
            bump: 249,
            created_slot: 10,
        },
    )
    .expect("monotonic version two");
}

#[test]
fn approval_requires_exact_hash_membership_and_single_use() {
    let alice = key(30);
    let mut a = agreement(
        1,
        0,
        AgreementStatus::Proposed,
        vec![ParticipantState {
            participant_authority: alice,
            payout_wallet: Pubkey::default(),
            share_units: 100_000_000,
            payout_revision: 0,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }],
    );
    let expected_hash = a.agreement_hash;

    assert!(approve_agreement(&mut a, alice, [99; 32], key(130)).is_err());
    assert_eq!(a.approval_bitmap, 0);
    assert!(approve_agreement(&mut a, key(31), expected_hash, key(131)).is_err());
    assert_eq!(a.approval_bitmap, 0);
    assert!(approve_agreement(&mut a, alice, expected_hash, Pubkey::default()).is_err());
    assert_eq!(a.approval_bitmap, 0);

    approve_agreement(&mut a, alice, expected_hash, key(130)).expect("first approval");
    let first_wallet = a.participants[0].payout_wallet;
    assert!(approve_agreement(&mut a, alice, expected_hash, key(140)).is_err());
    assert_eq!(a.participants[0].payout_wallet, first_wallet);
    assert_eq!(a.approval_bitmap, 1);
}

#[test]
fn initial_activation_requires_every_participant_and_initialized_payout_route() {
    let alice = key(30);
    let bob = key(31);
    let mut p = pool();
    p.latest_version = 1;
    p.pending_version = 1;
    let mut a = agreement(
        1,
        0,
        AgreementStatus::Proposed,
        vec![
            ParticipantState {
                participant_authority: alice,
                payout_wallet: Pubkey::default(),
                share_units: 60_000_000,
                payout_revision: 0,
                cumulative_allocated: 0,
                cumulative_claimed: 0,
            },
            ParticipantState {
                participant_authority: bob,
                payout_wallet: Pubkey::default(),
                share_units: 40_000_000,
                payout_revision: 0,
                cumulative_allocated: 0,
                cumulative_claimed: 0,
            },
        ],
    );
    let hash = a.agreement_hash;

    approve_agreement(&mut a, alice, hash, key(130)).expect("alice approval");
    assert!(activate_initial(&mut p, &mut a, 20).is_err());
    assert_eq!(a.status, AgreementStatus::Proposed);
    assert_eq!(p.active_version, 0);

    approve_agreement(&mut a, bob, hash, key(131)).expect("bob approval");
    activate_initial(&mut p, &mut a, 21).expect("activation");
    assert_eq!(a.status, AgreementStatus::Active);
    assert_eq!(p.active_version, 1);
    assert_eq!(p.pending_version, 0);
}

#[test]
fn replacement_rejects_wrong_predecessor_nonparticipant_and_duplicate_supersession() {
    let alice = key(30);
    let bob = key(31);
    let outsider = key(32);
    let mut p = pool();
    p.latest_version = 2;
    p.active_version = 1;
    p.pending_version = 2;

    let predecessor = agreement(
        1,
        0,
        AgreementStatus::Active,
        vec![participant(30, 130, 60_000_000), participant(31, 131, 40_000_000)],
    );
    let wrong_predecessor = agreement(
        9,
        0,
        AgreementStatus::Active,
        vec![participant(30, 130, 100_000_000)],
    );
    let mut successor = agreement(
        2,
        1,
        AgreementStatus::Proposed,
        vec![ParticipantState {
            participant_authority: alice,
            payout_wallet: Pubkey::default(),
            share_units: 100_000_000,
            payout_revision: 0,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }],
    );
    let hash = successor.agreement_hash;

    assert!(approve_supersession(&p, &mut successor, &wrong_predecessor, alice, hash).is_err());
    assert!(approve_supersession(&p, &mut successor, &predecessor, outsider, hash).is_err());
    approve_supersession(&p, &mut successor, &predecessor, alice, hash)
        .expect("alice supersession");
    assert!(approve_supersession(&p, &mut successor, &predecessor, alice, hash).is_err());
    approve_supersession(&p, &mut successor, &predecessor, bob, hash)
        .expect("bob supersession");
}

#[test]
fn replacement_activation_is_atomic_with_respect_to_missing_consent() {
    let alice = key(30);
    let bob = key(31);
    let mut p = pool();
    p.latest_version = 2;
    p.active_version = 1;
    p.pending_version = 2;

    let mut predecessor = agreement(
        1,
        0,
        AgreementStatus::Active,
        vec![participant(30, 130, 60_000_000), participant(31, 131, 40_000_000)],
    );
    let mut successor = agreement(
        2,
        1,
        AgreementStatus::Proposed,
        vec![ParticipantState {
            participant_authority: alice,
            payout_wallet: Pubkey::default(),
            share_units: 100_000_000,
            payout_revision: 0,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }],
    );
    let hash = successor.agreement_hash;

    approve_agreement(&mut successor, alice, hash, key(140)).expect("successor approval");
    approve_supersession(&p, &mut successor, &predecessor, alice, hash)
        .expect("alice supersession");

    assert!(activate_replacement(&mut p, &mut successor, &mut predecessor, 30).is_err());
    assert_eq!(predecessor.status, AgreementStatus::Active);
    assert_eq!(predecessor.superseded_slot, 0);
    assert_eq!(successor.status, AgreementStatus::Proposed);
    assert_eq!(successor.activated_slot, 0);
    assert_eq!(p.active_version, 1);
    assert_eq!(p.pending_version, 2);

    approve_supersession(&p, &mut successor, &predecessor, bob, hash)
        .expect("bob supersession");
    activate_replacement(&mut p, &mut successor, &mut predecessor, 31)
        .expect("replacement activation");
    assert_eq!(predecessor.status, AgreementStatus::Superseded);
    assert_eq!(successor.status, AgreementStatus::Active);
    assert_eq!(p.active_version, 2);
    assert_eq!(p.pending_version, 0);
}

#[test]
fn only_members_of_the_relevant_consent_set_can_reject() {
    let alice = key(30);
    let bob = key(31);
    let outsider = key(32);
    let mut p = pool();
    p.latest_version = 2;
    p.active_version = 1;
    p.pending_version = 2;

    let predecessor = agreement(
        1,
        0,
        AgreementStatus::Active,
        vec![participant(30, 130, 60_000_000), participant(31, 131, 40_000_000)],
    );
    let mut successor = agreement(
        2,
        1,
        AgreementStatus::Proposed,
        vec![ParticipantState {
            participant_authority: alice,
            payout_wallet: Pubkey::default(),
            share_units: 100_000_000,
            payout_revision: 0,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }],
    );

    assert!(reject_by_proposed_participant(&mut p, &mut successor, outsider).is_err());
    assert!(reject_by_predecessor_participant(&mut p, &mut successor, &predecessor, outsider).is_err());
    assert_eq!(successor.status, AgreementStatus::Proposed);
    assert_eq!(p.pending_version, 2);

    reject_by_predecessor_participant(&mut p, &mut successor, &predecessor, bob)
        .expect("predecessor participant may reject");
    assert_eq!(successor.status, AgreementStatus::Cancelled);
    assert_eq!(p.pending_version, 0);
}

#[test]
fn cancellation_is_terminal_and_versions_are_never_reused() {
    let cfg = config();
    let inputs = proposal_inputs_two();
    let mut p = pool();
    let mut first = empty_agreement();

    initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut first,
        InitializeProposalParams {
            program_id: key(6),
            version: 1,
            terms_hash: [7; 32],
            participant_inputs: &inputs,
            bump: 250,
            created_slot: 9,
        },
    )
    .expect("proposal one");
    cancel_proposal(&mut p, &mut first).expect("cancel");

    let hash = first.agreement_hash;
    assert!(approve_agreement(&mut first, key(30), hash, key(130)).is_err());
    assert!(activate_initial(&mut p, &mut first, 20).is_err());

    let mut reused = empty_agreement();
    assert!(initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut reused,
        InitializeProposalParams {
            program_id: key(6),
            version: 1,
            terms_hash: [8; 32],
            participant_inputs: &inputs,
            bump: 249,
            created_slot: 10,
        },
    )
    .is_err());
    assert_eq!(p.latest_version, 1);
}

#[test]
fn payout_rotation_is_exclusive_to_participant_and_preserves_state_on_failure() {
    let alice = key(30);
    let mut a = agreement(
        1,
        0,
        AgreementStatus::Active,
        vec![participant(30, 130, 100_000_000)],
    );

    assert!(update_payout_wallet(&mut a, key(31), key(140)).is_err());
    assert!(update_payout_wallet(&mut a, alice, Pubkey::default()).is_err());
    assert!(update_payout_wallet(&mut a, alice, key(130)).is_err());
    assert_eq!(a.participants[0].payout_wallet, key(130));
    assert_eq!(a.participants[0].payout_revision, 1);

    let update = update_payout_wallet(&mut a, alice, key(140)).expect("participant rotation");
    assert_eq!(update.previous_wallet, key(130));
    assert_eq!(update.new_revision, 2);
    assert_eq!(a.participants[0].payout_wallet, key(140));
    assert_eq!(a.participants[0].payout_revision, 2);
}

#[test]
fn payout_revision_overflow_fails_without_redirecting_wallet() {
    let alice = key(30);
    let mut a = agreement(
        1,
        0,
        AgreementStatus::Active,
        vec![ParticipantState {
            participant_authority: alice,
            payout_wallet: key(130),
            share_units: 100_000_000,
            payout_revision: u32::MAX,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }],
    );

    assert!(update_payout_wallet(&mut a, alice, key(140)).is_err());
    assert_eq!(a.participants[0].payout_wallet, key(130));
    assert_eq!(a.participants[0].payout_revision, u32::MAX);
}

#[test]
fn malformed_pool_version_state_blocks_new_proposals() {
    let cfg = config();
    let mut p = pool();
    p.latest_version = 1;
    p.active_version = 2;
    let mut a = empty_agreement();
    let inputs = proposal_inputs_two();

    assert!(initialize_proposal(
        &cfg,
        key(20),
        &mut p,
        &mut a,
        InitializeProposalParams {
            program_id: key(6),
            version: 2,
            terms_hash: [7; 32],
            participant_inputs: &inputs,
            bump: 250,
            created_slot: 9,
        },
    )
    .is_err());
}

#[test]
fn superseded_participant_may_rotate_but_cancelled_participant_may_not() {
    let alice = key(30);
    let mut a = agreement(
        1,
        0,
        AgreementStatus::Superseded,
        vec![participant(30, 130, 100_000_000)],
    );

    update_payout_wallet(&mut a, alice, key(140)).expect("superseded rotation");
    assert_eq!(a.participants[0].payout_wallet, key(140));

    a.status = AgreementStatus::Cancelled;
    assert!(update_payout_wallet(&mut a, alice, key(150)).is_err());
    assert_eq!(a.participants[0].payout_wallet, key(140));
}
