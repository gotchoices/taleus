# Scenario: Asking to be paid

Source: [21-ask-to-be-paid.md](../../../stories/mobile/21-ask-to-be-paid.md)

Mara has done a repair for Sam and wants paying — through the app, not by mentioning it next time he
is in.

## Step 1: What is being asked, and what it is for

An amount, and terms Sam will recognise when he sees it.

Two things are said on the screen rather than left to be worked out. A request **obliges him to
nothing by itself** — only signed entries move the balance. And it **does not tick**: there is no
expiry field here, because a request is not set ticking. It stands until Sam answers it or Mara takes
it back. An unpaid bill does not stop existing because a month went by.

The absence of that field is the design. Every form of this kind invites a "valid until" control, and
one would have contradicted the story at the level of the data, not just the wording.

![Ask to be paid](../images/create-request.png)

## Step 2: Where it stands

Once asked, the request appears beside the ledger on `TallyHistory` — never in it — saying which way
it runs and how long it has been outstanding. Story 24's storyboard shows that view.

## Not shown

Following a request through its life — withdrawing it, watching it age, seeing it part-answered or
refused — is `RequestView` (stories 21 and 22), unsliced. So this screen can create a request but not
follow one.

A newcomer with no tally is offered a tally rather than a request (path A). `CreateInvitation` exists
and does exactly that, but nothing routes here to there yet.
