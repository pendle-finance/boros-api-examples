import { Agent, Exchange, bulkSignWithAgentV2 } from "@pendle/boros-sdk-public";
import axios from "axios";
import { Hex, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { API_BASE_URL } from "./api";
import { loadConfig } from "./config";

export type AgentCall = {
  calldata: Hex;
  accountId: number;
};

export type TxResponse = {
  txHash?: string;
  status?: "success" | "reverted";
  index?: number;
  error?: string;
};

/**
 * Sets up the shared primitives used by both versions of every example:
 * - `account` / `agent`: viem account + EIP-712 agent for signing.
 * - `walletClient` / `publicClient`: viem clients on Arbitrum.
 * - `exchange`: the new SDK's high-level wrapper (used by the SDK version of
 *   each example). The SDK defaults to `https://api-boros.pendle.finance/apis`
 *   under the hood, so no base-URL configuration is needed.
 */
export function setup() {
  const config = loadConfig();
  const account = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);

  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });

  const exchange = new Exchange(
    walletClient,
    account.address,
    /* accountId */ 0,
    [config.rpcUrl],
    agent
  );

  return { config, account, agent, walletClient, publicClient, exchange };
}

/**
 * Sign each agent call with the agent's EIP-712 key and submit them as a
 * single batch to the open-api send-txs service. The accountId from each
 * `calls[i]` is threaded into the signed message so multi-sub-account
 * batches (rare, but supported) work transparently.
 *
 * Used by the "direct API" version of the agent-signed examples. The SDK
 * version uses `exchange.bulkSignAndExecute()` (or the higher-level
 * `exchange.placeOrder`, `cancelOrders`, etc.) instead.
 */
export async function signAndSubmit(
  agent: Agent,
  root: Hex,
  calls: AgentCall[]
): Promise<TxResponse[]> {
  const signed = await bulkSignWithAgentV2({
    agent,
    root,
    executeParams: calls.map(({ calldata, accountId }) => ({
      accountId,
      calldata,
    })),
  });

  const { data } = await axios.post<TxResponse[]>(
    `${API_BASE_URL}/v1/send-txs/bulk-calls`,
    {
      datas: signed.map((s) => ({
        agent: s.agent,
        message: {
          account: s.message.account,
          connectionId: s.message.connectionId,
          nonce: s.message.nonce.toString(),
        },
        signature: s.signature,
        calldata: s.calldata,
      })),
      skipReceipt: false,
    }
  );

  return data;
}

export function run(main: () => Promise<void>) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      if (axios.isAxiosError(error)) {
        console.error(
          `API Error ${error.response?.status}:`,
          JSON.stringify(error.response?.data, null, 2)
        );
      } else {
        console.error(error);
      }
      process.exit(1);
    });
}
