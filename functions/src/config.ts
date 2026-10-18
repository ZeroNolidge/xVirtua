import { defineSecret } from 'firebase-functions/params';

export const REGION = 'us-east1';

// Vendor keys live in Secret Manager; the deploy job copies them from GitHub
// secrets. They are only bound to the functions that need them.
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
export const CARTESIA_API_KEY = defineSecret('CARTESIA_API_KEY');

/** Guard rails per session. */
export const LIMITS = {
  maxResidentTurns: 60,
  maxSessionMinutes: 20,
  maxTurnChars: 4000,
};
