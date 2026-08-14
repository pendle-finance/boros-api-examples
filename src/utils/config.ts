import dotenv from "dotenv";
import { Hex } from "viem";

dotenv.config();

function requireEnv<T extends string>(name: string): T {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value as T;
}

export const loadConfig = () => {
  const rpcUrl = requireEnv("RPC_URL");
  const privateKey = requireEnv<Hex>("PRIVATE_KEY");
  const agentPrivateKey = requireEnv<Hex>("AGENT_PRIVATE_KEY");
  return {
    rpcUrl,
    privateKey,
    agentPrivateKey,
  };
};

/**
 * Ed25519 API signing key — only the stop-order example needs it, so it is loaded
 * separately from `loadConfig()` and every other example keeps running without one.
 */
export const loadApiSigningKey = () => ({
  keyId: requireEnv("BOROS_API_KEY_ID"),
  // A PKCS#8 PEM spans several lines; `.env` files carry it with escaped newlines.
  privateKey: requireEnv("BOROS_API_KEY_PEM").replace(/\\n/g, "\n"),
});
