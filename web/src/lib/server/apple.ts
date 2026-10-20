import "server-only";
// App Store signed data verification (spec 11.5). Every transaction and notification is verified
// against Apple's root certificates before it can change an entitlement. Local StoreKit testing in
// Xcode signs with a local certificate, so the Xcode environment is accepted only when
// OPENSTUDY_ALLOW_XCODE_STOREKIT=1 (development only, never in production).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";

export const BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? "com.openstudy.shelf";

let roots: Buffer[] | null = null;
function rootCerts(): Buffer[] {
  roots ??= ["AppleRootCA-G3.cer", "AppleRootCA-G2.cer"].map((f) => readFileSync(join(process.cwd(), "certs/apple", f)));
  return roots;
}

const verifiers = new Map<Environment, SignedDataVerifier>();

export class AppleEnvironmentError extends Error {}

function verifierFor(env: string | undefined): SignedDataVerifier {
  let e: Environment;
  if (env === Environment.PRODUCTION) e = Environment.PRODUCTION;
  else if (env === Environment.SANDBOX) e = Environment.SANDBOX;
  else if ((env === Environment.XCODE || env === Environment.LOCAL_TESTING) && process.env.OPENSTUDY_ALLOW_XCODE_STOREKIT === "1" && process.env.VERCEL_ENV !== "production")
    e = env as Environment;
  else throw new AppleEnvironmentError(`environment not accepted: ${env ?? "missing"}`);
  let v = verifiers.get(e);
  if (!v) {
    const appId = process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined;
    if (e === Environment.PRODUCTION && !appId) throw new AppleEnvironmentError("APPLE_APP_ID is not set");
    v = new SignedDataVerifier(rootCerts(), true, e, BUNDLE_ID, appId);
    verifiers.set(e, v);
  }
  return v;
}

/** Reads the (unverified) payload only to pick the matching verifier; verification follows. */
function claimedEnvironment(jws: string, pick: (payload: Record<string, unknown>) => unknown): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const env = pick(payload);
    return typeof env === "string" ? env : undefined;
  } catch {
    return undefined;
  }
}

export function verifyTransaction(jws: string) {
  return verifierFor(claimedEnvironment(jws, (p) => p.environment)).verifyAndDecodeTransaction(jws);
}

export async function verifyNotification(signedPayload: string) {
  const env = claimedEnvironment(signedPayload, (p) => (p.data as { environment?: string } | undefined)?.environment ?? (p.summary as { environment?: string } | undefined)?.environment);
  const verifier = verifierFor(env);
  const note = await verifier.verifyAndDecodeNotification(signedPayload);
  const tx = note.data?.signedTransactionInfo ? await verifier.verifyAndDecodeTransaction(note.data.signedTransactionInfo) : null;
  const renewal = note.data?.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(note.data.signedRenewalInfo) : null;
  return { note, tx, renewal };
}
