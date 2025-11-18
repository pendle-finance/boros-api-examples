import { Agent, bulkSignWithAgentV2 } from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config";

export function setup() {
  const config = loadConfig();
  const account = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);
  return { config, account, agent };
}

export async function signAndSubmit(
  apiBaseUrl: string,
  agent: Agent,
  root: Hex,
  calldatas: Hex[]
) {
  const signed = await bulkSignWithAgentV2({
    agent,
    root,
    executeParams: calldatas.map((calldata) => ({
      accountId: 0,
      calldata,
    })),
  });

  const { data } = await axios.post(
    `${apiBaseUrl}/send-txs-bot/v2/agent/bulk-direct-call`,
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
