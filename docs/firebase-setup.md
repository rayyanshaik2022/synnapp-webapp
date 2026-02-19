# Firebase Connection Setup (Synnapp `webapp`)

This guide covers everything needed to connect the Next.js app to your Firebase project.

## 1) What was added in code

- Firebase client initializer: `webapp/lib/firebase/client.ts`
- Firebase admin initializer: `webapp/lib/firebase/admin.ts`
- Health check route: `webapp/app/api/firebase/health/route.ts`
- Environment template: `webapp/.env.example`
- `.gitignore` update to allow committing `webapp/.env.example`

## 2) Create or choose a Firebase project

1. Open Firebase Console: https://console.firebase.google.com/
2. Create a new project (or pick an existing one).
3. If prompted, enable Google Analytics only if you want it. It is optional for this app.

## 3) Register a Web App and get client config

1. In Firebase Console, go to Project settings.
2. Under "Your apps", click Web (`</>`).
3. Register app name (for example: `synnapp-webapp`).
4. Copy the config values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

These map to:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## 4) Enable Firebase products required for MVP

1. Authentication:
   - Go to `Build -> Authentication -> Sign-in method`.
   - Enable at least one provider (Email/Password recommended for MVP).
2. Firestore Database:
   - Go to `Build -> Firestore Database`.
   - Create database in your preferred region.
   - Start in locked/production mode if this is a real project.
3. Storage (optional now, recommended later):
   - Go to `Build -> Storage`.
   - Create bucket if you plan file uploads.

## 5) Create service account credentials for server-side Admin SDK

1. Firebase Console -> Project settings -> Service accounts.
2. Click "Generate new private key".
3. Download JSON securely (never commit it).
4. From that JSON, copy:
   - `project_id` -> `FIREBASE_PROJECT_ID`
   - `client_email` -> `FIREBASE_CLIENT_EMAIL`
   - `private_key` -> `FIREBASE_PRIVATE_KEY`

Important formatting rule for `FIREBASE_PRIVATE_KEY`:
- Keep it as one env string with escaped newlines (`\n`) or quoted multiline-compatible format.
- Example:
  - `"-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n"`

## 6) Configure local environment

From project root:

```bash
cd webapp
cp .env.example .env.local
```

Fill `webapp/.env.local` with your Firebase values.

## 7) Install dependencies and run app

```bash
cd webapp
npm install
npm run dev
```

## 8) Verify Firebase connection

Open:
- `http://localhost:3000/api/firebase/health`

Expected success response:
- `ok: true`
- `projectId: "<your-project-id>"`
- `missingClientEnv: []`

If it fails:
- `Missing Firebase Admin env vars...` means server env vars are incomplete.
- Non-empty `missingClientEnv` means browser env vars are incomplete.
- Permission errors usually mean service account/project mismatch.

## 9) Deployment environment variables

In your deploy platform (for example Vercel), set the same env vars from `.env.local`:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_STORAGE_BUCKET` (optional)
- `RESEND_API_KEY` (optional; required only for invite email delivery)
- `INVITES_EMAIL_FROM` (optional; required only for invite email delivery)
- `INVITES_EMAIL_REPLY_TO` (optional)

Do not expose admin vars to client code.

If invite email vars are not set, invite creation still works, but delivery status is recorded as `skipped` and users must copy/share the invite link manually.

## 10) Firestore rules + emulator validation

Security rules and emulator test harness are included:

- `firestore.rules`
- `firebase.json`
- `tests/firebase/firestore.rules.test.mjs`

Run the rules test suite:

```bash
npm run test:firestore-rules
```

This command starts the Firestore emulator, runs the rules tests, and exits.
