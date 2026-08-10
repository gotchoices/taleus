# User Story: <descriptive title>

## Story Overview
As a <type of user>  
I want to <goal/action>  
So that <benefit/value>

Context: <optional additional context, prerequisites, user state, domain knowledge>

## Sequence
Write numbered steps focusing on **WHAT happens** (user goals + outcomes), not UI HOW.

Story 1:
- Sue has received a link in a text message from a friend inviting her to "tally"
- She doesn't know what that means, but she trusts her friend and so clicks the link
- She finds herself on a page that explains she must install a taleus


Story 2:
- Steve has followed the MyCHIPs project and so is eager to try out the new Taleus app
- Upon opening the app, he sees that he has no tally partners but he sees an icon that looks like he can use it to 


Seed (carried over from theory.md, where the narrative stops at the QR code):
- Jan shares an invitation — a QR code on his phone, or a link sent by text, email, or chat
- Sam scans it and lands on a sereus.org page describing Taleus, with a link to the app store
- He installs the app; it opens showing that he has been invited to tally with Jan, and offers to
  proceed or refuse
- Sam proceeds and is asked for basic identifying information (name, email, phone), with further
  fields (address, birthday) that appear optional; he supplies only the basics
- He lands on a home screen showing he has no money yet
- Jan, meanwhile, gets a notification that Sam has responded to his invitation
- (Open: neither has yet named a credit limit — that exchange is what turns a connection into a
  tally.  See `design/specs/domain/rules.md` § Credit.)

1. <User accomplishes first goal or takes first action>
2. <What happens as a result — from user's perspective>
3. <User's next goal or decision point>
4. <System enables or prevents something>
   - If <condition>, <alternative path>
5. <User reaches next milestone>
6. <Goal achieved or story continues to next story>

Guidance:
- Focus on user goals and functional outcomes
- Mention **inputs/outputs** (what the user provides and what they receive)
- Avoid implementation choices and internal architecture
- UI mentions are OK only when **user-observable** (“user selects an item”, not “tap the blue button”)
- Include empty/error cases when they matter

Numbering Convention:
- Use dotted notation (3.1, 3.2) for sub-steps within a main step that return to the next step
- Use main numbers (3, 4, 5) to replace entire sequence segments
- Example: Steps 3.1–3.3 occur after step 3, then flow returns to step 4

Alternative Path A: <name>
3.1. <sub-step or branch>  
3.2. <continue within this path>  
3.3. <implicit return to step 4>

Alternative Path B: <full replacement>
3. <replaces step 3>  
4. <replaces step 4>  
5. <resume or continue to step 6>

## Acceptance Criteria
- [ ] <specific, testable criterion>
- [ ] <another criterion>
- [ ] <empty/error handling requirement (if applicable)>
- [ ] <performance/usability requirement (if applicable)>

---

Notes:
- Write stories per target under `design/stories/<target>/`.
- Agents will derive screens/specs/consolidations from stories. Human specs in `design/specs/` override consolidations.


