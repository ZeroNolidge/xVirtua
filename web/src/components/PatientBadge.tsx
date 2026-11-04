import type { PatientStatus } from '@plainspeak/shared';

const TEXT: Record<PatientStatus, string> = {
  started: 'In progress',
  completed: 'Completed ✓',
  mastered: 'Mastered ★',
};

/** Their progress with a patient, on the patient list. */
export function PatientBadge({ status }: { status: PatientStatus | undefined }) {
  if (!status) return null;
  return <span className={`badge progress-${status}`}>{TEXT[status]}</span>;
}
