# Synnapp Webapp

## Local run

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Firebase setup

1. Copy env template:

```bash
cp .env.example .env.local
```

2. Fill all Firebase values in `.env.local`.
3. Start dev server and verify connection at:

```text
http://localhost:3000/api/firebase/health
```

Detailed setup guide: `docs/firebase-setup.md`

## Workspace invite emails

Invite links work without email provider setup, but delivery is marked as `skipped` until provider vars are configured.

Optional env vars:
- `RESEND_API_KEY`
- `INVITES_EMAIL_FROM`
- `INVITES_EMAIL_REPLY_TO`

Invites sent to emails without an account are supported:
- Recipient opens invite link
- Recipient signs up with the same invited email
- Recipient is returned to invite accept flow and can join workspace

## Firestore security rules

- Rules file: `firestore.rules`
- Emulator config: `firebase.json`
- Rules test suite: `tests/firebase/firestore.rules.test.mjs`

Run rule validation:

```bash
npm run test:firestore-rules
```

Details: `docs/firestore-rules.md`

## End-to-end tests (Playwright)

E2E runs against local Firebase Auth + Firestore emulators and covers:
- auth + onboarding
- workspace switching
- invite accept flow
- meeting -> decision/action sync
- decision/action archive + restore
- workspace access-denied / not-found routes

Install browser once:

```bash
npm run test:e2e:install
```

Run suite:

```bash
npm run test:e2e
```

Useful variants:

```bash
npm run test:e2e:headed
npm run test:e2e:ui
```
