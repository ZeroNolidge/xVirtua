# PlainSpeak — Plan

Status: **Approved with changes (round 1).** Decisions marked **❓** are still open; ✅ marks decided items.

## Decisions log

| # | Decision (2026-10-17) |
|---|---|
| D1 | **Speech-to-text = OpenAI Realtime API in transcription-only mode** (you already use it and it captures jargon well). A Function mints a short-lived client secret, so the OpenAI key stays server-side. Deepgram/AssemblyAI stay as backups behind `SttProvider`. |
| D2 | Residents **see numeric 0–100 scores** (for now), still with coaching-style copy. |
| D3 | **Bench all three models** (Opus 5.5, Sonnet 5.5, Haiku 5.5) for the patient brain in Phase 3. You pick by feel. The model is a per-program setting. |
| D4 | **Overall = equal 25% weights** across the four metrics. |
| D5 | **You review** the jargon dictionary and the 6 seed scenarios before residents see them. Seed content ships as `draft` until you approve it. |
| D6 | Check for understanding: **"Any questions?" = weak (partial credit); teach-back ("tell me in your own words…") = strong (full credit).** |
| D7 | Data **may be used at CCC review.** The consent screen says so plainly. |
| D8 | Retention: **audio 3 years, transcripts and scores 3 years** (both admin-configurable). |
| D9 | **HIPAA/BAA not required** (all patients are fictional). Vendors are chosen on accuracy, latency and price; BAA columns below are informational only. |
| D10 | Phase 3 includes a **transcription bake-off**: the same 10 jargon-heavy recordings through OpenAI Realtime, Deepgram Nova-3 and Soniox (~$0.002/min), comparing jargon caught, latency and cost. OpenAI stays the default unless another matches it. |
| D12 | (2026-10-18, supersedes D2) **Residents see a word plus a trend** ("Getting there, up from last time"), never 0–100 numbers. Exact scores live in a faculty-only record for the dashboard and Milestones export. Feedback = one strength + two fixes from two different areas; the rest behind "See all suggestions". |
| D13 | **Rewrites never add facts**: rubric v2 forbids new clinical, legal or licensing facts; a server check hides and flags rewrites that add licensing/legal terms, drug names or numbers the resident didn't say. |
| D14 | **Patient model default: Haiku 5.5** (fastest in the bench, stayed in character). Faculty can switch in Settings. |
| D15 | **Turn-taking must feel like a real exam room.** The "I'm not done" / "Send now" / tap-to-send controls are a temporary aid. Remove them once turn detection is natural enough: smarter end-of-turn detection (a model judging whether the resident sounds finished, not just silence) and letting the resident talk over the patient (full duplex, see the interruption note). |
| D16 | (2026-10-19) **Two-way voice, phase 1** (keeps Claude as the patient and Cartesia as the voice): semantic turn detection (OpenAI `semantic_vad`, falls back to silence), mic always on, talking over the patient stops them mid-sentence (they only "said" what was heard; scored under cue responsiveness), and speaking again before the reply plays replaces it. Echo guard: speech that repeats the patient's words is ignored. The countdown / "I'm not done" controls are gone; "Send: when I tap" stays as a fallback. |
| D17 | (2026-10-19) **GPT-Live test mode** (off by default; faculty turn it on in Settings, or per session on the briefing): OpenAI GPT-Live carries the call over WebRTC (full duplex) and asks us for every reply (client delegation), so Claude and the cue engine still write every word and scoring is unchanged. Our server connects the call (GPT-Live has no browser keys). We keep what GPT-Live actually said (`liveSpokenText`) to check how much it rewords lines. Falls back to the standard voice if it can't connect. |
| D11 | Defaults accepted: voice-first + Phase 8 avatar bake-off; all program faculty see all program residents; 5–8 min sessions, soft cap 12; ACGME export shows evidence only. |

Still open, with defaults I'll use unless you say otherwise:
- **Avatar path:** voice-first, Phase 8 bake-off, animated character as fallback.
- **Faculty visibility:** all program faculty see all program residents.
- **Session length:** 5–8 min target, soft cap at 12 min.
- **ACGME export:** evidence only, no auto-suggested level.
- **Jargon formula:** as in §4.

---

## 0. TL;DR

