import { getRouterAddress } from "@pendle/boros-sdk-public";
import axios from "axios";
import { encodeFunctionData } from "viem";
import { arbitrum } from "viem/chains";
import { API_BASE_URL } from "../src/utils/api";
import { run, setup, TxResponse } from "../src/utils/setup";
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
 */

// === Version 1 (default): direct API calls ===
//
// 1. Build the on-chain `approveAgent` calldata locally (EIP-712 signed by
//    the user's wallet) — this is the only thing the user signs in this step.
// 2. Hand the calldata to `POST /v1/send-txs/approve`. The send-txs service
//    relays the signed call on-chain (free action — gas balance is not
//    charged here).
async function mainDirect() {
  const { account, walletClient, agent } = setup();

  const approveMessage = {
    root: account.address,
    accountId: 0,
    agent: agent.walletClient.account!.address,
    expiry: BigInt(getCurrentTime_s() + WEEK_s),
    nonce: BigInt(Date.now() * 1000),
  };

  const PENDLE_BOROS_ROUTER_DOMAIN = {
    name: "Pendle Boros Router",
    version: "1.0",
    chainId: BigInt(arbitrum.id),
    verifyingContract: getRouterAddress(),
  } as const;

  const EIP712_DOMAIN_TYPES = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ] as const;

  const approveAgentMessageTypes = [
    { name: "root", type: "address" },
    { name: "accountId", type: "uint8" },
    { name: "agent", type: "address" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ] as const;

  const approveSignature = await walletClient.signTypedData({
    account,
    domain: PENDLE_BOROS_ROUTER_DOMAIN,
    types: {
      EIP712Domain: EIP712_DOMAIN_TYPES,
      ApproveAgentMessage: approveAgentMessageTypes,
    },
    primaryType: "ApproveAgentMessage",
    message: approveMessage,
  });

  const approveAgentAbi = [
    {
      type: "function",
      name: "approveAgent",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "msg",
          type: "tuple",
          components: [
            { name: "root", type: "address" },
            { name: "accountId", type: "uint8" },
            { name: "agent", type: "address" },
            { name: "expiry", type: "uint64" },
            { name: "nonce", type: "uint64" },
          ],
        },
        { name: "signature", type: "bytes" },
      ],
      outputs: [],
    },
  ] as const;

  const approveAgentCalldata = encodeFunctionData({
    abi: approveAgentAbi,
    functionName: "approveAgent",
    args: [approveMessage, approveSignature],
  });

  const { data } = await axios.post<{ approveAgentResult: TxResponse }>(
    `${API_BASE_URL}/v1/send-txs/approve`,
    {
      approveAgentCalldata,
      skipReceipt: false,
    }
  );

  console.log(data);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `exchange.approveAgent` performs all the steps above (build calldata,
// EIP-712 sign with the user's wallet, POST to `/v1/send-txs/approve`).
async function _mainSdk() {
  const { exchange } = setup();

  const expiry_s = getCurrentTime_s() + WEEK_s;
  const result = await exchange.approveAgent(undefined, undefined, expiry_s);

  console.log(result);
}

run(mainDirect);
