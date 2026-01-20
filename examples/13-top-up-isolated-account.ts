import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  Agent,
  CROSS_MARKET_ID,
  MarketAccLib,
  waitForTransaction,
} from "@pendle/sdk-boros";
import axios from "axios";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  Hex,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { getAddresses } from "../src/utils/addresses";
import { loadConfig } from "../src/utils/config";
import { run, signAndSubmit } from "../src/utils/setup";

// see 02-assets.ts
const USDT0 = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const USDT0_TOKEN_ID = 3;

// Example isolated-only market (check 03-markets.ts to find current isolated-only markets)
const ISOLATED_MARKET_ID = 39;

type DepositCalldata = { data: Hex; from: Hex; to: Hex; gas: string };

type CashTransferResponse = {
  calldatas: Hex[];
};

type MarketAccInfo = {
  totalCash: string;
  availableInitialMargin: string;
  availableMaintMargin: string;
};

/**
 * Top up an isolated-only market account.
 *
 * Isolated-only markets require collateral to be in the isolated account (not cross).
 * This example shows how to:
 * 1. Deposit to cross account (on-chain)
 * 2. Cash transfer from cross to isolated account (off-chain)
 *
 * This is necessary because deposits always go to the cross account first,
 * and then you need to transfer to the isolated account.
 */
async function main() {
  const config = loadConfig();
  const depositAmount = parseUnits("11", 6); // 11 USDT0
  const transferAmount = FixedX18.fromNumber(10); // 10 USDT0 to isolated

  const walletAccount = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);

  const client = createWalletClient({
    account: walletAccount,
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });

  // Helper to format balance
  const formatBalance = (v: string) =>
    FixedX18.fromBigIntString(v).toNumber().toFixed(2);

  // Helper to get account balances
  async function getBalances() {
    const crossMarketAcc = MarketAccLib.pack(
      walletAccount.address,
      0,
      USDT0_TOKEN_ID,
      CROSS_MARKET_ID
    );
    const isolatedMarketAcc = MarketAccLib.pack(
      walletAccount.address,
      0,
      USDT0_TOKEN_ID,
      ISOLATED_MARKET_ID
    );

    const { data } = await axios.post<{ results: MarketAccInfo[] }>(
      `${config.apiBaseUrl}/open-api/v1/accounts/market-acc-infos`,
      { marketAccs: [crossMarketAcc, isolatedMarketAcc] }
    );

    return {
      cross: data.results[0],
      isolated: data.results[1],
    };
  }

  // Step 1: Check balances before
  console.log("=== Balances BEFORE ===");
  const balancesBefore = await getBalances();

  console.log("Cross account:");
  console.log("  Total cash:", formatBalance(balancesBefore.cross.totalCash));
  console.log(
    "  Available IM:",
    formatBalance(balancesBefore.cross.availableInitialMargin)
  );

  console.log(`\nIsolated account (Market ${ISOLATED_MARKET_ID}):`);
  console.log(
    "  Total cash:",
    formatBalance(balancesBefore.isolated.totalCash)
  );
  console.log(
    "  Available IM:",
    formatBalance(balancesBefore.isolated.availableInitialMargin)
  );

  // Step 2: Deposit to cross account (on-chain)
  console.log("\n=== Depositing to Cross Account ===");

  const { data: depositData } = await axios.get<DepositCalldata>(
    `${config.apiBaseUrl}/open-api/v1/calldata/deposit`,
    {
      params: {
        userAddress: walletAccount.address,
        tokenId: USDT0_TOKEN_ID,
        amount: depositAmount.toString(),
        accountId: 0,
        marketId: CROSS_MARKET_ID,
      },
    }
  );

  // Check and approve if needed
  const allowance = await publicClient.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: "allowance",
    args: [walletAccount.address, getAddresses().router],
  });

  if (allowance < depositAmount) {
    console.log("Approving USDT0...");
    const approveTxHash = await client.writeContract({
      address: USDT0,
      abi: erc20Abi,
      functionName: "approve",
      args: [getAddresses().router, depositAmount],
    });
    await waitForTransaction(publicClient, approveTxHash);
    console.log("Approve txHash:", approveTxHash);
  }

  const depositTxHash = await client.sendTransaction({
    to: depositData.to,
    data: depositData.data,
  });
  await waitForTransaction(publicClient, depositTxHash);
  console.log("Deposit txHash:", depositTxHash);

  // Step 3: Cash transfer from cross to isolated (off-chain)
  console.log("\n=== Cash Transfer: Cross -> Isolated ===");

  const { data: transferData } = await axios.get<CashTransferResponse>(
    `${config.apiBaseUrl}/open-api/v1/calldata/cash-transfer`,
    {
      params: {
        marketId: ISOLATED_MARKET_ID,
        isDeposit: true, // true = cross -> isolated
        amount: transferAmount.value.toString(),
      },
    }
  );

  const transferResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    walletAccount.address,
    transferData.calldatas,
  );

  console.log("Cash transfer result:", transferResult);

  // Step 4: Check balances after
  console.log("\n=== Balances AFTER ===");
  const balancesAfter = await getBalances();

  console.log("Cross account:");
  console.log("  Total cash:", formatBalance(balancesAfter.cross.totalCash));
  console.log(
    "  Available IM:",
    formatBalance(balancesAfter.cross.availableInitialMargin)
  );

  console.log(`\nIsolated account (Market ${ISOLATED_MARKET_ID}):`);
  console.log("  Total cash:", formatBalance(balancesAfter.isolated.totalCash));
  console.log(
    "  Available IM:",
    formatBalance(balancesAfter.isolated.availableInitialMargin)
  );

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

run(main);