- **Stack as specified:** React + TypeScript + Vite PWA, Firebase (Auth, Firestore, Storage, Functions v2), Claude API server-side only.
- **Vendors:** OpenAI Realtime (transcription-only) for streaming speech-to-text ✅, Cartesia Sonic-3 for the patient voice (ElevenLabs as backup), and the **video avatar is deferred behind `PatientRenderer`** until a short bake-off passes.
- **⚠️ Avatar flag (you asked to be told before committing):** I found **no provider that documents on-demand control of discrete nonverbal actions** like "look away now" or "frown now." What exists:
  - **Anam** — "Director Notes": per-turn inline cue tags (e.g. `[worried]`, `[hesitant]`) plus an expressivity dial. Closest match to "scripted cues on demand." Gaze aversion is not documented.
  - **Tavus Phoenix-4** — 10+ controllable emotion states (sad, fear, etc.) steered through the LLM/prompt; no documented gesture/gaze API.
  - **HeyGen LiveAvatar, D-ID, Simli** — no documented expression control (D-ID reportedly none; Simli has idle-motion quality complaints).
  - **Voice-side cues are fully controllable today** (long pause, quieter voice, slower rate, hesitant tone, "I guess…"). So the voice-only renderer will deliver most of the cue value on day one.
  - **Recommendation:** build voice-only end to end, then run a 1-week bake-off (Anam vs Tavus) against a fixed 5-cue test script before paying for video. A fallback worth considering: a **stylized animated character** (Rive/Lottie state machine) whose looks-away/frown/quiet states we control 100%, at near-zero per-minute cost and very on-brand for a Duolingo-like tone.
- **No real patient data → no PHI.** A BAA is not legally required for the pilot, but resident audio is sensitive evaluative data, so I still prefer vendors that offer a BAA, no-training, and short/zero retention.
- **Estimated cost:** about **$0.63 per session voice-only**, about **$1.83 with a live video avatar**. At 12 sessions/resident/month that's roughly **$8 voice-only / $22 with video** per resident per month (details in §9).

---

## 1. Architecture

```
 Phone (PWA)                                     Google Cloud / Firebase
 ┌──────────────────────────┐                   ┌─────────────────────────────────────┐
 │ React UI                 │  Firebase Auth    │ Auth (email-link sign-in)           │
 │  • scenario picker       │◄─────────────────►│  + custom claims {role, programId}  │
 │  • briefing              │                   │                                     │
 │  • live session          │  Firestore SDK    │ Firestore  (rules-enforced reads)   │
 │  • score + feedback      │◄─────────────────►│                                     │
 │  • faculty dashboard     │                   │ Cloud Storage (audio)               │
 │                          │  upload audio     │                                     │
 │ MediaRecorder (mic)  ────┼──────────────────►│                                     │
 │                          │                   │ Cloud Functions v2 (Node 22, TS)    │
 │ STT (WebRTC) ────────────┼──► OpenAI Realtime│  • getSttToken  (short-lived secret)│
 │   (transcription only)   │                   │  • patientTurn  (streaming HTTP)    │
 │                          │  patientTurn      │      cue engine → Claude → TTS      │
 │ PatientRenderer ◄────────┼──────────────────►│  • endSession / scoreSession        │
 │   VoiceRenderer (v1)     │  audio stream     │  • invites, consent, exports        │
 │   VideoRenderer (later)  │                   │  • scheduled: audio retention       │
 └──────────────────────────┘                   │  Secrets: Secret Manager            │
                                                └─────────────────────────────────────┘
```

**Key choices**

