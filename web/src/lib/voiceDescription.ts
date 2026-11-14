/**
 * The standard-voice library describes its voices for call centers
 * ("Confident, emotive British female for professional assistance"). Faculty
 * only need the part that says who it sounds like: age, gender, accent, tone.
 */
export function plainVoiceDescription(description: string, name = ''): string {
  let d = description.trim();
  // "Cora offers a helpful…" / "Offers a friendly…"
  d = d.replace(new RegExp(`^(${escape(name)}\\s+)?offers\\s+(a|an)\\s+`, 'i'), '');
  // Cut at the sales pitch: "for customer care…", "ideal for…", "perfect for…", "suited…".
  d = d.split(/\s+(?:for|ideal|perfect(?:ly)?|suited|designed|great)\b/i)[0] ?? d;
  d = d.replace(/[\s,;:–—-]+$/g, '');
  // When it says who the voice sounds like, drop the empty tone words around that.
  if (/\b(female|male|woman|man|adult|young|older|mature|senior|british|american|accent)\b/i.test(d))
    d = d
      .replace(/\b(approachable|helpful|articulate|poised|eloquent|polished|professional)\b,?\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[,\s]+|[,\s]+$/g, '');
  if (!d) return '';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
