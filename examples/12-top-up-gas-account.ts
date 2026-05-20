import { FixedX18 } from "@pendle/boros-offchain-math";
import { CROSS_MARKET_ID, MarketAccLib } from "@pendle/sdk-boros";
import axios from "axios";
import { parseUnits } from "viem";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";

// see 02-assets.ts
const USDT0_TOKEN_ID = 3;
const USDT0_DECIMALS = 6;
const USDT0_COLLATERAL_MARKET_ID = 32;

type AgentCalldataResponse = {
  calls: AgentCall[];
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
 * Top up gas account by paying the treasury from a cross-margin account.
 * The agent-signed `/pay-treasury` endpoint deducts the amount from the
 * user's on-chain collateral and credits the user's off-chain gas balance,
 * which is what the send-txs bot charges when it relays agent calls.
 *
 * `amount` is a bigint string in the paying token's **native decimals**
 * (USDT0 has 6 decimals). The endpoint does not do USD conversion.
 */
async function main() {
  const { config, account, agent } = setup();

  // Step 1: Check current portfolio balance
  console.log("=== Current Portfolio Balance ===");
  const marketAcc = MarketAccLib.pack(
    account.address,
    0,
    USDT0_TOKEN_ID,
    CROSS_MARKET_ID
  );

  const { data: balanceData } = await axios.post<{ results: MarketAccInfo[] }>(
    `${config.apiBaseUrl}/apis/v1/accounts/market-acc-infos`,
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
    `${config.apiBaseUrl}/apis/v1/accounts/gas-balance`,
    {
      params: { root: account.address },
    }
  );

  console.log("\n=== Current Gas Balance ===");
  console.log("Gas balance (USD):", gasBalanceBefore.balanceInUSD);

  // Step 3: Pay to treasury to top up gas account.
  // Pay 1 USDT0 — native USDT0 decimals (6), so 1e6.
  console.log("\n=== Topping Up Gas Account ===");
  const amount = parseUnits("1", USDT0_DECIMALS);

  const { data } = await axios.post<AgentCalldataResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/pay-treasury`,
    {
      accountId: 0,
      isCross: true, // true = pay from the cross-margin account
      marketId: USDT0_COLLATERAL_MARKET_ID, // any market that has USDT0 as collateral
      amount: amount.toString(),
    }
  );

  const payTreasuryResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calls
  );

  console.log("Pay treasury result:", payTreasuryResult);

  // Step 4: Check gas balance after top-up
  const { data: gasBalanceAfter } = await axios.get<GasBalanceResponse>(
    `${config.apiBaseUrl}/apis/v1/accounts/gas-balance`,
    {
      params: { root: account.address },
    }
  );

  console.log("\n=== Gas Balance After Top-Up ===");
  console.log("Gas balance (USD):", gasBalanceAfter.balanceInUSD);
  console.log(`\nSuccessfully topped up gas account with 1 USDT0`);
}

run(main);
