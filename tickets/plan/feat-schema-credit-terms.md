----
description: Model the credit limits and notice periods each party grants the other as formal, signed arguments of the tally contract.
files: schema/draft1.sql, docs/architecture.md, docs/old/tally.md
----
Credit terms (limit, call/notice period, and any contract-specific parameters) are arguments to the tally contract. The contract tables (`TallyContractProposal`, `TallyContract`) currently reference only a `ContractCid` — the terms columns are a TODO in `schema/draft1.sql`.

Requirements:
- Each party extends terms unilaterally (only the grantor signs), per the MyCHIPs model — see `docs/old/tally.md` § Credit Terms Chunk.
- Terms are revisioned; restrictive changes take effect only after the call term expires, permissive changes immediately.
- Decide representation: structured columns on the contract proposal/acceptance rows vs. a separate revisioned `CreditTerms` table referenced by the contract. The contract's bilateral signature must cover the terms in force at acceptance.
- The denomination argument (see `feat-multi-denomination`) travels the same way — design the argument mechanism generically.
- Ledger/lift validation must be able to check a prospective chit against the current effective limit (including pending lift chits).

Expected outcome: schema tables + constraints for terms; architecture.md contract/negotiation sections stay accurate.
