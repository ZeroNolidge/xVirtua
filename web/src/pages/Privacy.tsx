import { Link } from 'react-router-dom';
import { RETENTION_NOTICE } from '@plainspeak/shared';

/** Plain-language privacy summary. Public: reachable before sign-in. */
export function Privacy() {
  return (
    <section>
      <Link to="/" className="back">
        ‹ Back
      </Link>
      <h1>Privacy</h1>
      <div className="card">
        <h2>What PlainSpeak is</h2>
        <p>
          A practice space for residents to explain medicine in plain, kind language to fictional AI
          patients. Please never enter real patient information.
        </p>
        <h2>What we save</h2>
        <ul className="tight">
          <li>Your email, name, role and residency program.</li>
          <li>
            For each practice conversation: a recording of your voice, a written transcript, and
            your feedback scores.
          </li>
        </ul>
        <h2>Who can see it</h2>
        <p>
          You, and faculty in your residency program. Faculty may bring summaries of your progress
          to Clinical Competency Committee (CCC) reviews.
        </p>
        <h2>Services we use</h2>
        <ul className="tight">
          <li>Google Firebase stores the app’s data.</li>
          <li>
            OpenAI turns your speech into text. In the live voice mode, OpenAI also hears everything
            your mic picks up and speaks as the patient.
          </li>
          <li>Anthropic (Claude) plays the patient and writes your feedback.</li>
          <li>Cartesia creates the patient’s voice in the standard mode.</li>
          <li>
            If your program turns on the video avatar (test), Simli animates the patient’s face.
            Only the patient’s voice is sent to Simli, never yours.
          </li>
        </ul>
        <p className="small muted">These services don’t use our data to train their AI models.</p>
        <h2>How long we keep it</h2>
        <p>{RETENTION_NOTICE}</p>
        <p className="small muted">
          Faculty can delete a resident’s recordings and transcripts sooner on request. Ask your
          program director.
        </p>
      </div>
    </section>
  );
}
