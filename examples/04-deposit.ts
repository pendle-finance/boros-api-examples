import {
  CROSS_MARKET_ID,
  MarketAccLib,
  getRouterAddress,
  waitForTransaction,
} from "@pendle/boros-sdk-public";
import axios from "axios";
import { Address, Hex, erc20Abi, parseUnits } from "viem";
import { API_BASE_URL } from "../src/utils/api";
import { run, setup } from "../src/utils/setup";

// see 02-assets.ts
const USDT0 = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const USDT0_TOKEN_ID = 3;

type UserCalldataResponse = {
  calldata: Hex;
  from: Address;
  to: Address;
  gas?: string;
};

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, walletClient, publicClient } = setup();
  const amount = parseUnits("11", 6);

  // `marketAcc` packs (root, accountId, tokenId, marketId). For cross margin
  // deposits, the marketId segment is CROSS_MARKET_ID (0xFFFFFF).
  const marketAcc = MarketAccLib.pack(
    account.address,
    0,
    USDT0_TOKEN_ID,
    CROSS_MARKET_ID
  );

  const { data } = await axios.post<UserCalldataResponse>(
    `${API_BASE_URL}/v1/calldata-builder/user/deposit`,
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
    args: [account.address, getRouterAddress()],
  });

  if (allowance < amount) {
    const approveTxHash = await walletClient.writeContract({
      address: USDT0,
      abi: erc20Abi,
      functionName: "approve",
      args: [getRouterAddress(), amount],
    });
    await waitForTransaction(publicClient, approveTxHash);
    console.log("Approve txHash:", approveTxHash);
  }

  const depositTxHash = await walletClient.sendTransaction({
    to: data.to,
    data: data.calldata,
  });
  await waitForTransaction(publicClient, depositTxHash);
  console.log("Deposit txHash:", depositTxHash);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `exchange.deposit` does the calldata build + ERC-20 approve + on-chain
// send in one call.
async function _mainSdk() {
  const { exchange, account } = setup();

  const receipt = await exchange.deposit({
    userAddress: account.address,
    tokenId: USDT0_TOKEN_ID,
    amount: parseUnits("11", 6),
    accountId: 0,
    marketId: CROSS_MARKET_ID,
  });

  console.log("Deposit txHash:", receipt.transactionHash);
}

run(mainDirect);
