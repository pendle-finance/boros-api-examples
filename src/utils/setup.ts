import { Agent, bulkSignWithAgentV2 } from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

export function setup() {
  const config = loadConfig();
  const account = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);
  return { config, account, agent };
}

/**
 * Sign each agent call with the agent's EIP-712 key and submit them as a
 * single batch to the open-api send-txs service. The accountId from each
 * `calls[i]` is threaded into the signed message so multi-sub-account
 * batches (rare, but supported) work transparently.
 */
export async function signAndSubmit(
  apiBaseUrl: string,
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
    `${apiBaseUrl}/apis/v1/send-txs/bulk-calls`,
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
