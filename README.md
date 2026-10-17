# PlainSpeak

Practice app for family medicine residents: talk with an AI patient, get friendly coaching on plain
language, empathy and responsiveness. See [PLAN.md](PLAN.md) for the full design.

> Status: **Phase 1 (sign-in, invites, consent, security rules).** Full setup, deploy steps and the cost-per-resident estimate land in
> Phase 9.

## Layout

| Path           | What                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `web/`         | React + TypeScript PWA (Vite), mobile-first                             |
| `functions/`   | Cloud Functions v2 (Node 22). The only place API keys are used.         |
| `shared/`      | Types and logic shared by both (`PatientRenderer`, data model, scoring) |
| `tests/rules/` | Firestore and Storage security-rules tests (run against emulators)      |

## Local development

Requires Node 22+ and Java 21 (for the Firebase emulators).

```bash
npm install
cp web/.env.example web/.env.local                         # emulator defaults work as-is
cp functions/.secret.local.example functions/.secret.local # add API keys (later phases)

npm run emulators   # Auth, Firestore, Storage, Functions + UI at http://localhost:4000
npm run dev         # PWA at http://localhost:5173 (connects to emulators)
```

### First sign-in (emulator)

```bash
npm run bootstrap -- --email you@example.org   # creates program "irmc" + your faculty invite
```

Open the app, enter that email, then open the sign-in link from the Emulator UI
(http://localhost:4000 → Authentication). You'll see the consent screen, then the app. As
faculty, use the **Faculty** tab to invite residents; Firebase emails them a sign-in link (in the
emulator, links show up in the same place). Emails without an invite are turned away and their
account is deleted.

The project ID `demo-plainspeak` is a Firebase "demo" project: emulators run fully offline and
can't touch any real cloud resources.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # unit tests (shared, functions, web)
npm run test:rules      # security-rules tests in the emulator
npm run test:functions  # invite/consent server logic against Auth + Firestore emulators
```

## Environment variables

| Where                                      | Name                                                      | Purpose                                |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------- |
| `web/.env.local`                           | `VITE_FIREBASE_*`                                         | Firebase web config (public by design) |
| `web/.env.local`                           | `VITE_USE_EMULATORS`                                      | `true` to use the local emulator suite |
| Secret Manager / `functions/.secret.local` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CARTESIA_API_KEY` | Server-only vendor keys                |

## Deploying (Firebase)

Deploys run from GitHub: **Actions → Deploy → Run workflow**, with the Firebase project ID. The job
refuses to run if that ID doesn't match the key in the `FIREBASE_SERVICE_ACCOUNT` repo secret.
**Actions → Diagnose** is a read-only check (function logs and permissions).

One-time project setup (newer Google projects ship with strict defaults, so all of these matter):

1. Firebase plan: **Blaze**. Set a budget alert.
2. Authentication → Email/Password **and** "Email link (passwordless sign-in)" on.
3. Firestore database created (us-east1). Storage → Get started (needed from Phase 3).
4. Service account `plainspeak-deployer` with roles: Firebase Admin, Cloud Functions Admin,
   Service Account User, Secret Manager Admin, Artifact Registry Administrator, Cloud Scheduler
   Admin, Service Usage Admin, Cloud Run Admin. Its JSON key goes in the `FIREBASE_SERVICE_ACCOUNT`
   GitHub secret.
5. Default compute account `<project-number>-compute@developer.gserviceaccount.com` (builds and
   runs the functions) with roles: Cloud Build Service Account, Cloud Datastore User, Firebase
   Authentication Admin, Storage Object Admin.
6. First run: pass `faculty_email` to invite the first faculty member.
