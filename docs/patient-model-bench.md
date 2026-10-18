# Patient model comparison (2026-10-18)

Same scripted resident lines, two scenarios (new high blood pressure, new type 2 diabetes),
6 resident turns each. Run with the **Vendor check** GitHub workflow; rerun any time.

| Model      | Typical reply time | Slowest (p90) | Cost per turn | Cost per 15-turn session |
| ---------- | ------------------ | ------------- | ------------- | ------------------------ |
| Opus 5.5   | 2.1 s              | 2.4 s         | $0.0038       | ~$0.06                   |
| Sonnet 5.5 | 1.7 s              | 2.4 s         | $0.0021       | ~$0.03                   |
| Haiku 5.5  | 1.0 s              | 1.3 s         | $0.0001       | ~$0.002                  |

Reply time is Claude only. Add ~0.9 s for the patient's voice (Cartesia) and the resident's pause
detection (~0.9 s of silence).

All three stayed in character, performed every scripted cue, and reacted realistically to the
jargon-heavy explanation. Examples:

- **Opus** (after the dense explanation): "Whoa, slow down, Doc. I caught high blood pressure and
  pills, and that's about it. What's a cerebro-whatever, and is that a stroke?"
- **Sonnet**: "Okay... I got lost somewhere in there. What does all that mean for me, exactly?"
- **Haiku**: "Okay, you lost me there. Heart attack, stroke... that's a lot of big words. Is this
  serious or not?"

Teach-back answers were realistically imperfect for the low-literacy patient (Linda), e.g. Opus:
"it means my sugar's too high, and I gotta stop the sodas, I guess. And maybe... I end up like my
mom."

Differences noticed:

- Opus adds the most texture (specific details, regional phrasing).
- Haiku once volunteered the hidden concern (dad's stroke) a turn early, before the resident asked.
- Sonnet sits in between.

Scenario note for review: in "New high blood pressure" the "I guess…" cue is set to fire at patient
turn 6. In this run that landed right when the resident asked for teach-back, so the patient said
"I guess… if you think I have to" instead of answering. A topic trigger (e.g. after the plan is
described) may fit better.
