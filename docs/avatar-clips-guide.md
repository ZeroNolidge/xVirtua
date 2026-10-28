# Making a patient avatar: portrait and body-language clips

How we make a patient's face (for Simli) and their body-language clips (OpenArt),
from what we learned making Ray Kowalski. Follow it to get usable clips in one
or two tries instead of five.

## 1. The portrait (one image, used for everything)

Every clip starts and ends on this exact image, and the Simli face is built
from it, so get it right first.

- **Model:** GPT Image 2, text-to-image, 1:1, 2K, medium quality (about 35 credits each). Make 3 at once and pick one.
- **Must have:**
  - Faces the camera, looking straight into the lens at eye level.
  - Neutral expression, **mouth gently closed**.
  - Head and upper chest centred, a little space above the head, hands just visible (resting on knees) so fidgeting can show.
  - Soft, even light on the face, no harsh shadows; softly blurred clinic background.
  - "Realistic and unretouched, documentary style. No text, no logos."
- **Describe the person in detail:** age, background, job, build, hair, clothes (e.g. "58-year-old long-haul truck driver, light stubble, short graying brown hair, faded navy work jacket over a gray t-shirt").
- **Check before using:** eyes, teeth and hands look normal; nothing odd in the background.

Then upload the same image to Simli (create a face from a photo) and paste the
face ID into Faculty → Settings → Video avatar.

## 2. The clips

### Settings that worked

| Setting                       | Use                                                                      | Why                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Model                         | **Kling 3.0**, image-to-video                                            | Kept the mouth closed. Wan 3.0 opened the mouth as if talking, even when told not to.              |
| Start frame **and** end frame | The portrait, both                                                       | The clip starts and ends on the exact picture, so it cuts cleanly to and from the live Simli face. |
| Duration                      | **5 s** for expressions (frown, worry), 4 s for quick ones (nod, glance) | 4 s rushed the return to neutral.                                                                  |
| Resolution                    | std (720p)                                                               | Plenty for a phone; about 125 credits for 5 s.                                                     |
| Sound                         | **off**                                                                  | Sound makes models animate the mouth.                                                              |
| Versions                      | **2 per clip**                                                           | Usually one is clearly better; cheaper than redoing one at a time.                                 |
| Prompt extend (Wan only)      | off                                                                      | Keeps the model from adding talking or extra action.                                               |

### Prompt rules

1. **Start with the camera:** "Static locked-off camera, single continuous shot." Otherwise it zooms or pans.
2. **Say it's silent and the mouth stays closed, three ways:** "A silent, wordless moment… His mouth stays closed with his lips together the whole time; his jaw and lips do not move." Emotions like worry or doubt make models think the person is talking.
3. **One action per clip.** Say which part of the face or body moves ("Only his eyebrows and forehead move…").
4. **Give the timing:** how long it builds, how long it's held ("holds the frown for about two seconds"), then the return.
5. **Describe the ending expression exactly**, not just "back to neutral": "settles back into the same calm, neutral, slightly tired face as at the start, still a little uneasy." A vague ending came out as a smirk, like he was laughing to himself.
6. **Rule out the wrong emotion by name:** "He never smiles, never smirks, and shows no amusement: his cheeks do not lift and the corners of his mouth do not rise."
7. **Give the reason for the feeling** in one phrase ("he has just heard something about his health that worries him"). It makes the expression read right.
8. **Keep the rest still:** "Head and body still, hands resting on his knees. Same framing, lighting and background throughout."
9. **Subtle beats big:** "Subtle, realistic, natural motion." Big movements look fake and don't match the live face.

### Template

> Static locked-off camera, single continuous shot. A silent, [serious/uneasy] moment: [the reason for the feeling]. His mouth stays closed with his lips together the whole time; his jaw and lips do not move. [The one action: which part moves, how, and in what direction.] He holds it for about [1–2] seconds. Then [how it eases] and he settles back into the same calm, neutral[, slightly tired/uneasy] face as at the start. He never [the wrong emotion: smiles / smirks / laughs / talks]. Head and body still, hands resting on his knees. Subtle, realistic, natural motion. Same framing, lighting and background throughout.

### The cue set (matches the app's body-language cues)

| Cue                 | The one action to describe                                                              | Watch out for                                                    |
| ------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `look_away`         | Eyes and head turn slightly to one side and down, as if unsure; then back to the camera | A small mouth opening is OK here (a hesitation), but not talking |
| `frown`             | Brow furrows, eyebrows draw together and lift slightly in the middle; eyes narrow       | Smirking on the way back (rule 6)                                |
| `avoid_eye_contact` | Eyes drop to his hands or the floor and stay there longer; then slowly come back        | Head drooping too far, which makes it hard to cut back           |
| `fidget`            | Hands rub together or pick at the jacket zipper; the face stays uneasy                  | Hands looking odd: always check them                             |
| `nod`               | One or two small, slow nods of agreement, eyes on the camera                            | Talking while nodding                                            |
| `smile`             | A small, polite, closed-mouth smile that fades                                          | A big grin, or teeth showing                                     |

### Checking a clip

- Same person all the way through (face, hair, clothes)?
- Mouth closed (or only a brief hesitation for `look_away`)?
- Reads as the intended emotion, including the last second?
- Ends back on the starting pose, with no jump at the end?
- Hands and eyes look normal?

If a clip fails one check, change only the rule that covers it and make 2 new
versions. If the same model fails twice on the same check, try another model
(Kling 3.0 first, then Veo 3.1, which only makes 16:9 or 9:16, not square).
