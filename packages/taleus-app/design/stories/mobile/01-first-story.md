# User Story: <descriptive title>

## Story Overview
As a <type of user>  
I want to <goal/action>  
So that <benefit/value>

Context: <optional additional context, prerequisites, user state, domain knowledge>

## Sequence
Write numbered steps focusing on **WHAT happens** (user goals + outcomes), not UI HOW.

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


