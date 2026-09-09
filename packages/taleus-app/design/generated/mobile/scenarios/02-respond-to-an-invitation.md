# Scenario: Responding to an invitation

Source: [02-respond-to-an-invitation.md](../../../stories/mobile/02-respond-to-an-invitation.md)

Sam opens what Jan just shared. He has never used Taleus and has extended nothing to anyone.

Reachable two ways: the universal link a person is actually sent,
`https://sereus.org/taleus/invite/<token>`, and the `screen/ReviewInvitation/<token>` form used here.

## Step 1: What is being offered, before anything is asked

The order on this screen is the point of it. Sam sees who is inviting him, what Jan is willing to be
owed, how much notice Jan wants, what the tally counts in, and which agreement governs it — and the
screen tells him, at exactly the moment it is still true, that he has disclosed nothing so far.

Only below that is anything asked of him. Reversing the two would be the ordinary sign-up shape, and
would have him paying before knowing the price.

![An invitation](../images/review-invitation.png)

## Step 2: What he tells Jan, and what he is willing to be owed

His name is needed; his phone and address are offered and marked as his choice. What he is willing to
be owed by Jan defaults to zero, with the screen saying that zero is a normal answer he can change
later — Sam has no reason to extend Jan credit yet, and the story's own answer should not look like a
refusal.

Accept is inert until there is a name, and says why.

## Alternates

**Path C — too late.** An expired invitation is explained as expired, with a way to ask for another.
It is not an error state.

![Expired](../images/review-invitation-expired.png)

**Path B — refusing.** A refusal reaches Jan and ends *that offer*: it cannot be revived. The
relationship is not finished, and Jan can come back with different terms.

## Not shown

**Countering** — changing the terms, which makes it Sam's offer rather than his acceptance (path A) —
is story 03 and `ReviewOffer`, unsliced. The screen says so rather than showing a button.

Step 2, someone without the app being told what Taleus is, is the web page in `taleus/web`. Step 8,
Jan told what Sam disclosed and proposed, is notification work. Reading the agreement in full belongs
to `TallyTerms`.
