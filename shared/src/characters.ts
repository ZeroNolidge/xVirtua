/**
 * The library of ready-made video characters: patients with their own Simli
 * faces (one per mood) and body-language clips (web/public/avatars/<slug>/).
 * Face IDs aren't secret; they only work with our Simli key, on the server.
 * A patient not listed here uses the program's face for their pronouns.
 */
/**
 * The patient's mood ladder, worst to best. They start guarded and move one
 * step at a time as the conversation goes (the video face follows).
 */
export const MOODS = ['upset', 'guarded', 'at_ease', 'happy'] as const;
export type Mood = (typeof MOODS)[number];

/** One step from `from` toward `to` (or `from` if they're the same). */
export function stepToward(from: Mood, to: Mood): Mood {
  const a = MOODS.indexOf(from);
  const b = MOODS.indexOf(to);
  return MOODS[a + Math.sign(b - a)] ?? from;
}

export interface VideoCharacter {
  name: string;
  /** Simli face for each mood (guarded is the start; others are optional). */
  faces: { guarded: string } & Partial<Record<Mood, string>>;
}

/** Folder name for a patient: "Ray Kowalski" → "ray-kowalski". */
export const characterSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const VIDEO_CHARACTERS: Record<string, VideoCharacter> = {
  'ray-kowalski': {
    name: 'Ray Kowalski',
    faces: {
      guarded: '04342b6e-bd80-4125-a926-761c68025194',
      at_ease: '8abb4a89-e5b6-42e2-ba92-717de4593d6b',
    },
  },
  'linda-shaffer': {
    name: 'Linda Shaffer',
    faces: {
      guarded: '7cc2fd4a-8472-445d-bac9-b2674d2eff31',
      upset: '2fc453f8-fac3-4519-aae5-45f44ff4658e',
    },
  },
};

/** The video character for this patient, if there is one. */
export function videoCharacterFor(name: string): VideoCharacter | null {
  return VIDEO_CHARACTERS[characterSlug(name)] ?? null;
}
