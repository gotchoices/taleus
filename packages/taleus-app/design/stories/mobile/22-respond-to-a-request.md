# User Story: Respond to a request

## Story Overview

Someone has asked me to pay them. I want to see what they are asking for and why, decide, and have
the outcome be unambiguous for both of us.

Context: Continues [21](21-ask-to-be-paid.md). Mara has asked Sam for $95 for a repair. Sam also has
an older request from a supplier he does not recognise.

## Roles

| Role | Who |
|------|-----|
| Payer | Sam — asked to give value |
| Requester | Mara — waiting on an answer |

## Sequence

1. Sam sees that Mara is asking him for $95, what it is for, and when the request runs out.
2. He sees what paying it would do: what he would owe afterward, and how much room that leaves him.
3. He pays it. The amount is Mara's — he is answering her request, not deciding an amount himself.
4. He signs it, in the moment, as with any value he gives ([20](20-pay-a-partner.md)).
5. Mara sees the request settled and the balance moved.
6. The request stops waiting on Sam and does not ask him again.

### Alternative Path A: Sam does not accept the charge
3.1. Sam thinks the repair was quoted at $70, not $95.
3.2. He declines the request, and can say why.
3.3. Mara is told it was refused. Nothing has moved, and the two of them can sort it out between
     themselves.
3.4. Sam is not left with a refused request nagging him, and Mara is not left waiting on an answer
     that will never come.

### Alternative Path B: Sam wants to pay part of it
3.1. Sam accepts $70 of it but not the rest.
3.2. He cannot answer the request with a different amount — a request is for what was asked.
3.3. What he can do is give Mara $70 directly ([20](20-pay-a-partner.md)) and decline the request, so
     the record says what actually happened rather than dressing $70 up as an answer to $95.

### Alternative Path C: paying would take Sam past his limit
2.1. Paying $95 would put Sam beyond what Mara agreed to be owed.
2.2. He is told before deciding, and so is Mara when the payment lands — but he is not stopped.
     Mara asked for it; whether she treats it as settling the repair is her call.
2.3. He can also settle up first or ask Mara for more room ([03](03-negotiate-terms.md)) if he would
     rather stay inside it.

### Alternative Path D: Sam ignores it
3.1. Sam does nothing. The request runs out on its own.
3.2. It stops waiting on him, and Mara sees it went unanswered rather than refused — a different
     thing, and she may read it either way.

### Alternative Path E: a request Sam does not recognise
1.1. A supplier Sam barely remembers asks him for $2,400.
1.2. Sam can see who is asking, what tally it is on, what they said it was for, and what he has
     traded with them before — enough to tell a forgotten obligation from a mistake or an attempt.
1.3. Declining costs him nothing and moves nothing.

### Alternative Path F: many requests at once
1.1. Sam has four requests waiting across three tallies.
1.2. He can see them together, with what each would cost him, rather than discovering them one tally
     at a time. → [23](23-what-needs-my-attention.md)

## Acceptance Criteria

- [ ] The payer sees the amount, the reason, who is asking, and when the request expires
- [ ] The effect of paying — resulting balance and remaining room — is shown before deciding
- [ ] Paying answers the request for exactly the amount asked, and is signed in the moment
- [ ] The requester can tell a payment that answers their request from an unrelated one
- [ ] A payer can decline, and may say why
- [ ] A declined request is visible to the requester, and stops waiting on the payer
- [ ] An ignored request expires, and is distinguishable from a declined one by both parties
- [ ] A payer going beyond the agreed limit is warned, not blocked, and so is the requester
- [ ] A request cannot be answered with a different amount; paying something else is a separate act
- [ ] Requests across all tallies can be seen together

## Variants
- happy: request reviewed and paid
- empty: no requests waiting
- error: insufficient room; unrecognised requester; request expires unanswered
