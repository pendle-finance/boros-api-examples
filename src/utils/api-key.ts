import { createPrivateKey, randomBytes, sign } from "crypto";
import axios from "axios";
import { createPendleBorosRouterDomain } from "@pendle/boros-sdk-public";
import { Address, LocalAccount, toHex } from "viem";
import { API_BASE_URL } from "./api";

const API_KEYS_URL = `${API_BASE_URL}/v1/api-keys`;

// The `uri` claim binds the public path, prefix included — taken from API_BASE_URL.
const PUBLIC_PATH_PREFIX = new URL(API_BASE_URL).pathname.replace(/\/+$/, "");

export type ApiSigningKeyCredentials = {
  keyId: string;
  privateKey: string;
};

/** One live key, as returned by list. Timestamps are unix seconds. */
export type ApiKeyInfo = {
  keyId: string;
  name: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  /** Agent that minted it, absent when the root did. Audit only — it grants nothing. */
  createdByAgent?: string;
};

/** Create also returns the PEM — once, and never again. */
export type CreatedApiKey = ApiKeyInfo & {
  root: string;
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

const API_KEY_ACTION_TYPES = {
  ApiKeyAction: [
    { name: "root", type: "address" },
    { name: "action", type: "string" },
    { name: "keyId", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * Who signs a management envelope: the root wallet, or an agent approved on its sub-account 0.
 * A live agent has the same rights over API keys as the root.
 */
export type ApiKeyAuth = {
  root: Address;
  signer: LocalAccount;
};

async function signAction(
  auth: ApiKeyAuth,
  action: "create" | "list" | "revoke",
  keyId = ""
) {
  const root = auth.root.toLowerCase() as Address;
  // Sent unsigned beside the payload; the server verifies the signature against it.
  const agent =
    auth.signer.address.toLowerCase() === root ? undefined : auth.signer.address;

  const payload = {
    root,
    action,
    keyId,
    // Milliseconds here, unlike the request JWT's seconds. Valid for 5 minutes.
    timestamp: Date.now(),
    nonce: toHex(randomBytes(32)),
  };

  const signature = await auth.signer.signTypedData({
    // `GET /v1/api-keys/eip712-domain` serves the same thing for clients without the SDK.
    domain: createPendleBorosRouterDomain(),
    types: API_KEY_ACTION_TYPES,
    primaryType: "ApiKeyAction",
    message: { ...payload, timestamp: BigInt(payload.timestamp) },
  });

  return { ...payload, agent, signature };
}

export async function createApiKey(
  auth: ApiKeyAuth,
  params: { name: string; expiresInDays?: number }
): Promise<CreatedApiKey> {
  const signed = await signAction(auth, "create");
  const { data } = await axios.post<CreatedApiKey>(API_KEYS_URL, { ...signed, ...params });
  return data;
}

export async function listApiKeys(auth: ApiKeyAuth): Promise<ApiKeyInfo[]> {
  const signed = await signAction(auth, "list");
  const { data } = await axios.get<ApiKeyInfo[]>(API_KEYS_URL, { params: signed });
  return data;
}

export async function revokeApiKey(auth: ApiKeyAuth, keyId: string): Promise<void> {
  const signed = await signAction(auth, "revoke", keyId);
  await axios.post(`${API_KEYS_URL}/revoke`, signed);
}
