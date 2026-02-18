import { resetEmulators } from "./support/firebase";

async function waitForReset(maxAttempts = 8) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    try {
      await resetEmulators();
      return;
    } catch (error) {
      lastError = error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastError;
}

export default async function globalSetup() {
  await waitForReset();
}
