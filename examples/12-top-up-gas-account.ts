import { FixedX18 } from "@pendle/boros-offchain-math";
import { Agent, CROSS_MARKET_ID, MarketAccLib } from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/utils/config";
import { run, signAndSubmit } from "../src/utils/setup";

// see 02-assets.ts
const USDT0_TOKEN_ID = 3;
const USDT0_COLLATERAL_MARKET_ID = 32;

type PayTreasuryResponse = {
  calldatas: Hex[];
};

type MarketAccInfo = {
  totalCash: string;
  availableInitialMargin: string;
  availableMaintMargin: string;
};

type GasBalanceResponse = {
  balanceInUSD: number;
};

/**
 * Top up gas account by paying from cross margin account to treasury.
 * This allows you to fund gas fees for trading operations using your deposited collateral.
 */
async function main() {
  const config = loadConfig();

  const walletAccount = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);

  // Step 1: Check current portfolio balance
  console.log("=== Current Portfolio Balance ===");
  const marketAcc = MarketAccLib.pack(
    walletAccount.address,
    0,
    USDT0_TOKEN_ID,
    CROSS_MARKET_ID
  );

  const { data: balanceData } = await axios.post<{ results: MarketAccInfo[] }>(
    `${config.apiBaseUrl}/open-api/v1/accounts/market-acc-infos`,
    { marketAccs: [marketAcc] }
  );

  const portfolioInfo = balanceData.results[0];
  const formatBalance = (v: string) =>
    FixedX18.fromBigIntString(v).toNumber().toFixed(2);

  console.log("Total cash:", formatBalance(portfolioInfo.totalCash));
  console.log(
    "Available IM:",
    formatBalance(portfolioInfo.availableInitialMargin)
  );

  // Step 2: Check current gas balance
  const { data: gasBalanceBefore } = await axios.get<GasBalanceResponse>(
    `${config.apiBaseUrl}/open-api/v1/accounts/gas-balance`,
    {
      params: { userAddress: walletAccount.address },
    }
  );

  console.log("\n=== Current Gas Balance ===");
  console.log("Gas balance (USD):", gasBalanceBefore.balanceInUSD);

  // Step 3: Pay to treasury to top up gas account
  console.log("\n=== Topping Up Gas Account ===");
  const amount = FixedX18.fromNumber(1).value.toString();

  const { data } = await axios.get<PayTreasuryResponse>(
    `${config.apiBaseUrl}/open-api/v1/calldata/pay-treasury`,
    {
      params: {
        isCross: true, // true = pay from cross margin account
        marketId: USDT0_COLLATERAL_MARKET_ID, // choose a market that has USDT0 as collateral
        usdAmount: 1
      },
    }
  );

  const payTreasuryResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    walletAccount.address,
    data.calldatas
  );

  console.log("Pay treasury result:", payTreasuryResult);

  // Step 4: Check gas balance after top-up
  const { data: gasBalanceAfter } = await axios.get<GasBalanceResponse>(
    `${config.apiBaseUrl}/open-api/v1/accounts/gas-balance`,
    {
      params: { userAddress: walletAccount.address },
    }
  );

  console.log("\n=== Gas Balance After Top-Up ===");
  console.log("Gas balance (USD):", gasBalanceAfter.balanceInUSD);
  console.log(
    `\nSuccessfully topped up gas account with ${FixedX18.fromBigIntString(amount).toNumber()} USDT0`
  );
}

run(main);
