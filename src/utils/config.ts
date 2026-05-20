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
