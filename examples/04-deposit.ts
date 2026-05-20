import { CROSS_MARKET_ID, MarketAccLib, waitForTransaction } from "@pendle/sdk-boros";
import axios from "axios";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  Hex,
  http,
  parseUnits,
} from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { getAddresses } from "../src/utils/addresses";
import { loadConfig } from "../src/utils/config";
import { run } from "../src/utils/setup";

// see 02-assets.ts
const USDT0 = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const USDT0_TOKEN_ID = 3;

type UserCalldataResponse = {
  calldata: Hex;
  from: Address;
  to: Address;
  gas?: string;
};

async function main() {
  const config = loadConfig();
  const amount = parseUnits("11", 6);

  const account = privateKeyToAccount(config.privateKey);
  const client = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });

  // `marketAcc` packs (root, accountId, tokenId, marketId). For cross margin
  // deposits, the marketId segment is CROSS_MARKET_ID (0xFFFFFF).
  const marketAcc = MarketAccLib.pack(
    account.address,
    0,
    USDT0_TOKEN_ID,
    CROSS_MARKET_ID
  );

  const { data } = await axios.post<UserCalldataResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/user/deposit`,
    {
      marketAcc,
      // `amount` is the bigint string in the token's native decimals
      // (USDT0 has 6 decimals).
      amount: amount.toString(),
    }
  );

  const allowance = await publicClient.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, getAddresses().router],
  });

  if (allowance < amount) {
    const approveTxHash = await client.writeContract({
      address: USDT0,
      abi: erc20Abi,
      functionName: "approve",
      args: [getAddresses().router, amount],
    });
    await waitForTransaction(publicClient, approveTxHash);
    console.log("Approve txHash:", approveTxHash);
  }

  const depositTxHash = await client.sendTransaction({
    to: data.to,
    data: data.calldata,
  });
  await waitForTransaction(publicClient, depositTxHash);
  console.log("Deposit txHash:", depositTxHash);
}

run(main);
