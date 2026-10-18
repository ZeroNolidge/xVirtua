/**
 * Real-vendor check, run from GitHub Actions (where the API keys live):
 *  1. Patient model bench: the same scripted resident lines through Opus 5.5,
 *     Sonnet 5.5 and Haiku 5.5. Reports latency, tokens, cost and transcripts.
 *  2. OpenAI: can we mint a transcription client secret with our config?
 *  3. Cartesia: can we list voices and synthesize a line (with emotion)?
 * Writes a Markdown report to $REPORT (default vendor-report.md).
 */
import { writeFileSync } from 'node:fs';
import {
  createJargonMatcher,
  decideCue,
  initialCueState,
  SEED_JARGON,
  type PatientModel,
} from '@plainspeak/shared';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import { ClaudeBrain, type BrainTurn } from '../functions/src/patient/brain.js';
import { buildPatientSystemPrompt, buildResidentMessage } from '../functions/src/patient/prompt.js';
import { mintClientSecret, STT_MODEL } from '../functions/src/voice/stt.js';
import { CARTESIA_MODEL, pickVoice, synthesize } from '../functions/src/voice/cartesia.js';

const MODELS: PatientModel[] = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
// $ per million tokens: input, output, cache read, cache write.
const PRICE: Record<PatientModel, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

const DENSE =
  'So what we are seeing is that your blood pressure readings are consistently elevated, which meets the criteria for hypertension. Over time, uncontrolled hypertension increases your cardiovascular risk, including myocardial infarction and cerebrovascular accident, and can also cause renal damage. The first-line approach is lifestyle modification, including sodium restriction and aerobic exercise, combined with an antihypertensive, typically a calcium channel blocker or an ACE inhibitor, titrated to a goal under 130 over 80, and we will monitor your labs and see you back in four weeks.';

const SCRIPTS: Record<string, string[]> = {
  'htn-new-diagnosis': [
    "Hi Ray, I'm Dr. Lee. Thanks for coming in. How have you been feeling?",
    DENSE,
    "I'd like to start a once-a-day pill called amlodipine.",
    "That's a really fair worry. Treated blood pressure usually helps you keep your DOT card, and I can help with the paperwork.",
    'Some people with high blood pressure end up having a stroke. Has anyone in your family had one?',
    "I'm sorry about your dad. That must have been hard. Can you tell me in your own words what we're going to do?",
  ],
  't2dm-new-diagnosis': [
    'Hi Linda, thanks for coming in. Your blood work is back. What have you heard so far?',
    DENSE.replace(/blood pressure/g, 'glucose').replace(/hypertension/g, 'diabetes mellitus'),
    'Can we talk about food and soda a little?',
    "This isn't your fault. Diabetes runs in families, and we can work on it together.",
    "I'd like to start a pill called metformin.",
    'Can you tell me in your own words what diabetes means for you?',
  ],
};

const env = (k: string) => process.env[k] ?? '';
const lines: string[] = ['# PlainSpeak vendor check', '', `Run: ${new Date().toISOString()}`, ''];
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

