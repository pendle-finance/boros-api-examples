import axios from "axios";
import { createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RouterAbi } from "../abis/RouterAbi";
import { loadConfig } from "../src/utils/config";
import { run, TxResponse } from "../src/utils/setup";
import {
  EIP712_DOMAIN_TYPES,
  PENDLE_BOROS_ROUTER_DOMAIN,
} from "../src/utils/signing";
import { getCurrentTime_s, WEEK_s } from "../src/utils/time";

/**
 * Agent Setup
 *
 * An agent is a separate wallet that can trade on your behalf but cannot
 * withdraw funds. This provides security — even if the agent key is compromised,
 * your funds are safe.
 *
 * You can set multiple agents per sub-account (determined by accountId).
 *
 * Steps:
 * 1. Generate a new random wallet (e.g., `openssl rand -hex 32` prefixed with 0x)
 * 2. Add this key to .env as AGENT_PRIVATE_KEY
 * 3. Run this script to approve the agent on-chain
 * 4. Use the agent key in subsequent trading examples (07–11)
 *
 * Flow:
 *   1. Build the on-chain `approveAgent` calldata locally (EIP-712 signed by
 *      the user's wallet) — this is the only thing the user signs in this step.
 *   2. Hand the calldata to `POST /apis/v1/send-txs/approve`. The send-txs
 *      service relays the signed call on-chain (free action — gas balance is
 *      not charged here).
 */
async function main() {
  const config = loadConfig();

  const walletAccount = privateKeyToAccount(config.privateKey);
  const walletClient = createWalletClient({
    account: walletAccount,
    transport: http(config.rpcUrl),
  });

  const agentAccount = privateKeyToAccount(config.agentPrivateKey);

  const approveMessage = {
    root: walletAccount.address,
    accountId: 0,
    agent: agentAccount.address,
    expiry: BigInt(getCurrentTime_s() + WEEK_s),
    nonce: BigInt(Date.now() * 1000),
  };

  const approveAgentMessageTypes = [
    { name: "root", type: "address" },
    { name: "accountId", type: "uint8" },
    { name: "agent", type: "address" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ] as const;

  const approveSignature = await walletClient.signTypedData({
    account: walletAccount,
    domain: PENDLE_BOROS_ROUTER_DOMAIN,
    types: {
      EIP712Domain: EIP712_DOMAIN_TYPES,
      ApproveAgentMessage: approveAgentMessageTypes,
    },
    primaryType: "ApproveAgentMessage",
    message: approveMessage,
  });

  const approveAgentCalldata = encodeFunctionData({
    abi: RouterAbi,
    functionName: "approveAgent",
    args: [approveMessage, approveSignature],
  });

  const { data } = await axios.post<{ approveAgentResult: TxResponse }>(
    `${config.apiBaseUrl}/apis/v1/send-txs/approve`,
    {
      approveAgentCalldata,
      skipReceipt: false,
    }
  );

  console.log(data);
}

run(main);
