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

1. Mara asks Sam for $95 on their tally.
2. She says what it is for, in terms Sam will recognise when he sees it.
3. She sets how long the request is good for. A repair invoice can stand for a month; a request at the
   counter should not outlive the customer's visit.
4. She signs the request. It is her own statement, and it obliges Sam to nothing by itself.
5. Sam is asked to answer it. → [22](22-respond-to-a-request.md)
6. Mara can see where it stands: waiting, answered, refused, or run out.
7. Sam pays it, and Mara sees the balance move and the request settled — she does not have to work
   out whether the payment she received was for this request.

### Alternative Path A: a customer Mara has no tally with
1.1. A request is made to someone Mara already holds a tally with — she picks the party, states the
     amount, and it reaches them. There is nothing to scan and nothing to guess.
1.2. A newcomer at the counter has no tally with her, so there is nothing to record a request
     against. What Mara offers them is a tally, not a request. → [01](01-invite-a-partner.md)
1.3. She can offer that tally extending them nothing at all — no trust in their direction. It is
     still useful: the customer hands her cash, she records the value they have given her, and they
     spend it with her from there.
1.4. Mara may make that worth doing — a better price for buying that way, since the customer has in
     effect lent her the money up front.
1.5. Being paid by someone she has no tally with, and wants none with, is a different thing
     altogether. → [30](30-pay-through-the-network.md)

### Alternative Path B: nobody answers
6.1. The month passes and Sam has not answered.
6.2. The request runs out. It stops waiting on Sam, and Mara can see it went unanswered rather than
     refused.
6.3. She can ask again — a fresh request, not a revival of the old one.

### Alternative Path C: Mara changes her mind
4.1. Mara realises she overcharged and wants to take the request back.
4.2. She cannot un-ask it. What she can do is tell Sam not to pay it and let it run out, or ask again
     for the right amount, and the app is honest about which of those it is doing.
4.3. This is why the expiry she set in step 3 matters, and why the app helps her choose one.

### Alternative Path D: Sam refuses
6.1. Sam declines the request.
6.2. Mara is told. Unlike an unanswered tally offer, a refused request is something she knows about,
     because she is waiting on an answer and deserves one.
6.3. Nothing about the balance changes. She can talk to Sam and ask again if it was a misunderstanding.

### Alternative Path E: paid without being asked
1.1. Sam pays Mara for the repair before she gets round to asking.
1.2. Mara does not need to ask at all — the value is already recorded. → [20](20-pay-a-partner.md)

## Acceptance Criteria

- [ ] A party can ask a counterparty for a specific amount, with a reason attached
- [ ] The requester sets how long the request stands, and is helped to choose sensibly
- [ ] A request is signed by the requester and obliges the payer to nothing by itself
- [ ] The requester can see whether a request is waiting, paid, refused, or expired
- [ ] A payment answering a request is recognisably tied to it, not merely coincident with it
- [ ] A request cannot be withdrawn once made; the requester is told plainly and given real options
- [ ] An expired request is distinguishable from a refused one
- [ ] A refused request is visible to the requester
- [ ] A request is made to a counterparty the requester already holds a tally with
- [ ] A newcomer with no tally is offered a tally rather than a request
- [ ] A tally that extends the newcomer nothing still lets them fund it and spend what they funded

## Variants
- happy: request made, answered, settled
- empty: no outstanding requests
- error: request expires unanswered; request refused; requester wants to withdraw and cannot
