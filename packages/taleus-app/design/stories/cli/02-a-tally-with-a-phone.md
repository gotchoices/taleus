# A tally with a phone

Kyle tests the phone app against his laptop, without a second phone.

1. On the laptop, `invite --limit 500 --note "phone test"` makes an invitation and prints its link.
   He opens the link on the phone (pastes it into Scan, or scans a QR code he made of it), and
   the phone shows the terms.
2. The phone accepts. On the laptop, `tallies` lists the tally, forming, then offered.
3. `offer 1` shows the terms the phone proposed; `offer 1 accept` agrees to them. Both sides show
   the tally open.
4. The phone records a payment. `watch` on the laptop prints it as it arrives, with the balance
   after it.
5. He pays back: `pay 1 12.50 "lunch"`. The phone shows it.

The same works the other way round: `accept <link>` takes up an invitation the phone made.

## Acceptance

- [ ] Every step the phone sees, the laptop sees, and the reverse.
- [ ] Amounts are typed in the tally's unit, as written (`12.50` dollars); nothing is guessed.