- **API keys never reach the client.** The browser gets a short-lived OpenAI Realtime client secret from a Function and streams mic audio straight to OpenAI (WebRTC, transcription-only session; OpenAI's server-side voice detection marks end of turn) for lowest latency. OpenAI never generates the patient's words; Claude does. Claude and TTS are called only from Functions. Keys live in Secret Manager.
- **One conversational turn:**
  1. STT reports end of the resident's utterance.
  2. The client posts the transcript to `patientTurn`.
  3. The **cue engine** (our deterministic code) decides whether a cue fires.
  4. Claude produces the patient's line as structured JSON.
  5. The text streams sentence-by-sentence to TTS.
  6. Audio streams back to the `PatientRenderer`.
  - **Latency target:** under ~1.5 s to first patient audio. A brief pause reads as natural for a patient.
- **The server owns the transcript.** `patientTurn` writes both resident and patient turns to Firestore. The client cannot write turns, scores, XP or badges, so it can't fabricate them.
- **Cues are deterministic, not left to the LLM.** The scenario's cue script is evaluated in code after each resident turn. When a cue fires, Claude gets an explicit directive for that turn ("perform cue `goes_quiet`: reply only 'Okay…'"). The cue is also logged on the turn, so scoring knows exactly where cues fired.
- **Audio recording:** the resident's mic is recorded locally (MediaRecorder) and uploaded to Storage at session end as a resumable upload. Patient audio is not stored; it can be regenerated from text.
- **Mobile/PWA realities:**
  - iOS needs a tap before audio plays, so the session starts on a "Start conversation" button.
  - iOS MediaRecorder outputs mp4/aac rather than webm; both are accepted.
  - Hospital wifi can drop, so there's a reconnect/resume path.
  - Offline practice is out of scope for v1, but the service worker shell keeps that option open.

### 1.1 Swappable interfaces

```ts
// What the patient brain returns each turn (Claude structured output, validated)
interface PatientUtterance {
  text: string;                 // what the patient says (cue phrases already embedded)
  askedQuestion: boolean;       // used for steamrolling detection
  cueId?: string;               // cue being performed, if any
  delivery: {
    emotion: 'neutral'|'worried'|'sad'|'hesitant'|'frustrated'|'relieved'|'confused';
    volume: 'quiet'|'normal';
    rate: 'slow'|'normal';
    pauseBeforeMs: number;      // we enforce this ourselves, so it works with any vendor
  };
  nonverbal: Array<'look_away'|'frown'|'nod'|'fidget'|'avoid_eye_contact'|'smile'>;
}

interface PatientRenderer {
  mount(el: HTMLElement): Promise<void>;
  speak(u: PatientUtterance, audio: ReadableStream<Uint8Array> | null): Promise<void>;
  setListening(listening: boolean): void;   // idle/listening state
  interrupt(): void;                        // resident talks over patient
  capabilities(): { video: boolean; nonverbal: PatientUtterance['nonverbal'] };
  dispose(): void;
}
```

- **v1 `VoiceRenderer`** plays TTS audio and shows a calm illustrated portrait. Nonverbal cues show as subtle captions, e.g. *(looks away)*.
- **`AnamRenderer` / `TavusRenderer`** come later. Video providers that generate their own voice receive `text` plus provider cue tags instead of our audio.
- Speech-to-text (`SttProvider`) and text-to-speech (`TtsProvider`) sit behind the same kind of interface, so vendors can be swapped.

---

## 2. Data model (Firestore)

`programId` is on every document from day one, so multi-program support later is a rules/UI change, not a migration.

| Collection | Key fields | Written by |
|---|---|---|
| `programs/{programId}` | name, timezone (default `America/New_York`), audioRetentionMonths (36), transcriptRetentionMonths (36), scoringWeights (equal), patientModel, currentRubricVersion | faculty (admin) |
| `invites/{emailLower}` | programId, role, invitedBy, status, createdAt | faculty via Function |
| `users/{uid}` | programId, role, displayName, email, consent `{version, acceptedAt}`, createdAt | Function (role/program); user (displayName only) |
| `userProgress/{uid}` | xp, streak `{current, longest, lastDayLocal}`, badges[] `{id, earnedAt}`, scenariosCompleted[], cuesCaught | Functions only |
| `userStats/{uid}` | sessionsCompleted, avg per metric, rolling trend, weakest metric, recurringJargon `{term: count}` | Functions only (dashboard rollup) |
| `scenarios/{scenarioId}` | programId, status `draft\|active\|archived`, currentVersion, title, difficulty, tags | faculty |
| `scenarios/{id}/versions/{v}` | **immutable** snapshot: persona, healthLiteracy, emotionalState, hiddenConcern, briefing, learningObjectives[], cueScript[], openingLine | faculty via Function |
| `sessions/{sessionId}` | uid, programId, scenarioId, scenarioVersion, status, startedAt, endedAt, durationSec, audioPath, latestRubricVersion, overall | Functions only |
| `sessions/{id}/turns/{n}` | idx, speaker `resident\|patient`, text, tStartMs, tEndMs, cueFired?, askedQuestion?, delivery? | Functions only |
| `sessions/{id}/scores/{rubricVersion}` | jargon, clarity, empathy, cue (each: score, evidence[] `{turnIdx, quote}`, rewrite, notes), overall, model, promptHash, createdAt | Functions only |
| `jargonTerms/{termId}` | term, variants[], plain[], contextException `{allowedIfExplained, note}`, category, programId (null = global) | faculty / seed |
| `auditLog/{id}` | actorUid, action (`view_transcript`, `play_audio`, `export`), targetUid, at | Functions only |

**Cue script entry** (inside a scenario version):

```ts
{
  id: 'quiet_after_dense',
  cue: 'Patient goes quiet and says only "Okay…"',
  trigger: { type: 'resident_turn_words_gt', value: 80 }
         | { type: 'jargon_in_turn_gte', value: 2 }
         | { type: 'turn_index', value: 3 }
         | { type: 'topic_mentioned', topics: ['medication','pill'] }   // keyword match first, Claude classifier fallback
         | { type: 'no_understanding_check_for_turns', value: 3 },
  maxFires: 1,
  performance: { say: 'Okay…', delivery: { volume: 'quiet', pauseBeforeMs: 2500, emotion: 'hesitant' }, nonverbal: ['look_away'] },
  expectedResidentResponse: 'Pauses, checks in on feelings or understanding ("That was a lot — what questions do you have?")',
}
```

Rubric versioning:
- Each score doc is keyed by rubric version (e.g. `2026-11-v1`) and stores the model ID and a hash of the prompt.
- Rescoring with a new rubric adds a new doc and never overwrites the old one.
- Dashboards filter to one rubric version, so trends stay comparable.

---

## 3. Auth & security rules approach

- **Sign-in:** Firebase email-link (passwordless). This fits an invite-only pilot and works well on phones.
- **Closed pilot:**
  - Faculty create invites through a Function.
  - On first sign-in, `claimInvite` checks that an invite exists for the email.
  - If it does, the Function sets **custom claims `{role, programId}`** and creates `users/{uid}`.
  - If not, the account is disabled and deleted.
  - Optional upgrade: a `beforeUserCreated` blocking function rejects uninvited emails before the account exists. This requires upgrading Firebase Auth to Identity Platform (free at our scale).
- **Consent gate:**
  - The app routes to the consent screen until `users/{uid}.consent.version == CURRENT_CONSENT_VERSION`.
  - The screen explains: audio and transcripts are recorded; who sees them (you, and faculty in your program); retention (3 years); and that summaries **may be brought to Clinical Competency Committee review** (✅ D7).
  - Bumping the version re-prompts everyone.
- **Rules principles:**
  - Default deny.
  - Role and program come from **token claims** only, never from client-writable fields.
  - Residents: read their own `users`, `userProgress`, `userStats`, `sessions/**` and audio. Read active scenarios and jargon for their program. **No writes** except their own display name and consent acceptance; consent goes through a Function, so it's validated.
  - Faculty: read everything where `resource.data.programId == request.auth.token.programId`; write scenarios, jargon and program settings for their program.
  - Server-owned collections (sessions, turns, scores, progress, stats, audit) are written only via the Admin SDK. Rules deny all client writes.
  - Storage path `audio/{programId}/{uid}/{sessionId}/recording.{webm|m4a|mp4|ogg}`: the owner may create once (size ≤ 25 MB, `audio/*` content type, and the session must exist and belong to them, checked via `firestore.get`). Read is allowed to the owner or same-program faculty. No client deletes.
- **Rules tests:** `@firebase/rules-unit-testing` against the emulator, run in CI. Every collection gets an allow/deny matrix (resident-self, resident-other, faculty-same-program, faculty-other-program, unauthenticated, forged-claims attempts).

---

## 4. Scoring design

Runs in `scoreSession` (triggered at session end; can be re-run for a new rubric version).

1. **Jargon avoidance (deterministic)**
   - Normalize and tokenize resident turns.
   - Longest-match phrase matching against terms and variants (so "high blood pressure" isn't flagged as "blood pressure").
   - `contextException.allowedIfExplained`: a term followed within ~12 words by an explanation marker ("which means", "that's when", "in other words") is shown as "nice — you explained it" and not penalized.
   - Proposed formula: `100 − 8 × unique unexplained terms − 2 × repeat uses`, floored at 0. ❓
   - UI: each flagged word with its plain swaps.
   - The Realtime transcription `prompt` is seeded with the scenario's likely jargon terms, so they're transcribed correctly rather than mangled.
2. **Logical clarity, 3. Empathy, 4. Cue responsiveness (Claude)**
   - One structured-output call (`claude-opus-5-5`, adaptive thinking, effort `high`, JSON schema via `output_config.format`).
   - Inputs:
     - numbered transcript
     - scenario objectives
     - the list of cues that fired, with each cue's expected response
     - patient turns flagged `askedQuestion`
     - the rubric text
   - Output per metric: `score`, `evidence[] {turnIdx, quote}`, `whatWentWell`, `tryThisInstead {original, rewrite}`.
   - Cue output also includes `cueResults[] {cueId, addressed, quote}` and `steamrolls[] {patientTurnIdx, residentTurnIdx}`.
   - **Quote validation:** every quote must appear verbatim (after whitespace normalization) in the cited turn. If any quote doesn't, retry once; if it still fails, store the score marked `needsReview`.
   - **Cue proxies first:** a cue counts as "caught" if the resident's next turn addresses it (judged by Claude against the expected response). A steamroll is flagged when the patient asked a question and the resident's next turn didn't answer it.
   - The steamroll judgment is backed by a cheap deterministic hint: the next turn doesn't overlap the question's key nouns and runs more than 40 words.
   - **Check for understanding (✅ D6):** "Any questions?" / "Does that make sense?" earns partial credit. Teach-back ("Can you tell me in your own words…") earns full credit. The rewrite suggests teach-back when it's missing.
5. **Overall ✅:** equal 25% weights. Weights are stored per program so they can change later; scores record the weights used.
6. **Feedback screen (coaching tone):**
   - Lead with one specific strength.
   - Then **one** focus area with a "try saying this instead" line.
   - Then details on tap.
   - Copy is never "wrong"/"fail". Residents see numeric 0–100 scores (✅ D2).

---

## 5. Gamification (v1, light)

- **XP:**
  - +20 per completed session (minimum 2 minutes and 4 resident turns, to prevent farming).
  - +1 per 5 overall points above 60 (max +8).
  - +5 per cue caught.
- **Streak:** at least one completed session per local calendar day in the program's timezone. A grace "streak freeze" is not in v1.
- **Badges (computed in `scoreSession`):**
  - First Session
  - First Jargon-Free Explanation (jargon = 100)
  - Cue Catcher (5 cues caught total)
  - 7-Day Streak
  - Full Rotation (all 6 seed scenarios)
  - Steady Hands (3 sessions in a row with zero steamrolls)
- **Architected-for-later:** badges and XP rules live in one `progressRules.ts` module. Quests, leagues and mastery would hook into the same session-scored event.

---

## 6. Faculty dashboard & ACGME export

- **Resident list:** sessions completed, average per metric, 30-day trend arrow, weakest metric, last active.
- **Resident detail:**
  - trend chart per metric
  - session history
  - transcript viewer with evidence highlights
  - audio playback (signed URL, logged to `auditLog`)
  - recurring jargon words
- **Cohort:** averages and distributions across the program's residents.
- **Scenario editor:**
  - create, edit, duplicate, archive
  - every save makes a new immutable version
  - a "preview as patient" text-only test chat
- **Settings:** audio retention months, scoring weights, invite residents/faculty.
- **ACGME export (per resident, date range):** PDF and CSV generated in a Function.
  - Contents: session count, metric averages and trend, mapped sub-competency evidence (below), representative quoted strengths and growth areas, and recurring jargon.
  - The PDF header states it is **formative practice data to inform CCC discussion, not a milestone rating.**

### 6.1 Proposed Milestones mapping — ❓ needs your approval

Family Medicine Milestones 2.0 has three Interpersonal & Communication Skills sub-competencies:

- **ICS-1: Patient- and Family-Centered Communication**
- ICS-2: Interprofessional and Team Communication
- ICS-3: Communication within Health Care Systems

Only **ICS-1** is observable in this app. ICS-2 and ICS-3 will be listed as "not assessed."

ICS-1 has three threads in its intent statement: relationship, barriers, and organizing communication / shared decision-making. Proposed mapping:

| ICS-1 thread (from the FM supplemental guide intent) | App evidence |
|---|---|
| Uses language and behaviors to form constructive relationships with patients | **Empathy** score + quotes |
| Identifies and minimizes communication barriers, incl. complex barriers such as **health literacy** (Level 2) | **Jargon avoidance** + **Logical clarity** (incl. check for understanding), weighted toward low-literacy scenarios |
| Recognizes and responds to patient cues; organizes communication around patient values / shared decision-making (Levels 3–4) | **Cue responsiveness** (cues caught, steamrolls) + clarity's "what you do" step |

Proposal: the export shows **evidence per thread**, not an auto-assigned level. Optionally it could add a faculty-editable "suggested level band" (e.g. "evidence consistent with Level 2–3"); I recommend **not** auto-suggesting levels in v1. ❓

> Verification note: the sub-competency names and intent come from the ACGME Family Medicine Milestones / Supplemental Guide documents. My network sandbox couldn't open the PDFs directly, so I worked from search excerpts of the official text. **Please have someone confirm against the current PDF** (acgme.org/globalassets/pdfs/milestones/familymedicinemilestones.pdf) before we put exact level wording in the export.

---

## 7. Data, privacy, retention

- All patients are fictional. The seed and editor UI say so, and the scenario editor warns against entering real patient details.
- **Scheduled Function (daily) ✅ D8:**
  - Deletes audio older than `program.audioRetentionMonths` (default 36), sets `session.audioPath = null`, and logs the deletion.
  - Deletes transcripts (turns) and scores older than `program.transcriptRetentionMonths` (default 36). Only anonymous aggregate stats are kept, so cohort trends survive.
- Claude: no training on API data by default; we'll request zero data retention for the org if available.
  - Opus 5.5 works under zero retention. Some newer "Covered Models" require 30-day retention, which is another reason to stay on Opus/Sonnet here.
- BAAs (not required since there's no PHI, but nice to have):
  - Google Cloud's BAA covers Firestore, Cloud Storage and Cloud Functions.
  - Plain Firebase Auth isn't on the list; Identity Platform is. Irrelevant without PHI.
  - OpenAI offers an API BAA (with zero-retention eligibility); Deepgram and AssemblyAI do too; ElevenLabs on higher tiers; Cartesia unconfirmed.

---

## 8. Vendor research

Prices are list or pay-as-you-go as reported in Sept–Oct 2026 sources. Many are vendor-published, so treat them as directional. The first step of Phase 3 and Phase 8 is a quick bench test on real phone audio.

### (a) Streaming speech-to-text

| Provider | Streaming latency | Cost/min | BAA | Notes |
|---|---|---|---|---|
| **OpenAI Realtime (transcription-only)** ✅ D1 | low; streaming deltas + server voice detection | ~$0.017/min live (batch transcribe models ~$0.003–0.006) — verify on OpenAI's pricing page | Yes (API BAA) | Your team already uses it; captures jargon well. Ephemeral client secrets; WebRTC from the browser. Transcription prompt can be seeded with terms. |
| Deepgram Nova-3 (Medical) | ~300–500 ms (benchmarks disagree) | ~$0.0077 (Medical model may cost more — verify) | Yes | Backup. Medical vocabulary + key-term boosting. Temporary browser tokens. |
| AssemblyAI Universal Streaming | ~300 ms P50 (AssemblyAI-published benchmark) | ~$0.0075 | Yes | Strong alternative, slightly better WER in one benchmark. Key-term prompting. |
| Browser Web Speech API | low | free | No | Inconsistent on iOS, no medical vocabulary. Dev fallback only. |

**Pick:** OpenAI Realtime behind `SttProvider`. Deepgram/AssemblyAI remain swap-in backups.

### (b) Text-to-speech (patient voice)

| Provider | Latency (time to first audio) | Cost | BAA | Cue control |
|---|---|---|---|---|
| **Cartesia Sonic-3** ✅ | ~100–270 ms measured (sub-90 ms vendor claim) | ~$37–50 / 1M chars (≈ $0.04–0.05 per min of patient speech) | Not confirmed | Explicit **volume, speed, emotion** (incl. *hesitant, sad, scared, apologetic*), pauses. Supported by Anam. |
| ElevenLabs Flash v2.5 / v3 | ~75–185 ms (Flash) | ~$60–120 / 1M chars | Yes (Business/Enterprise) | v3 audio tags (sighs, whispers). Flash is fastest; v3 is more expressive but slower. |
| Deepgram Aura-2 | low | low | Yes | Fewer emotion controls. |

**Pick:** Cartesia Sonic-3, because explicit volume, speed and emotion controls map directly onto our `delivery` field. ElevenLabs is the backup behind `TtsProvider`. `pauseBeforeMs` is enforced by our player, so it works with either.

### (c) Real-time video avatar

| Provider | Latency | Cost/min | BAA / compliance | **Scripted nonverbal cues?** |
|---|---|---|---|---|
| **Anam** | ~180 ms median server-side (vendor) | ~$0.11–0.16 | Claims HIPAA + SOC 2 Type II (secondary sources) | **Partial — best fit.** Director Notes: per-turn inline cue tags + 0–1 expressivity; needs an expressive TTS (Cartesia/ElevenLabs). Emotion/delivery yes; gaze/look-away **not documented**. |
| **Tavus (Phoenix-4)** | sub-600 ms (vendor) | plan-based (Starter $59/mo, Growth $397/mo + usage) | HIPAA on enterprise tier; BAA via sales | **Partial.** 10+ emotion states controllable via LLM/prompt; `echo` (speak exact text), `interrupt`, `overwrite_context` events. No documented gesture/gaze control. |
| HeyGen LiveAvatar | — | ~$0.09–0.19 | Not found | No documented expression control. |
| D-ID Agents | — | ~$0.78 (estimate) | — | Reportedly **no** controllable facial expressions. |
| Simli | <300 ms (video stage only) | unpublished | — | Reviewers flag mechanical idle/eye motion. |

**Verdict:**
- Emotional *tone* on video (worried, sad, hesitant face) is achievable with Anam or Tavus.
- *Discrete, timed actions* (look away now, frown now, avoid eye contact) are **not reliably supported anywhere I could verify**.
- Since that control is the main reason for the avatar, I recommend:
  1. Ship voice-only first (Phases 3–7).
  2. **Phase 8 bake-off:** Anam vs Tavus on a fixed script of 5 cues (look away, hesitate, frown, 3-second silence, quieter voice), scored by you or a faculty member on phone video.
  3. If neither passes, use the **stylized animated character**: our own Rive state machine with explicit look-away, frown and fidget states, which is fully scriptable at ~$0/min.

---

## 9. Cost estimate (per session ≈ 8 min, patient speaking ~3 min, ~15 turns)

| Item | Assumption | $/session |
|---|---|---|
| STT | OpenAI Realtime, 8 min × ~$0.017 | 0.14 |
| TTS | ~2,700 chars × ~$50/1M | 0.14 |
| Claude patient brain | Opus 5.5, effort low, cached system prompt; ~15 turns × ~$0.011 | 0.17 |
| Claude scoring | Opus 5.5, effort high; ~7k in / ~6k out (incl. thinking) | 0.15 |
| Firebase (Firestore, Storage ~2 MB/session, Functions) | pilot scale | ~0.02 |
| **Voice-only total** | | **≈ $0.63** |
| + Video avatar | 8 min × ~$0.15 | +1.20 → **≈ $1.83** |

Per resident per month at 12 sessions: **≈ $8 voice-only, ≈ $22 with video**. Using Haiku 5.5 for the patient brain would save ~$0.16/session. Three years of audio storage is negligible (~2 MB/session). The README will include a calculator table. Claude prices: Opus 5.5 $4 / $20 per M tokens in/out, $0.20 cached reads.

---

## 10. Open questions (clinical / pedagogical / product) ❓

> Round 1 answered #1 (bench all three), #2 (numbers), #3 (equal weights), #4 partly (you review the list), #5 partly (any-questions weak / teach-back strong), #7 (you), #8 (3 years each), #10 (CCC use OK). See the Decisions log at the top. Remaining: #4 formula and exceptions, #5 order firmness, #6, #9, #11, #12.

1. **Patient-brain model.** My default is Opus 5.5 at low effort for in-character quality. Sonnet 5.5 or Haiku 5.5 would cut latency and cost (Haiku: ~$0.01/session for the patient brain). Want me to bench all three and let you choose by feel?
2. **Do residents see raw 0–100 numbers?** Or friendlier bands ("Getting there / Solid / Crushing it") with numbers only for faculty? Given the anxiety point, I lean toward bands plus a progress ring for residents and numbers for faculty.
3. **Overall score weights:** equal (25% each), or weight cue responsiveness/empathy higher?
4. **Jargon:**
   - OK with my draft formula (§4)?
   - Who on faculty will review the ~300-term dictionary? I'll draft it, but it needs a clinician's eye.
   - Context exceptions: terms like "diabetes" or "cholesterol" are arguably fine if explained. Should those be exceptions or not flagged at all?
5. **Clarity rubric:**
   - Is the order (what it is → why it matters → what we'll do → what you do) a firm expectation or a guideline?
   - Should "any questions?" count as a check for understanding, or only teach-back style checks ("Can you tell me in your own words…")? I'd give partial credit to the former.
6. **ACGME mapping (§6.1):** approve the mapping? Evidence only, or also a faculty-editable suggested level band?
7. **Scenario clinical sign-off:** who reviews the 6 seed scenarios (persona, hidden concern, cue scripts, learning objectives) before residents see them?
8. **Retention:** audio 12 months. Should transcripts and scores be kept indefinitely (useful for longitudinal research later) or expire too?
9. **Faculty visibility:** can all program faculty see all residents (as written), or only residents assigned to them? The data model supports either.
10. **Consent wording:** is this practice data explicitly *not* used for formal evaluation, or may faculty use it at CCC? (The ACGME export implies the latter, so the consent screen must say so.)
11. **Session length:** target 5–8 minutes with a soft cap at 12?
12. **Avatar path:** OK with voice-first plus a Phase 8 bake-off, with the animated character as fallback?

---

## 11. Phases (stop and review after each)

| # | Phase | Delivers | How you'll test |
|---|---|---|---|
| 0 | **Scaffold** | Vite React TS PWA (mobile-first shell, routing, design tokens), Firebase config, emulator suite, ESLint/Prettier/Vitest, CI, Functions TS workspace, Secret Manager wiring | `npm run dev` + emulators boot; lint/tests green |
| 1 | **Auth, invites, roles, consent + security rules** | Email-link sign-in, invite claim → custom claims, consent screen, role-based routing, first rules + **rules test suite** | Sign in as invited/uninvited users in emulator; rules tests pass |
| 2 | **Content: scenarios + jargon** | Scenario/version schema, 6 seed scenarios (draft for your clinical review), ~300-term jargon seed, scenario picker, briefing screen, **plain-word lookup** | Browse scenarios, open briefings, search the dictionary |
| 3 | **Live conversation (voice-only)** | OpenAI Realtime client secret + streaming transcription, `patientTurn` (cue engine + Claude patient + TTS streaming), `VoiceRenderer`, recording + upload, server-written transcript, end session, **patient-model bench (Opus 5.5 / Sonnet 5.5 / Haiku 5.5: latency, cost, in-character quality)** | Hold a full conversation on your phone; see cues fire; transcript and audio saved; switch models in settings and compare |
| 4 | **Scoring + feedback** | Deterministic jargon scorer (unit-tested), Claude rubric scoring with structured output + quote validation, rubric versioning, coaching-style results screen | Complete a session → results with quotes and rewrites; rescore with a new rubric version |
| 5 | **Gamification** | XP, streaks (timezone-aware), badges, light celebration animations | Seed sessions across days → streak/badges update |
| 6 | **Faculty** | Resident list, resident detail (trend chart, transcripts, audio, recurring jargon), cohort view, scenario editor (create/edit/duplicate/archive with versions), program settings, invites | Sign in as faculty; manage a scenario; review a resident |
| 7 | **ACGME export + retention** | PDF/CSV export per resident by date range, audio + transcript retention scheduled Function (3-year defaults), audit log | Export for a demo resident; run retention with a short window in emulator |
| 8 | **Video avatar bake-off + integration** | 5-cue test harness, Anam & Tavus renderers (or Rive fallback), pick one and wire it behind `PatientRenderer` | Watch the cue test videos; choose |
| 9 | **Seed, docs, deploy** | Seed script (scenarios, jargon, demo faculty + 3 demo residents with realistic history), README (setup, env vars, deploy, cost calculator), production deploy checklist | Fresh clone → seed → demo walkthrough |

---

## 12. Architected for later (not built in v1)

| Future feature | What v1 does to keep it open |
|---|---|
| Teach-back mode, side-by-side model replay | Scenario `mode` field; turns carry timestamps for replay alignment |
| Cross-session coach ("you keep saying 'utilize'") | `userStats.recurringJargon` and evidence history already stored |
| Leagues, quests, timed challenges, skill tree, mastery | All progress flows through a single `onSessionScored` rules module |
| Push notifications | PWA service worker in place; FCM can be added |
| Offline practice | App shell cached; scenario data can be cached later |
| Multi-tenant | `programId` on every doc + in claims; rules already program-scoped |
| Audio-based cue detection (tone, hesitation) | Raw audio retained; per-turn timestamps |
| Research analytics | Immutable scenario versions + rubric-versioned scores; BigQuery export extension later |

---

## Sources

- Tavus: [Phoenix-4 launch](https://www.tavus.io/blog/phoenix-4-real-time-human-rendering-with-emotional-intelligence), [MarkTechPost on Phoenix-4](https://www.marktechpost.com/2026/02/18/tavus-launches-phoenix-4-a-gaussian-diffusion-model-bringing-real-time-emotional-intelligence-and-sub-600ms-latency-to-generative-video-ai/), [Interaction events](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview), [HIPAA blog](https://www.tavus.io/blog/hipaa-compliant-ai-video-patient-conversations), [pricing summary](https://www.therundown.ai/tools/tavus)
- Anam: [Director Notes](https://anam.ai/docs/personas/director-notes), [SDK events](https://docs.anam.ai/concepts/events), [site](https://anam.ai/)
- Avatar comparisons: [Akapulu pricing index (Sept 2026)](https://blog.akapulu.com/p/real-time-avatar-api-pricing-index/), [toughtongueai comparison](https://www.toughtongueai.com/blog/best-virtual-avatar-solutions-2026), [Anam's D-ID review](https://anam.ai/blog/d-id-api-review-2025-architecture-capabilities), [Spatius LiveAvatar alternatives](https://www.spatius.ai/blog/liveavatar-alternatives-2026/), [HeyGen LiveAvatar pricing](https://selviaai.com/heygen-pricing-explained)
- STT: [AssemblyAI on Deepgram alternatives (Hamming benchmark)](https://www.assemblyai.com/blog/deepgram-alternatives), [Deepgram pricing breakdown](https://deepgram.com/learn/speech-to-text-api-pricing-breakdown-2025), [Future AGI STT guide](https://futureagi.substack.com/p/speech-to-text-apis-in-2026-benchmarks)
- TTS: [Gradium TTS comparison](https://gradium.ai/content/how-to-pick-tts-provider-elevenlabs-cartesia-openai), [Cartesia volume/speed/emotion docs](https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion), [Cekura TTS ranking](https://www.cekura.ai/blogs/best-tts-for-ai-voice-agents), [theplanettools comparison](https://theplanettools.ai/compare/elevenlabs-vs-cartesia)
- ACGME: [FM Milestones](https://www.acgme.org/globalassets/pdfs/milestones/familymedicinemilestones.pdf), [FM Supplemental Guide](https://www.acgme.org/globalassets/pdfs/milestones/familymedicinesupplementalguide.pdf), [Harmonizing ICS](https://www.acgme.org/globalassets/pdfs/milestones/harmonizingics.pdf)
- Claude data retention / BAA (secondary): [IntuitionLabs](https://intuitionlabs.ai/articles/is-claude-hipaa-compliant)
