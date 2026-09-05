description: Make a payment request behave like a real bill — it can be paid in part, withdrawn by whoever sent it, and it ages rather than silently expiring.
files: packages/taleus/schema/draft1.qsql, packages/taleus-app/design/stories/mobile/21-ask-to-be-paid.md, packages/taleus-app/design/stories/mobile/22-respond-to-a-request.md, packages/taleus-app/design/specs/domain/rules.md
difficulty: medium
----
## Why this ticket exists

The app design pass reworked how payment requests behave, and the schema does not support the result.
Today `Invoice` carries an `ExpiryDate`, its `Units` is "exact-match by the answering chit", and
`InvoiceState` resolves to `paid` the moment any `Ledger` row references it. That models a request as
a small contract. It is not one.

A request commits nobody. It is one party telling another what they believe they are owed. The payer
may do anything a person can do with a bill: pay it, pay some of it, ignore it, dispute it, or return
the goods. The requester owns it and may take it back. And an unpaid bill does not stop existing
because a month passed — it **ages**, which is exactly the information a business needs.

Requiring payment in full also creates accounting problems that do not exist on paper: a part payment
has to masquerade as an unrelated transfer, and the bill has to be refused to keep the record honest.

## Outcomes we're after

- A party can pay part of what was asked, saying that is what they are doing, and both sides see what
  was applied and what is still asked for.
- One payment can answer several requests, with the payer saying which.
- The requester can withdraw a request at any time; the payer sees it withdrawn rather than vanished.
- Requests do not expire. Both parties can see how long one has been outstanding.
- A request that is refused stays visible as refused (this part already works).
- Nothing about the passage of time settles, excuses, or cancels a bill.

## The one race worth designing for

A withdrawal and a payment can cross. Both are acts on the same shared record, so there is a
definitive order — this is not the two-database problem MyCHIPs had, and it does not need a clock.
Whichever landed first is what happened, and **both parties see the same answer**.

If the result is an overpayment, that is not a catastrophe in a trust-based relationship: value is
returned the same way any other value moves, and the parties are already trusting each other for
considerably more. The design should not add ceremony to prevent it.

## Edge cases & interactions

- A part-answered request whose remainder is later withdrawn.
- Several payments answering one request over time; several requests answered by one payment.
- A request that would push the balance past the credit limit: allowed, with **both** parties warned
  and the *requester* being the one who needs to know — the goods are already delivered by then
  (see `feat-manual-chit-credit-gate`).
- Aging needs a stable "outstanding since" that part payments do not reset.

## Open questions

- Whether a request should be signed at all, beyond proof of origin. It commits nobody, so the
  signature is doing less work than an offer's — but it is evidence of what was asked, which matters
  in a dispute.
- Whether invoice terms (net 30, and the like) belong in the request, in the tally's up-front terms,
  or nowhere yet.
- Whether "withdrawn" and "refused" need to be distinguishable forever, or only while live.