// ---------- 1. patient model bench ----------
async function bench() {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return lines.push('## Patient models', '', 'Skipped: ANTHROPIC_API_KEY not set.', '');
  const brain = new ClaudeBrain(key);
  const matcher = createJargonMatcher(SEED_JARGON);
  const summary: string[] = [
    '## Patient models',
    '',
    '| Model | Turns | Median latency | Slowest (p90) | Avg cost / turn | Est. cost / 15-turn session | Errors |',
    '|---|---|---|---|---|---|---|',
  ];
  const transcripts: string[] = [];
  for (const model of MODELS) {
    const lat: number[] = [];
    let cost = 0;
    let turns = 0;
    let errors = 0;
    for (const sc of SEED_SCENARIOS.filter((s) => SCRIPTS[s.id])) {
      transcripts.push(
        `### ${model} · ${sc.briefing.title}`,
        '',
        `> **Patient:** ${sc.script.openingLine}`,
        '',
      );
      const history: BrainTurn[] = [];
      let state = initialCueState();
      for (const text of SCRIPTS[sc.id]!) {
        const d = decideCue(sc.script.cueScript, state, text, matcher);
        state = d.next;
        const message = buildResidentMessage(text, d.cue);
        transcripts.push(
          `> **Resident:** ${text.length > 160 ? text.slice(0, 160) + '…' : text}`,
          '',
        );
        try {
          const r = await brain.reply({
            model,
            system: buildPatientSystemPrompt(sc.briefing, sc.script),
            history,
            message,
            cue: d.cue,
          });
          history.push(
            { speaker: 'resident', content: message },
            { speaker: 'patient', content: r.raw },
          );
          lat.push(r.latencyMs);
          const [pi, po, pr, pw] = PRICE[model];
          cost +=
            (r.usage.input * pi +
              r.usage.output * po +
              r.usage.cacheRead * pr +
              r.usage.cacheWrite * pw) /
            1e6;
          turns++;
          const u = r.utterance;
          const nv = u.nonverbal.length ? ` _(${u.nonverbal.join(', ')})_` : '';
          const cue = u.cueId ? ` \`cue: ${u.cueId}\`` : '';
          transcripts.push(
            `> **Patient:**${nv} ${u.text}${cue}  \n> <sub>${u.delivery.emotion}, ${u.delivery.volume}, ${r.latencyMs} ms</sub>`,
            '',
          );
        } catch (e) {
          errors++;
          transcripts.push(`> ⚠️ error: ${(e as Error).message}`, '');
        }
      }
    }
    const avg = turns ? cost / turns : 0;
    summary.push(
      `| ${model} | ${turns} | ${(pct(lat, 50) / 1000).toFixed(1)} s | ${(pct(lat, 90) / 1000).toFixed(1)} s | $${avg.toFixed(4)} | $${(avg * 15).toFixed(3)} | ${errors} |`,
    );
  }
  lines.push(
    ...summary,
    '',
    '<details><summary>Transcripts</summary>',
    '',
    ...transcripts,
    '</details>',
    '',
  );
}

// ---------- 2. OpenAI transcription ----------
async function openai() {
  lines.push('## OpenAI Realtime transcription', '');
  const key = env('OPENAI_API_KEY');
  if (!key) return lines.push('Skipped: OPENAI_API_KEY not set.', '');
  try {
    const t0 = Date.now();
    const r = await mintClientSecret(key);
    lines.push(
      `✅ Client secret minted for \`${STT_MODEL}\` in ${Date.now() - t0} ms (key starts \`${r.value.slice(0, 3)}…\`).`,
      '',
    );
  } catch (e) {
    const d = (e as { details?: { status?: number; detail?: string } }).details;
    lines.push(`❌ ${(e as Error).message}`, '', '```', d?.detail ?? '', '```', '');
  }
}

// ---------- 3. Cartesia ----------
async function cartesia() {
  lines.push('## Cartesia patient voice', '');
  const key = env('CARTESIA_API_KEY');
  if (!key) return lines.push('Skipped: CARTESIA_API_KEY not set.', '');
  try {
    const t0 = Date.now();
    const voice = await pickVoice(key, 'he/him', 'htn-new-diagnosis');
    const t1 = Date.now();
    const audio = await synthesize(
      key,
      voice,
      'So the nurse says my blood pressure is up again. Honestly, I feel fine.',
      {
        emotion: 'hesitant',
        volume: 'quiet',
        rate: 'slow',
        pauseBeforeMs: 0,
      },
    );
    lines.push(
      `✅ Model \`${CARTESIA_MODEL}\`, voice \`${voice}\`: voices listed in ${t1 - t0} ms; one line synthesized in ${Date.now() - t1} ms (${Math.round(audio.byteLength / 1024)} KB mp3).`,
      '',
    );
  } catch (e) {
    lines.push(`❌ ${(e as Error).message}`, '');
  }
}

await openai();
await cartesia();
await bench();
const out = process.env.REPORT ?? 'vendor-report.md';
writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
