import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { API_BASE_URL } from "../src/utils/api";
import {
  apiKeyHeaders,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../src/utils/api-key";
import { run, setup } from "../src/utils/setup";

/**
 * API signing keys, minted from a script
 *
 * The `/v1/api-keys` endpoints are authenticated by an EIP-712 `ApiKeyAction` envelope
 * rather than by an API key — chicken and egg, otherwise. The signer is either the ROOT
 * wallet (`PRIVATE_KEY`) or an agent approved on the root's sub-account 0, passed as an
 * unsigned `agent` field beside the signed `{root, action, keyId, timestamp, nonce}`. A live
 * agent has full parity with the root here, so a bot can rotate its own keys.
 *
 * Two signatures are easy to confuse: the management envelope above is EIP-712 with a
 * timestamp in MILLISECONDS, while every ordinary request is an Ed25519 JWT signed by the
 * API key itself, in SECONDS.
 *
 * Prerequisites: an approved agent (`yarn example:agent`), since steps 1-2 sign as the agent.
 */

// Direct API calls only: the SDK has no wrapper for the api-keys tree.
async function main() {
  const { account, config } = setup();
  const agentAccount = privateKeyToAccount(config.agentPrivateKey);

  const asAgent = { root: account.address, signer: agentAccount };
  const asRoot = { root: account.address, signer: account };

  // --- 1. Mint a key, signing as the agent. Drop `expiresInDays` for one that never expires.
  const created = await createApiKey(asAgent, {
    name: `example-${Date.now()}`,
    expiresInDays: 30,
  });
  console.log("Created:", created.keyId, "expires at", created.expiresAt ?? "never");
  console.log("PEM (returned once, store it now):", created.privateKey.slice(0, 40) + "...");

  // --- 2. List. Never returns secrets. An agent sees every key of its root, not only the
  //        ones it minted.
  const keys = await listApiKeys(asAgent);
  console.table(
    keys.map((key) => ({
      keyId: key.keyId,
      name: key.name,
      expiresAt: key.expiresAt ?? "never",
      lastUsedAt: key.lastUsedAt ?? "-",
      createdByAgent: key.createdByAgent ?? "root",
    }))
  );

  // --- 3. Use the fresh key on a real read. The account comes from the key's root, so
  //        there is no `account` parameter.
  const key = { keyId: created.keyId, privateKey: created.privateKey };
  const { data: stopOrders } = await waitForKey(() =>
    axios.get(`${API_BASE_URL}/v1/stop-orders`, {
      headers: apiKeyHeaders(key, "GET", "/v1/stop-orders"),
      params: { isActive: true, limit: 1 },
    })
  );
  console.log("Authenticated read OK — active stop orders:", stopOrders.results.length);

  // --- 4. Revoke, freeing both its name and a key slot. Signed by the root here, but the
  //        agent could revoke it too — including keys the root minted.
  await revokeApiKey(asRoot, created.keyId);
  console.log("Revoked:", created.keyId);
}

// A new key takes a few seconds to become usable, so the first calls can 401. That is the
// wait, not a broken PEM.
async function waitForKey<T>(read: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      const isUnauthorized =
        axios.isAxiosError(error) && error.response?.status === 401;
      if (!isUnauthorized || Date.now() > deadline) throw error;
      console.log("Key not live on the gateway yet, retrying in 2s...");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

run(main);
