mod error {
    pub use royaltyrail::error::*;
}

mod state {
    pub use royaltyrail::state::*;
}

#[path = "../src/settlement.rs"]
mod settlement;

#[test]
fn settlement_module_is_compiled_by_the_integration_harness() {
    let _ = core::mem::size_of::<settlement::InboxAccounting>();
}
