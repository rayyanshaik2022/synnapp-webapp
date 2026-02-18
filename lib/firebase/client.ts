import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;

function getClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

function validateClientEnv(config: ReturnType<typeof getClientConfig>) {
  const missing: string[] = [];

  if (!config.apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!config.authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!config.projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!config.storageBucket) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!config.messagingSenderId) {
    missing.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  }
  if (!config.appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase client env vars: ${missing.join(", ")}. Add them to webapp/.env.local.`,
    );
  }
}

function shouldUseClientEmulators() {
  return process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "1";
}

function normalizeHost(value: string | undefined, fallback: string) {
  const normalized = (value ?? "").trim();
  return normalized || fallback;
}

function parseHostAndPort(value: string, fallbackPort: number) {
  const normalized = value.replace(/^https?:\/\//, "");
  const [host, portRaw] = normalized.split(":");
  const port = Number.parseInt(portRaw ?? "", 10);

  return {
    host: host || "127.0.0.1",
    port: Number.isFinite(port) ? port : fallbackPort,
  };
}

export function getFirebaseClientApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const config = getClientConfig();
  validateClientEnv(config);

  return initializeApp(config);
}

export function getFirebaseClientAuth() {
  const auth = getAuth(getFirebaseClientApp());

  if (!authEmulatorConnected && shouldUseClientEmulators()) {
    const host = normalizeHost(
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
      "127.0.0.1:9099",
    );
    const emulatorUrl = host.startsWith("http") ? host : `http://${host}`;
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    authEmulatorConnected = true;
  }

  return auth;
}

export function getFirebaseClientDb() {
  const db = getFirestore(getFirebaseClientApp());

  if (!firestoreEmulatorConnected && shouldUseClientEmulators()) {
    const host = normalizeHost(
      process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST,
      "127.0.0.1:8080",
    );
    const { host: emulatorHost, port: emulatorPort } = parseHostAndPort(host, 8080);
    connectFirestoreEmulator(db, emulatorHost, emulatorPort);
    firestoreEmulatorConnected = true;
  }

  return db;
}
