import type { Delivery } from '@plainspeak/shared';

const BASE = 'https://api.cartesia.ai';
const VERSION = '2025-04-16';
export const CARTESIA_MODEL = process.env.CARTESIA_MODEL ?? 'sonic-3';

// Our emotions -> Cartesia emotion names. Unknown ones fall back to neutral on retry.
const EMOTION: Record<Delivery['emotion'], string> = {
  neutral: 'neutral',
  worried: 'anxious',
  sad: 'sad',
  hesitant: 'hesitant',
  frustrated: 'frustrated',
  relieved: 'relieved',
  confused: 'confused',
};

const headers = (key: string) => ({
  'X-API-Key': key,
  Authorization: `Bearer ${key}`,
  'Cartesia-Version': VERSION,
  'Content-Type': 'application/json',
});

type Gender = 'masculine' | 'feminine' | 'gender_neutral';
const voiceCache = new Map<Gender, string[]>();

export function genderFor(pronouns: string): Gender {
  const p = pronouns.toLowerCase();
  if (p.startsWith('he')) return 'masculine';
  if (p.startsWith('she')) return 'feminine';
  return 'gender_neutral';
}

async function listVoices(key: string, gender: Gender): Promise<string[]> {
  const cached = voiceCache.get(gender);
  if (cached) return cached;
  const res = await fetch(`${BASE}/voices/?limit=100&gender=${gender}`, { headers: headers(key) });
  if (!res.ok) throw new Error(`Cartesia voices ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; language?: string }[] };
  const ids = (body.data ?? []).filter((v) => !v.language || v.language === 'en').map((v) => v.id);
  if (ids.length) voiceCache.set(gender, ids);
  return ids;
}

/** Stable voice per scenario, so a patient always sounds the same. */
export async function pickVoice(key: string, pronouns: string, seed: string): Promise<string> {
  let ids = await listVoices(key, genderFor(pronouns));
  if (!ids.length) ids = await listVoices(key, 'gender_neutral');
  if (!ids.length) throw new Error('No Cartesia voices available');
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ids[h % ids.length]!;
}

export async function synthesize(
  key: string,
  voiceId: string,
  text: string,
  d: Delivery,
): Promise<ArrayBuffer> {
  const body = (withEmotion: boolean) =>
    JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: text,
      voice: { mode: 'id', id: voiceId },
      language: 'en',
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      generation_config: {
        volume: d.volume === 'quiet' ? 0.7 : 1,
        speed: d.rate === 'slow' ? 0.85 : 1,
        ...(withEmotion ? { emotion: EMOTION[d.emotion] } : {}),
      },
    });
  let res = await fetch(`${BASE}/tts/bytes`, {
    method: 'POST',
    headers: headers(key),
    body: body(true),
  });
  if (res.status === 400) {
    // Emotion names vary by model/version; retry without it rather than fail.
    res = await fetch(`${BASE}/tts/bytes`, {
      method: 'POST',
      headers: headers(key),
      body: body(false),
    });
  }
  if (!res.ok) throw new Error(`Cartesia TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}
