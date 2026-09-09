# Scenario: Responding to a request

Source: [22-respond-to-a-request.md](../../../stories/mobile/22-respond-to-a-request.md),
[21-ask-to-be-paid.md](../../../stories/mobile/21-ask-to-be-paid.md)

Mara has asked Sam for a repair. He wants to see what she is asking and why, decide, and have the
outcome be unambiguous for both of them.

## Step 1: What is being asked, and how long it has waited

Who is asking, for how much, what for, and how long it has been outstanding. Mara's bill was $95 and
Sam has already paid $70 against it, so $25 is still asked — shown as both, because nothing pretends
the part settled the whole.

There is **no expiry anywhere on this screen**, and that absence is deliberate: a request does not
lapse on its own. Time alone decides nothing.

The screen also says what a request is: their statement of what they think is owed, not yet Sam's
until he gives it. Only signed entries move the balance.

![A request asked of you](../images/request-view.png)

## Step 2: Answer in full, in part, or not at all

*Pay it* hands Mara's own figure to the paying screen — Sam is answering her request, not deciding an
amount. *Pay part of it* opens without a figure, because the part is his. Either way the entry is
tied to the request, and what was applied is recorded against it.

Declining takes an optional reason. It costs nothing and moves nothing; Mara is told, and it stops
waiting on Sam. Neither is left with a refused bill nagging, or with an answer that never comes.

## Step 3: The other side of the same request

A request this party made offers one act only: taking it back. Asking was their act, and so is
unasking — and Mara sees it withdrawn rather than vanishing. No pay or decline is offered, because
neither is theirs to do.

![A request you made](../images/request-view-mine.png)

## Alternate: paying past the limit

The paying screen warns how far past it goes and does not stop him. Mara asked for it; whether she
treats it as settling the repair is her call.

## Alternate: a request Sam does not recognise

Who is asking, on which tally, what they said it was for, and a way into what the two of them have
traded — enough to tell a forgotten obligation from a mistake. Declining costs nothing.

## A contradiction found while building this

Story 22 step 1 had Sam seeing "when the request runs out", and its first acceptance criterion said
"when the request expires". Story 21 says the opposite, twice: a request is not set ticking and
stands until answered or withdrawn. Story 22's own path D agrees with 21. The two lines in 22 were
corrected rather than built to; otherwise the screen would have shown a clock the model does not
have.

## Not shown

An attention item names `RequestView` but carries a tally id rather than a request id, so it still
lands on the tally where the request is listed. Requesting more room instead of paying past the limit
(path C) is story 03 path C, unsliced.
