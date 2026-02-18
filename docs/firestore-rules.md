# Firestore Rules and Emulator Validation

This project now includes:

- `firestore.rules` for workspace/member role enforcement
- `firestore.indexes.json` placeholder index config
- `firebase.json` emulator + firestore config
- `tests/firebase/firestore.rules.test.mjs` emulator-backed rules tests

## What the rules enforce

- Users can read/update only their own `users/{uid}` document.
- Workspace reads require membership in `workspaces/{workspaceId}/members/{uid}`.
- `owner/admin` are manager roles.
- `member` can create/edit meetings, decisions, and actions.
- `viewer` is read-only for meetings, decisions, and actions.
- Archive/restore fields on decisions/actions require `owner/admin`.
- Membership management (`workspaces/{workspaceId}/members/*`) requires `owner/admin`.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Run the rules test suite (starts Firestore emulator automatically):

```bash
npm run test:firestore-rules
```

3. Optional: run emulators manually:

```bash
npm run firebase:emulators
```

Emulator UI: `http://localhost:4000`

## Deploy only Firestore rules

```bash
npx firebase-tools deploy --only firestore:rules
```

If you use a specific Firebase project:

```bash
npx firebase-tools deploy --only firestore:rules --project <your-project-id>
```
