import { ApiKeys, StopOrders } from "@pendle/boros-sdk-public";
import { run, setup } from "../src/utils/setup";

/**
 * API signing keys, minted from a script
 *
 * The `/v1/api-keys` routes are authenticated by an EIP-712 envelope from a wallet rather
 * than by an API key — chicken and egg otherwise. The signer is the ROOT wallet
 * (`PRIVATE_KEY`) or an agent approved on its sub-account 0 (`AGENT_PRIVATE_KEY`), and an
 * approved agent has the same rights over every key of that root — so a bot can rotate its
 * own keys without the withdraw-capable root key in its environment.
 *
 * Prerequisites: an approved agent (`yarn example:agent`).
 */

async function main() {
  const { account, config } = setup();

  const asAgent = ApiKeys.asAgent(account.address, config.agentPrivateKey);
  const asRoot = ApiKeys.asRoot(config.privateKey);

  // --- 1. Mint. The PEM is returned once; omit `expiresInDays` for a key that never expires.
  //        Waits until the key authenticates, else throws ApiKeyNotUsableError, secret on `.key`.
  const created = await asAgent.create({
    name: `example-${Date.now()}`,
    expiresInDays: 30,
  });
  console.log("Created:", created.keyId, "expires at", created.expiresAt ?? "never");
  console.log("PEM (returned once, store it now):", created.privateKey.slice(0, 40) + "...");

  // --- 2. List. Never returns secrets. An agent sees every key of its root, not only the
  //        ones it minted.
  console.table(
    (await asAgent.list()).map((key) => ({
      keyId: key.keyId,
      name: key.name,
      expiresAt: key.expiresAt ?? "never",
      createdByAgent: key.createdByAgent ?? "root",
    }))
  );

  // --- 3. Use it. `activate` installs the key as the credential for every later open-api
  //        read, so there is no `account` parameter — it comes from the key's root.
  ApiKeys.activate(created);
  const live = await new StopOrders().list({ isActive: true, limit: 1 });
  console.log("Authenticated read OK — active stop orders:", live.results.length);

  // On restart a bot mints nothing, it activates what it stored:
  //   ApiKeys.activate(loadApiSigningKey())  // BOROS_API_KEY_ID / BOROS_API_KEY_PEM from .env

  // --- 4. Revoke, freeing both its name and a key slot. Signed by the root here, but the
  //        agent could revoke it too — including keys the root minted.
  await asRoot.revoke(created.keyId);
  console.log("Revoked:", created.keyId);
}

run(main);
