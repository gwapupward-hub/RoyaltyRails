# Security Policy — RoyaltyRails Protocol

## Status and supported deployments

RoyaltyRails Protocol is **deployed on Solana devnet for testing only**. It has **not completed an independent smart-contract security audit**, is not approved for mainnet, and must not be used to custody or settle real customer royalties.

Current devnet program: `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB`.

The currently deployed v1 program has **no protocol settlement fee**. Proposed future Phase 3F pricing (Basic 0.25%, Premium Security 1.00%) is not yet implemented.

## Reporting a vulnerability privately

Send security reports to **thagwapspot@gmail.com** with the subject `RoyaltyRails Security Report`.

Please include, where safe:
- An explanation of the vulnerability and potential impact.
- The affected component, commit, program address and network.
- Reproduction steps or a minimal proof of concept using **devnet or an isolated local validator only**.
- Any suggested mitigation.

**Do not include private keys, seed phrases, passwords, personal data, or actual customer funds in reports.**

This is an owner-designated email contact; email is not end-to-end encrypted. Please do not send sensitive secrets in email.

## Coordinated disclosure

Please report vulnerabilities privately first, avoid targeting other users or infrastructure, and allow time to investigate and coordinate disclosure. The maintainers intend to acknowledge and triage valid reports, but **no guaranteed response or remediation time, bug bounty, safe-harbor contract, or audit certification** is currently offered.

For ordinary bugs and non-sensitive feature requests, use GitHub Issues. Do not open public issues containing exploitable vulnerability details.

## Scope

Security reports may concern on-chain program logic, settlement and claims, authority and governance boundaries, SDK/reference accounting, deployment tooling, and integration security.

Devnet-only testing is permitted within the scope of network and service terms. Mainnet deployments, production funds, and third-party systems are **out of scope**.

## Updates

This policy may be refined before any mainnet release. Any production security policy, audit results, and supported release versions will be documented publicly if and when they exist.
