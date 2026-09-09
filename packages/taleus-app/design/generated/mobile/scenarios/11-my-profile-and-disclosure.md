# Scenario: My profile and what I disclose

Source: [11-my-profile-and-disclosure.md](../../../stories/mobile/11-my-profile-and-disclosure.md)

Different people know different things about this party, and every one of them knows it because the
party chose to send it.

## Step 1: What I hold, which is not what anyone has

Two lists, and the separation is the story's promise: adding something to your own record does not
send it to anybody. Jan holds a name, a phone number, an email, an address and a business name. The
card says it in words as well — writing it down tells nobody.

Below, what each partner actually has. Sam has a name and a phone number from a lunch months ago;
Northwind Parts has the business name and address a supplier wanted; Mara's shop has a name, because
a shop needs no more.

![About me](../images/profile-happy.png)

## Step 2: A party who has told one person one thing

The `empty` world: a name, given to one person. Everything else is offered to fill in rather than
shown as a deficiency.

![Only a name](../images/profile-empty.png)

## Step 3: One relationship, both directions

What Jan told Northwind, when he told them, and what Northwind says about *themselves*. That second
half is their claim: Taleus has not checked any of it, and the screen says so rather than presenting
it as fact.

![Northwind](../images/disclosure-supplier.png)

## Step 4: Telling them more, without renegotiating anything

Step 7. On the tally as it stands — no new tally, no change to the terms — and the counterparty is
told something arrived, because this is not something to file silently into a record they may never
reread.

## Step 5: What is missing, and nothing more than that

Priya has told Jan only her name. The screen names what he does not have and stops there: whether
she would rather not say, or never wrote it down, does not reach him from her side, and the app does
not pretend otherwise. The word "withheld" appears nowhere.

Asking is the way past it, and asking is what turns a silence into a yes or a no.

![Priya](../images/disclosure-missing.png)

## Step 6: A refusal is an answer

Northwind wants a tax identifier. Jan does not hold one and is not willing — path A. "I would rather
not" sits beside "Send it" as an equal answer, and the note says what Northwind will see rather than
leaning on Jan to give in. Northwind remains free not to countersign; that is their answer, and Jan
is not told his information was rejected.

The same card runs the other way on [Dave's tally](taleus://screen/DisclosureView/tally%3Adave-hours?variant=happy):
Jan asked Dave for an address and Dave would rather not. That is an answer, and it is recorded as
one.

## Step 7: A correction goes only where it is authorized

Path D. Changing the phone number raises the set of partners who hold the old one — Sam and Dave,
not Mara, who never had it. Each is a statement Jan signs, so he picks who gets it; authorizing none
sends nothing and his own record still shows the new number.

The old statement stays. A correction is a new statement, not an erasure, and both remain visible to
both sides. In the `error` world Dave cannot be reached, and that is reported as not sent rather
than counted as sent.

## Also worth opening

- [Disclosure chosen at formation](taleus://screen/DisclosureView/tally%3Arae-offer?variant=happy) —
  on a tally not yet countersigned, marked as going with the offer rather than already sent.

## Not shown

Choosing what to disclose *while forming a tally* (steps 3–5): `CreateInvitation` and
`ReviewInvitation` were built before this slice and do not offer it yet, so the state exists in the
fixtures but not in that flow. An inviter stating what they expect to be disclosed belongs there
too. Path C — a standing invitation's disclosure being effectively public — belongs to
`StandingInvitation`. The notification a counterparty receives is story 43.
