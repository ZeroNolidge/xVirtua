import { PREFERRED_NAME_MAX } from '@plainspeak/shared';

/** "What should we call you?" (required, up to 40 characters). */
export function NameField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <label className="field">
      <span>What should we call you?</span>
      <input
        type="text"
        required
        maxLength={PREFERRED_NAME_MAX}
        autoComplete="nickname"
        placeholder="e.g. Dr. Sam Lee, or Sam"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
