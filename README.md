# PlainSpeak

Practice app for family medicine residents: talk with an AI patient, get friendly coaching on plain
language, empathy and responsiveness. See [PLAN.md](PLAN.md) for the full design.

> Status: **Phase 0 (scaffold).** Full setup, deploy steps and the cost-per-resident estimate land in
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

The project ID `demo-plainspeak` is a Firebase "demo" project: emulators run fully offline and
can't touch any real cloud resources.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # unit tests (shared, functions, web)
npm run test:rules  # security-rules tests in the emulator
```

## Environment variables

| Where                                      | Name                                                      | Purpose                                |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------- |
| `web/.env.local`                           | `VITE_FIREBASE_*`                                         | Firebase web config (public by design) |
| `web/.env.local`                           | `VITE_USE_EMULATORS`                                      | `true` to use the local emulator suite |
| Secret Manager / `functions/.secret.local` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CARTESIA_API_KEY` | Server-only vendor keys                |
