# Scenario: Inviting someone to tally

Source: [01-invite-a-partner.md](../../../stories/mobile/01-invite-a-partner.md)

Jan has just explained tallies to Sam over lunch. Sam is across the table and does not have the app.

## Step 1: Terms, and nobody's name

The screen never asks who the invitation is for. Jan is setting out terms, and whoever accepts
becomes the other party — their identity arrives only from what *they* disclose when they respond.
The private note is a memo so Jan can tell his outstanding invitations apart; the screen says so,
because a label that looked like a recipient would be a claim.

His two numbers sit under one sentence: they bind only him, and the other party may extend nothing
back. The unit warns that it cannot be changed *before* he picks it, because step 5 has him think for
a second first. Only published agreements are offered — nobody sensible signs a stranger's custom
one.

![Invite someone](../images/create-invitation.png)

## Step 2: A party inviting for the first time

The same screen with nothing outstanding yet. This is where `TallyList`'s empty state now leads.

![The first invitation](../images/create-invitation-first.png)

## Step 3: Outstanding, and when it runs out

Once shared, Jan can see the invitation is outstanding and when it expires. Nothing is owed yet:
there is no tally until somebody responds. An expired one reads as expired and stops asking him for
anything.

## Not shown

**Sharing itself** (step 8) is not built — the token is displayed and selectable, and the screen says
so. Handing it over needs no engine, but it needs a decision about what is actually shared.

Re-issuing from the same setup (path A), withdrawing before a response (path B), and Mara's standing
invitation for a shop counter (path C) belong to `StandingInvitation`, which is unsliced. Step 10 —
Jan told that someone responded — is notification work.
