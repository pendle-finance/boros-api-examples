import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  getRouterAddress,
  waitForTransaction,
} from "@pendle/boros-sdk-public";
import axios from "axios";
import { Hex, erc20Abi, parseUnits } from "viem";
import { API_BASE_URL } from "../src/utils/api";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";

// see 02-assets.ts
const USDT0 = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const USDT0_TOKEN_ID = 3;

// Example isolated-only market (check 03-markets.ts to find current isolated-only markets)
const ISOLATED_MARKET_ID = 39;

type UserCalldataResponse = {
  calldata: Hex;
  from: Hex;
  to: Hex;
  gas?: string;
};

type AgentCalldataResponse = {
  calls: AgentCall[];
};

type MarketAccInfo = {
  totalCash: string;
  availableInitialMargin: string;
  availableMaintMargin: string;
};

/**
 * Top up an isolated-only market account.
 *
 * Isolated-only markets require collateral to be in the isolated account
 * (not cross). This example shows how to:
 * 1. Deposit to cross account (on-chain, user-signed)
 * 2. Cash-transfer from cross to isolated account (agent-signed, relayed)
 *
 * This is necessary because deposits always go to the cross account first,
 * and then you need to transfer into the isolated account.
 */

const formatBalance = (v: string) =>
  FixedX18.fromBigIntString(v).toNumber().toFixed(2);

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, agent, walletClient, publicClient } = setup();
  const depositAmount = parseUnits("11", 6); // 11 USDT0 (native decimals)
  const transferAmount = FixedX18.fromNumber(10); // 10 USDT0 → isolated (1e18-scaled)

  const crossMarketAcc = MarketAccLib.pack(
    account.address,
    0,
    USDT0_TOKEN_ID,
    CROSS_MARKET_ID
  );
  const isolatedMarketAcc = MarketAccLib.pack(
    account.address,
    0,
    USDT0_TOKEN_ID,
    ISOLATED_MARKET_ID
  );

  async function getBalances() {
    const { data } = await axios.post<{ results: MarketAccInfo[] }>(
      `${API_BASE_URL}/v1/accounts/market-acc-infos`,
      { marketAccs: [crossMarketAcc, isolatedMarketAcc] }
    );
    return { cross: data.results[0], isolated: data.results[1] };
  }

  // Step 1: Check balances before
  console.log("=== Balances BEFORE ===");
  const balancesBefore = await getBalances();

  console.log("Cross account:");
  console.log("  Total cash:", formatBalance(balancesBefore.cross.totalCash));
  console.log("  Available IM:", formatBalance(balancesBefore.cross.availableInitialMargin));

  console.log(`\nIsolated account (Market ${ISOLATED_MARKET_ID}):`);
  console.log("  Total cash:", formatBalance(balancesBefore.isolated.totalCash));
  console.log("  Available IM:", formatBalance(balancesBefore.isolated.availableInitialMargin));

  // Step 2: Deposit to cross account (on-chain)
  console.log("\n=== Depositing to Cross Account ===");

  const { data: depositData } = await axios.post<UserCalldataResponse>(
    `${API_BASE_URL}/v1/calldata-builder/user/deposit`,
    { marketAcc: crossMarketAcc, amount: depositAmount.toString() }
  );

  const allowance = await publicClient.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, getRouterAddress()],
  });

  if (allowance < depositAmount) {
    console.log("Approving USDT0...");
    const approveTxHash = await walletClient.writeContract({
      address: USDT0,
      abi: erc20Abi,
      functionName: "approve",
      args: [getRouterAddress(), depositAmount],
    });
    await waitForTransaction(publicClient, approveTxHash);
    console.log("Approve txHash:", approveTxHash);
  }

  const depositTxHash = await walletClient.sendTransaction({
    to: depositData.to,
    data: depositData.calldata,
  });
  await waitForTransaction(publicClient, depositTxHash);
  console.log("Deposit txHash:", depositTxHash);

  // Step 3: Cash transfer from cross to isolated (agent-signed)
  console.log("\n=== Cash Transfer: Cross -> Isolated ===");

  const { data: transferData } = await axios.post<AgentCalldataResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/cash-transfer`,
    {
      accountId: 0,
      marketId: ISOLATED_MARKET_ID,
      direction: "CROSS_TO_ISOLATED",
      amount: transferAmount.value.toString(),
    }
  );

  const transferResult = await signAndSubmit(
    agent,
    account.address,
    transferData.calls
  );
  console.log("Cash transfer result:", transferResult);

  // Step 4: Check balances after
  console.log("\n=== Balances AFTER ===");
  const balancesAfter = await getBalances();

  console.log("Cross account:");
  console.log("  Total cash:", formatBalance(balancesAfter.cross.totalCash));
  console.log("  Available IM:", formatBalance(balancesAfter.cross.availableInitialMargin));

  console.log(`\nIsolated account (Market ${ISOLATED_MARKET_ID}):`);
  console.log("  Total cash:", formatBalance(balancesAfter.isolated.totalCash));
  console.log("  Available IM:", formatBalance(balancesAfter.isolated.availableInitialMargin));

  // Summary
  console.log("\n=== Summary ===");
  const crossDiff =
    FixedX18.fromBigIntString(balancesAfter.cross.totalCash).toNumber() -
    FixedX18.fromBigIntString(balancesBefore.cross.totalCash).toNumber();
  const isolatedDiff =
    FixedX18.fromBigIntString(balancesAfter.isolated.totalCash).toNumber() -
    FixedX18.fromBigIntString(balancesBefore.isolated.totalCash).toNumber();

  console.log(`Cross account change: ${crossDiff >= 0 ? "+" : ""}${crossDiff.toFixed(2)} USDT0`);
  console.log(`Isolated account change: ${isolatedDiff >= 0 ? "+" : ""}${isolatedDiff.toFixed(2)} USDT0`);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `exchange.deposit` + `exchange.cashTransfer` collapse the deposit and
// transfer flows into two calls.
async function _mainSdk() {
  const { exchange, account } = setup();

  const depositReceipt = await exchange.deposit({
    userAddress: account.address,
    tokenId: USDT0_TOKEN_ID,
    amount: parseUnits("11", 6),
    accountId: 0,
    marketId: CROSS_MARKET_ID,
  });
  console.log("Deposit txHash:", depositReceipt.transactionHash);

  const transferResult = await exchange.cashTransfer({
    marketId: ISOLATED_MARKET_ID,
    isDeposit: true, // CROSS_TO_ISOLATED
    amount: FixedX18.fromNumber(10).value,
  });
  console.log("Cash transfer result:", transferResult);
}

run(mainDirect);
