import { useState } from 'react';
import { CONSENT_VERSION, RETENTION_NOTICE } from '@plainspeak/shared';
import { api, friendlyError } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Shown at first sign-in, and again whenever CONSENT_VERSION is bumped.
 * If this text changes, bump CONSENT_VERSION in shared/src/constants.ts.
 */
export function Consent() {
  const { claims, signOut } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptConsent({ version: CONSENT_VERSION });
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Before you start</h1>
      <p className="muted">
        PlainSpeak is a practice space. Here’s what happens with your sessions.
      </p>
      <div className="card">
        <ul className="consent-list">
          <li>
            <strong>We record.</strong> Your voice is recorded and a written transcript is saved for
            each practice conversation.
          </li>
          <li>
            <strong>Patients are fictional.</strong> Please don’t share real patient details.
          </li>
          <li>
            <strong>Who can see it:</strong> you, and faculty in your residency program.
          </li>
          <li>
            <strong>How it’s used:</strong> to give you coaching feedback. Faculty may also bring
            summaries of your progress to Clinical Competency Committee (CCC) reviews.
          </li>
          <li>
            <strong>How long:</strong> {RETENTION_NOTICE}
          </li>
          <li>
            <strong>The mic hears the whole room.</strong> While a conversation is running,
            everything your mic picks up, including other people and sounds nearby, is sent to
            OpenAI to understand what you said. The mic turns off when you pause, end, or leave the
            app.
          </li>
          <li>
            <strong>AI services:</strong> to run the conversation and scoring, your audio or
            transcript is sent to our AI providers: OpenAI (turns your speech into text, and in the
            live voice mode it also listens and speaks as the patient), Anthropic (plays the patient
            and writes your feedback) and Cartesia (the patient’s voice in the standard mode).
          </li>
          {claims?.role === 'faculty' && (
            <li>
              <strong>As faculty,</strong> you’ll be able to see recordings and transcripts of
              residents in your program. Please use them only for teaching and evaluation.
            </li>
          )}
        </ul>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I understand and agree.</span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={!agreed || busy} onClick={accept}>
          {busy ? 'Saving…' : 'Let’s go'}
        </button>
        <button className="btn btn-text" onClick={() => void signOut()}>
          Not now — sign out
        </button>
      </div>
    </section>
  );
}
