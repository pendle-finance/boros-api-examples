/**
 * Bulk Place Orders Example
 *
 * This example demonstrates the bulk order placement feature, which is more efficient
 * than placing individual orders. Bulk operations provide several key benefits:
 *
 * 1. Lower Gas Fees: Multiple operations are batched into a single transaction,
 *    significantly reducing the total gas cost compared to executing separate transactions
 *
 * 2. Atomic Execution: All operations (cancellations and new orders) execute atomically,
 *    ensuring consistency and eliminating partial execution risks
 *
 * 3. Better Performance: Reduces network overhead and speeds up execution by minimizing
 *    the number of blockchain transactions
 *
 * 4. Complex Strategies: Enables sophisticated trading strategies by combining order
 *    cancellations and placements in a single operation
 *
 * Important Note:
 * - Unlike single order placement, bulk placed orders do NOT match with the AMM.
 *
 * Use bulk operations when you need to:
 * - Cancel and replace multiple orders simultaneously
 * - Place multiple orders at different price levels
 * - Execute complex order management strategies efficiently
 */

import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  estimateTickForRate,
  MarketAccLib,
  Side,
  TimeInForce,
} from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

// Run `yarn example:markets` to see available markets
const MARKET_ID = 21; // BTC-USD (2025-12-26)

enum OrderStatus {
  ACTIVE = 0,
  CANCELED = 1,
  FILLED = 2,
}

enum OrderType {
  LIMIT = 0,
  MARKET = 1,
  TAKE_PROFIT_MARKET = 2,
  STOP_LOSS_MARKET = 3,
}

type LimitOrder = {
  orderId: string;
  marketId: number;
  accountId: number;
  side: number;
  placedSize: string;
  unfilledSize: string;
  impliedApr: number;
  tick: number;
  status: OrderStatus;
  orderType: OrderType;
  marketAcc: string;
};

const formatOrder = (o: LimitOrder) => ({
  orderId: o.orderId,
  marketId: o.marketId,
  side: o.side === Side.LONG ? "LONG" : "SHORT",
  size: FixedX18.fromBigIntString(o.placedSize).toNumber().toFixed(2),
  unfilledSize: FixedX18.fromBigIntString(o.unfilledSize).toNumber().toFixed(2),
  tick: o.tick,
  status: OrderStatus[o.status],
});

async function getActiveOrders(
  apiBaseUrl: string,
  userAddress: string,
  accountId: number
) {
  const { data } = await axios.get<{
    results: LimitOrder[];
    total: number;
  }>(`${apiBaseUrl}/open-api/v1/accounts/limit-orders`, {
    params: {
      userAddress,
      accountId,
      isActive: true,
      orderType: OrderType.LIMIT,
      limit: 50,
    },
  });
  return data;
}

async function getHistoricalOrders(
  apiBaseUrl: string,
  userAddress: string,
  accountId: number
) {
  const { data } = await axios.get<{
    results: LimitOrder[];
    total: number;
  }>(`${apiBaseUrl}/open-api/v1/accounts/limit-orders`, {
    params: {
      userAddress,
      accountId,
      isActive: false,
      limit: 10,
    },
  });
  return data;
}

async function main() {
  const { config, account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // Convert APR to tick (rate = 1.00005^(tick * tickStep) - 1)
  // tickStep: from market.imData.tickStep (run `yarn example:markets`)
  const TICK_STEP = 2n;

  // ========================================
  // Step 1: Place a single order
  // ========================================
  console.log("\n=== Step 1: Placing a single order ===");

  const limitTick1 = estimateTickForRate(
    FixedX18.fromNumber(0.05), // 5% APR
    TICK_STEP,
    false // round down
  );

  const { data: placeOrderData } = await axios.post<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/place-orders`,
    {
      orderRequests: [
        {
          singleOrder: {
            marketAcc,
            marketId: MARKET_ID,
            side: Side.LONG,
            size: FixedX18.fromNumber(1).value.toString(),
            limitTick: limitTick1.toString(),
            tif: TimeInForce.GOOD_TIL_CANCELLED,
          },
        },
      ],
    }
  );

  const placeResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    placeOrderData.calldatas
  );
  console.log("Order placed:", placeResult);

  // Wait for indexer to update
  await sleep_s(2);

  // ========================================
  // Step 2: Get the active orders
  // ========================================
  console.log("\n=== Step 2: Getting active orders ===");

  const activeOrders = await getActiveOrders(
    config.apiBaseUrl,
    account.address,
    0
  );

  console.log(`Found ${activeOrders.total} active orders:`);
  console.table(activeOrders.results.map(formatOrder));

  if (activeOrders.results.length === 0) {
    console.log("No active orders found. Exiting...");
    return;
  }

  // ========================================
  // Step 3: Bulk place orders - cancel 1 order and place 2 more
  // ========================================
  console.log("\n=== Step 3: Bulk operation - Cancel 1 order and place 2 new orders ===");

  const orderToCancel = activeOrders.results[0];
  console.log(`Will cancel order: ${orderToCancel.orderId}`);

  // Prepare 2 new orders with different ticks
  const limitTick2 = estimateTickForRate(
    FixedX18.fromNumber(0.04), // 4% APR
    TICK_STEP,
    false
  );

  const limitTick3 = estimateTickForRate(
    FixedX18.fromNumber(0.03), // 3% APR
    TICK_STEP,
    false
  );

  const { data: bulkOrderData } = await axios.post<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/place-orders`,
    {
      orderRequests: [
        {
          bulkOrder: {
            cross: true,
            bulks: [
              {
                marketId: MARKET_ID,
                cancelData: {
                  ids: [orderToCancel.orderId],
                  isAll: false,
                  isStrict: true,
                },
                orders: {
                  sizes: [
                    FixedX18.fromNumber(15).value.toString(),
                    FixedX18.fromNumber(20).value.toString(),
                  ],
                  limitTicks: [
                    Number(limitTick2),
                    Number(limitTick3),
                  ],
                  tif: TimeInForce.GOOD_TIL_CANCELLED,
                  side: Side.LONG,
                },
              },
            ],
            slippage: 1,
          },
        },
      ],
    }
  );

  const bulkResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    bulkOrderData.calldatas
  );
  console.log("Bulk operation result:", bulkResult);

  // Wait for indexer to update
  await sleep_s(2);

  // ========================================
  // Step 4: Print current state
  // ========================================
  console.log("\n=== Step 4: Current state ===");

  const updatedActiveOrders = await getActiveOrders(
    config.apiBaseUrl,
    account.address,
    0
  );

  console.log(`\nActive orders (${updatedActiveOrders.total} total):`);
  console.table(updatedActiveOrders.results.map(formatOrder));

  const historicalOrders = await getHistoricalOrders(
    config.apiBaseUrl,
    account.address,
    0
  );

  console.log(`\nHistorical limit orders (${historicalOrders.total} total):`);
  console.table(historicalOrders.results.map(formatOrder));
}

run(main);
