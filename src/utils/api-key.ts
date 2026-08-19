import { createPrivateKey, randomBytes, sign } from "crypto";
import { API_BASE_URL } from "./api";

// Key management lives in the SDK's `ApiKeys` (see example 15). These two stay hand-rolled so
// example 14 can show exactly what the gateway verifies on every request.

// The `uri` claim binds the public path, prefix included — taken from API_BASE_URL.
const PUBLIC_PATH_PREFIX = new URL(API_BASE_URL).pathname.replace(/\/+$/, "");

export type ApiSigningKeyCredentials = {
  keyId: string;
  privateKey: string;
};

/**
 * Self-signed request JWT for `x-pendle-auth`. Query strings are not part of the `uri` claim,
 * so one token covers every query on that path.
 */
export function mintToken(
  key: ApiSigningKeyCredentials,
  method: string,
  path: string
): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  const header = b64({ alg: "EdDSA", typ: "JWT", kid: key.keyId });
  const payload = b64({
    sub: key.keyId,
    iss: "pendle",
    // A plain string. The array form RFC 7519 allows is rejected outright.
    aud: "pendle-open-api",
    jti: randomBytes(16).toString("hex"),
    uri: `${method.toUpperCase()} ${path}`,
    iat: now,
    nbf: now,
    // Must be at most 120 seconds after `nbf`.
    exp: now + 60,
  });

  const signature = sign(
    null,
    Buffer.from(`${header}.${payload}`),
    createPrivateKey(key.privateKey)
  ).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

/** Auth header for one open-api call. `path` is the axios path; the public prefix is added here. */
export function apiKeyHeaders(
  key: ApiSigningKeyCredentials,
  method: string,
  path: string
): Record<string, string> {
  return { "x-pendle-auth": mintToken(key, method, `${PUBLIC_PATH_PREFIX}${path}`) };
}
