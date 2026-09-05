# User Story: Ask to be paid

## Story Overview

Someone owes me for something. I want to ask them for it in a way they can act on directly, and then
know where that request stands without having to chase them.

Context: Mara has done a $95 repair for Sam and wants paying. She also wants a way to charge
customers at the counter without knowing in advance who they will be.

## Roles

| Role | Who |
|------|-----|
| Requester | Mara — the party who would receive the value |
| Payer | Sam — the party asked to give it |

## Sequence

1. Mara requests $95 from Sam on their tally — through the app, not by mentioning it next time
   he is in.
2. She says what it is for, in terms Sam will recognise when he sees it.
3. She does not set it ticking. A request is hers, and it stands until Sam answers it or she takes it
   back — an unpaid bill does not stop existing because a month went by.
4. It is her own statement, and it obliges Sam to nothing by itself.
5. Sam is asked to answer it. → [22](22-respond-to-a-request.md)
6. Mara can see where it stands — waiting, answered in part, answered in full, refused, or withdrawn
   — and how long it has been waiting, because a bill unpaid for ninety days is a different matter
   from one sent this morning.
7. Sam pays it, and Mara sees the balance move and the request settled — she does not have to work
   out whether the payment she received was for this request.

### Alternative Path A: a customer Mara has no tally with
1.1. A newcomer at the counter has no tally with her, so there is nothing to record a request
     against. What Mara offers them is a tally, not a request. → [01](01-invite-a-partner.md)
1.3. She can offer that tally extending them nothing at all — no trust in their direction. It is
     still useful: the customer hands her cash, she records the value they have given her, and they
     spend it with her from there.
1.4. Mara may make that worth doing — a better price for buying that way, since the customer has in
     effect lent her the money up front.
1.5. Being paid by someone she has no tally with, and wants none with, is a different thing
     altogether. → [30](30-pay-through-the-network.md)

### Alternative Path B: nobody answers
6.1. Months pass and Sam has not answered.
6.2. The request does not evaporate. It ages, visibly, and Mara can see how long it has been
     outstanding — which is what she needs to decide whether to chase him, write it off, or stop
     serving him.
6.3. It keeps waiting on Sam too. Nothing about the passage of time excuses it.

### Alternative Path C: Mara takes it back
4.1. Mara realises she overcharged and withdraws the request. It is hers; asking was her act and so
     is unasking.
4.2. Sam sees it withdrawn rather than merely vanishing, so he is not left wondering whether he still
     owes it.
4.3. If Sam paid it in the same moment she withdrew it, one of those happened first on their shared
     record and both of them see the same answer. Should it land as an overpayment, it is returned
     the same way any other value is — people who trade on credit are already trusting each other for
     more than this.
4.4. She can then request the right amount instead.

### Alternative Path D: Sam refuses
6.1. Sam declines the request.
6.2. Mara is notified. She is waiting on an answer and a refusal is one, so she is not left watching
     a clock to find out.
6.3. Nothing about the balance changes. She can talk to Sam and request again if it was a
     misunderstanding.

### Alternative Path E: paid without being asked
1.1. Sam pays Mara for the repair before she gets round to asking.
1.2. Mara does not need to ask at all — the value is already recorded. → [20](20-pay-a-partner.md)

### Alternative Path F: one payment, several bills
1.1. Sam owes Mara for a repair, a tube, and a service, each asked for separately.
1.2. He settles the lot in one payment, and says which bills it answers.
1.3. Mara sees each of them settled by it, rather than a lump sum she has to allocate herself.



## Acceptance Criteria

- [ ] A party can ask a counterparty for a specific amount, with a reason attached
- [ ] A request stands until answered or withdrawn; it does not expire on its own
- [ ] Both parties can see how long a request has been outstanding
- [ ] A request is signed by the requester and obliges the payer to nothing by itself
- [ ] The requester can see whether a request is waiting, part-answered, answered, refused, or
      withdrawn
- [ ] A payment answering a request is recognisably tied to it, not merely coincident with it
- [ ] One payment can answer several requests, with the payer saying which
- [ ] The requester can withdraw a request at any time, and the payer sees it withdrawn
- [ ] A withdrawal and a payment that cross are resolved the same way for both parties, with any
      overpayment returnable
- [ ] A refused request is visible to the requester
- [ ] A request is made to a counterparty the requester already holds a tally with
- [ ] A newcomer with no tally is offered a tally rather than a request
- [ ] A tally that extends the newcomer nothing still lets them fund it and spend what they funded

## Variants
- happy: request made, answered, settled
- empty: no outstanding requests
- error: a request left unanswered for months; a request refused; a withdrawal and a payment crossing
