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
  - **A truly neutral face: no smile at all.** Lips relaxed and closed, mouth corners level, cheeks not lifted, no smile lines at the eyes. For a worried patient, add only a faint hint of concern (eyebrows very slightly lifted in the middle). Every clip ends on this face, so even a slight smile makes every cue end in a smile. With Ray, a frown that relaxed into his slightly smiling portrait read as if he were laughing to himself.
  - If a portrait you like has a slight smile, don't start over: edit it with Nano Banana Pro (image-to-image, 2K, about 40 credits), asking it to change only the expression and keep everything else the same.
  - Head and upper chest centred, a little space above the head, hands just visible (resting on knees) so fidgeting can show.
  - Soft, even light on the face, no harsh shadows; softly blurred clinic background.
  - "Realistic and unretouched, documentary style. No text, no logos."
- **Describe the person in detail:** age, background, job, build, hair, clothes (e.g. "58-year-old long-haul truck driver, light stubble, short graying brown hair, faded navy work jacket over a gray t-shirt").
- **Check before using:** eyes, teeth and hands look normal; nothing odd in the background.

Then upload the same image to Simli (create a face from a photo) and paste the
face ID into Faculty → Settings → Video avatar.

### Make the clips from Simli's preview image, not your portrait

Simli crops and zooms each face its own way and shifts the lighting a little,
so clips made from your original portrait won't line up with the live face.
Once Simli has built the face:

1. Save Simli's preview image of the face (a screenshot cropped to the square is fine).
2. Upload that to OpenArt and use it as the start and end frame of every clip.
3. Use the same image as the poster (`guarded.jpg` / `at-ease.jpg`).

Simli crops closer than the portrait, so the hands are usually out of frame:
don't describe hand movements (fidget becomes a shift in the seat).

**Mood change clip** (e.g. guarded → at ease): the two Simli faces are zoomed
and shifted slightly differently (Ray: about 4% and 21 px). If Kling has to cover
that, it moves the face and opens the mouth (4 of 4 tries failed). Instead:

1. `python3 -I scripts/avatar-tools/align.py guarded.png at-ease.png out/` lines
   the at-ease image up with the guarded framing.
2. Make the clip in Kling from the guarded image to `out/at-ease-on-guarded-framing.png`,
   with "Static locked-off camera" and "his lips stay pressed gently together,
   sealed shut… he breathes calmly through his nose". Now it only changes the
   expression, and the mouth stays closed (2 of 2).
3. `python3 -I scripts/avatar-tools/warp.py clip.mp4 out/Mface.npy guarded-to-at-ease.mp4`
   adds the zoom smoothly, so the clip ends exactly on the at-ease Simli face.
   Copy it into the patient folder by hand (the asset workflow doesn't do this step).

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
3. **Never describe him as about to speak.** Phrases like "searching for words", "unsure how to answer" or "thinks of something to say" made Kling open his mouth. Use "quietly thinks to himself, not speaking and not about to speak", and end with "He does not talk, mouth words or take a breath to speak." Even a nod opened his mouth until that line was added.
4. **One action per clip.** Say which part of the face or body moves ("Only his eyebrows and forehead move…").
5. **Give the timing:** how long it builds, how long it's held ("holds the frown for about two seconds"), then the return.
6. **Describe the ending expression exactly**, not just "back to neutral": "settles back into the same calm, neutral, slightly tired face as at the start, still a little uneasy." A vague ending came out as a smirk, like he was laughing to himself.
7. **Rule out the wrong emotion by name:** "He never smiles, never smirks, and shows no amusement: his cheeks do not lift and the corners of his mouth do not rise."
8. **Give the reason for the feeling** in one phrase ("he has just heard something about his health that worries him"). It makes the expression read right.
9. **Keep the rest still:** "Head and body still. Same framing, lighting and background throughout." (Mention the hands only if they're in Simli's frame.)
10. **Subtle beats big:** "Subtle, realistic, natural motion." Big movements look fake and don't match the live face.

### Template

> Static locked-off camera, single continuous shot. A silent, [serious/uneasy] moment: [the reason for the feeling]. His mouth stays closed with his lips together the whole time; his jaw and lips do not move. [The one action: which part moves, how, and in what direction.] He holds it for about [1–2] seconds. Then [how it eases] and he settles back into the same calm, neutral[, slightly tired/uneasy] face as at the start. He never [the wrong emotion: smiles / smirks / laughs / talks]. Head and body still. Subtle, realistic, natural motion. Same framing, lighting and background throughout.

### The cue set (matches the app's body-language cues)

| Cue                 | The one action to describe                                                            | Watch out for                                                                         |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `look_away`         | Eyes drift to one side and down, "lost in an uneasy thought"; then back to the camera | Mouth opening: never say "searching for words" (rule 3)                               |
| `frown`             | Brow furrows, eyebrows draw together and lift slightly in the middle; eyes narrow     | Smirking on the way back (rule 6)                                                     |
| `avoid_eye_contact` | Eyes drop to his hands or the floor and stay there longer; then slowly come back      | Head drooping too far, which makes it hard to cut back                                |
| `fidget`            | Hands rub together, or (hands out of frame) shifts uneasily in the seat               | Hands looking odd; if hands are out of Simli's frame, use a shift in the seat instead |
| `nod`               | One or two small, slow nods of agreement, eyes on the camera                          | Talking while nodding                                                                 |
| `smile`             | A small, polite, closed-mouth smile that fades                                        | A big grin, or teeth showing                                                          |

### Checking a clip

- Same person all the way through (face, hair, clothes)?
- Mouth closed the whole time?
- Reads as the intended emotion, including the last second?
- Ends back on the starting pose, with no jump at the end?
- Hands and eyes look normal?

If a clip fails one check, change only the rule that covers it and make 2 new
versions. If the same model fails twice on the same check, try another model
(Kling 3.0 first, then Veo 3.1, which only makes 16:9 or 9:16, not square).
