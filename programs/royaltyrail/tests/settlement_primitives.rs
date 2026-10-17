#[test]
fn settlement_module_is_exposed_by_the_program_crate() {
    let _ = core::mem::size_of::<royaltyrail::settlement::InboxAccounting>();
}
