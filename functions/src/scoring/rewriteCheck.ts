import { SEED_JARGON, tokenize } from '@plainspeak/shared';

/**
 * Rewrites may change how the resident says something, never add facts.
 * This flags a rewrite that brings in licensing / legal claims, drug names or
 * numbers the resident never said anywhere in the conversation.
 */

const LICENSING =
  /\b(licen[cs]es?|cdl|dmv|dot (physical|card|exam)|medical card|driving (card|record|privileges)|commercial driv\w*|fmcsa|permit|insurance|insurer|lawyer|attorney|legal(ly)?|lawsuit|liabilit\w*|disability|fmla|work note|employer must|they can't fire|can't fire you)\b/gi;

const DRUG_SUFFIX =
  /\b\w+(opril|ipril|epril|april|sartan|statin|olol|dipine|formin|gliptin|gliflozin|glutide|thiazide|mycin|cillin|floxacin|prazole|tidine|triptan|setron|parin|xaban|gatran)\b/gi;

const GENERIC_DRUGS = [
  'aspirin',
  'ibuprofen',
  'acetaminophen',
  'tylenol',
  'advil',
  'naproxen',
  'insulin',
  'metformin',
  'lisinopril',
  'losartan',
  'amlodipine',
  'atorvastatin',
  'rosuvastatin',
  'simvastatin',
  'hydrochlorothiazide',
  'hctz',
  'chlorthalidone',
  'furosemide',
  'lasix',
  'warfarin',
  'eliquis',
  'apixaban',
  'varenicline',
  'chantix',
  'bupropion',
  'wellbutrin',
  'zyban',
  'nicotine',
  'prednisone',
  'albuterol',
  'levothyroxine',
  'sertraline',
  'fluoxetine',
  'gabapentin',
  'ozempic',
  'semaglutide',
  'jardiance',
  'empagliflozin',
  'glipizide',
  'statin',
  'statins',
];

const medTerms = (() => {
  const out = new Set<string>(GENERIC_DRUGS);
  for (const t of SEED_JARGON) {
    if (t.category !== 'med') continue;
    for (const v of [t.term, ...t.variants]) out.add(tokenize(v).join(' '));
  }
  return [...out].filter(Boolean);
})();

const UNIT =
  '(mg|milligrams?|mcg|units?|percent|%|weeks?|months?|days?|years?|hours?|times|pills?|tablets?|points?|pounds?|lbs?)';
const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|half';
const NUMBERS = new RegExp(`\\b\\d+([.,/]\\d+)?\\b|\\b(${NUMBER_WORDS})\\s+${UNIT}\\b`, 'gi');

const has = (haystack: string, needle: string) =>
  ` ${tokenize(haystack).join(' ')} `.includes(` ${tokenize(needle).join(' ')} `);

/** Reasons a rewrite adds facts. Empty means it's fine. */
export function rewriteProblems(rewrite: string, residentSaid: string): string[] {
  const reasons: string[] = [];
  for (const m of rewrite.matchAll(LICENSING)) {
    if (!has(residentSaid, m[0])) reasons.push(`licensing/legal: "${m[0]}"`);
  }
  const lower = ` ${tokenize(rewrite).join(' ')} `;
  for (const d of medTerms) {
    if (lower.includes(` ${d} `) && !has(residentSaid, d)) reasons.push(`drug: "${d}"`);
  }
  for (const m of rewrite.matchAll(DRUG_SUFFIX)) {
    const w = m[0].toLowerCase();
    if (!has(residentSaid, w) && !reasons.some((r) => r.includes(`"${w}"`)))
      reasons.push(`drug: "${w}"`);
  }
  for (const m of rewrite.matchAll(NUMBERS)) {
    if (!residentSaid.toLowerCase().includes(m[0].toLowerCase())) reasons.push(`number: "${m[0]}"`);
  }
  return [...new Set(reasons)];
}
