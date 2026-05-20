/**
 * Bulk Place Orders Example
 *
 * Demonstrates the **advanced** `/place-orders` endpoint — the right tool for
 * market-making / liquidity-provisioning flows that need to place many resting
 * orders at once, with optional atomic cancels.
 *
 * Why use it:
 *
 * 1. Lower gas fees — multiple sub-orders are batched into a single on-chain
 *    `bulkOrders` multicall, much cheaper than N individual placements.
 * 2. Atomic execution — placements and (optionally) cancels execute in one
 *    transaction, eliminating race windows.
 * 3. Complex strategies — combine per-market cancel + multi-tick placements
 *    across markets in a single batch.
 *
 * Important caveats:
 *
 * - `bulkOrders` placements do NOT match against the AMM. They are
 *   orderbook-only resting orders, intended for liquidity provisioning.
 * - For the common single-order UI case, use `/v1/calldata-builder/agent/place-order`
 *   instead (see `09-place-order.ts`).
 * - Every `bulkOrders.bulks[i]` must supply exactly one of `desiredRate` /
 *   `slippage`.
 * - Every entry under the same `orderRequests[]` must share `(root, accountId)`.
 */

import { FixedX18, estimateTickForRate } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  Side,
  TimeInForce,
} from "@pendle/boros-sdk-public";
import axios from "axios";
import { API_BASE_URL } from "../src/utils/api";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

// Run `yarn example:markets` to see available markets
const MARKET_ID = 135; // BTCUSDC (2026-06-26)

// tickStep: from market.imData.tickStep (run `yarn example:markets`)
const TICK_STEP = 2n;

enum OrderStatusV2 {
  Filling = 0,
  Cancelled = 1,
  FullyFilled = 2,
  Expired = 3,
  Purged = 4,
}

enum OrderType {
  LIMIT = 0,
  MARKET = 1,
  TAKE_PROFIT_MARKET = 2,
  STOP_LOSS_MARKET = 3,
}

type Order = {
  orderId: string;
  marketId: number;
  accountId: number;
  side: number;
  placedSize: string;
  unfilledSize: string;
  impliedApr: number;
  tick: number;
  status: number;
  orderType: number;
  marketAcc: string;
};

type PlaceOrdersResponse = {
  calls: (AgentCall & { resolved?: unknown })[];
};

const formatOrder = (o: Order) => ({
  orderId: o.orderId,
  marketId: o.marketId,
  side: o.side === Side.LONG ? "LONG" : "SHORT",
  size: FixedX18.fromBigIntString(o.placedSize).toNumber().toFixed(2),
  unfilledSize: FixedX18.fromBigIntString(o.unfilledSize).toNumber().toFixed(2),
  tick: o.tick,
  status: OrderStatusV2[o.status] ?? o.status,
});

async function getOrdersDirect(root: string, accountId: number, isActive: boolean) {
  const { data } = await axios.get<{
    results: Order[];
    resumeToken?: string;
  }>(`${API_BASE_URL}/v1/accounts/orders`, {
    params: {
      root,
      accountId,
      isActive,
      orderType: OrderType.LIMIT,
      limit: 50,
    },
  });
  return data;
}

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // ========================================
  // Step 1: Place a single seed order
  // ========================================
  console.log("\n=== Step 1: Placing a single seed order ===");

  const { data: placeOrderData } = await axios.post<PlaceOrdersResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/place-order`,
    {
      marketAcc,
      marketId: MARKET_ID,
      side: Side.LONG,
      size: FixedX18.fromNumber(11).value.toString(),
      tif: TimeInForce.GOOD_TIL_CANCELLED,
      rate: 0.02,
    }
  );

  const placeResult = await signAndSubmit(
    agent,
    account.address,
    placeOrderData.calls
  );
  console.log("Order placed:", placeResult);

  await sleep_s(2);

  // ========================================
  // Step 2: Get the active orders
  // ========================================
  console.log("\n=== Step 2: Getting active orders ===");

  const activeOrders = await getOrdersDirect(account.address, 0, true);

  console.log(`Found ${activeOrders.results.length} active orders:`);
  console.table(activeOrders.results.map(formatOrder));

  if (activeOrders.results.length === 0) {
    console.log("No active orders found. Exiting...");
    return;
  }

  // ========================================
  // Step 3: bulkOrders — cancel 1 order and place 2 more atomically
  // ========================================
  console.log("\n=== Step 3: bulkOrders — cancel 1 + place 2 in one call ===");

  const orderToCancel = activeOrders.results[0];
  console.log(`Will cancel order: ${orderToCancel.orderId}`);

  const limitTick2 = estimateTickForRate(
    FixedX18.fromNumber(0.02), // 2% APR
    TICK_STEP,
    false // round down
  );
  const limitTick3 = estimateTickForRate(
    FixedX18.fromNumber(0.01), // 1% APR
    TICK_STEP,
    false
  );

  const { data: bulkOrderData } = await axios.post<PlaceOrdersResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/place-orders`,
    {
      orderRequests: [
        {
          bulkOrders: {
            accountId: 0,
            // `cross: true` → all bulks[] execute against the cross account.
            // Mixing cross + isolated requires splitting into two
            // `orderRequests[]` entries.
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
                  limitTicks: [Number(limitTick2), Number(limitTick3)],
                  tif: TimeInForce.GOOD_TIL_CANCELLED,
                  side: Side.LONG,
                },
                // Per-entry slippage — backend computes
                // desiredRate = midRate ± slippage.
                slippage: 1,
              },
            ],
          },
        },
      ],
    }
  );

  const bulkResult = await signAndSubmit(
    agent,
    account.address,
    bulkOrderData.calls
  );
  console.log("Bulk operation result:", bulkResult);

  await sleep_s(2);

  // ========================================
  // Step 4: Print current state
  // ========================================
  console.log("\n=== Step 4: Current state ===");

  const updatedActive = await getOrdersDirect(account.address, 0, true);
  console.log(`\nActive orders (${updatedActive.results.length} shown):`);
  console.table(updatedActive.results.map(formatOrder));

  const historical = await getOrdersDirect(account.address, 0, false);
  console.log(`\nHistorical limit orders (${historical.results.length} shown):`);
  console.table(historical.results.map(formatOrder));
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `exchange.bulkPlaceOrders` accepts the same `orderRequests` shape with
// bigints instead of stringified bigints, and signs + executes in one call.
async function _mainSdk() {
  const { exchange, account } = setup();
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  console.log("\n=== Step 1: Placing a single seed order ===");
  const limitTickSeed = Number(
    estimateTickForRate(FixedX18.fromNumber(0.02), TICK_STEP, true)
  );
  const placed = await exchange.placeOrder({
    marketAcc,
    marketId: MARKET_ID,
    side: Side.LONG,
    size: FixedX18.fromNumber(11).value,
    limitTick: limitTickSeed,
    tif: TimeInForce.GOOD_TIL_CANCELLED,
  });
  console.log("Order placed:", placed);

  await sleep_s(2);

  console.log("\n=== Step 2: Getting active orders ===");
  const activeOrders = await exchange.getOrdersPage({
    isActive: true,
    orderType: [OrderType.LIMIT],
    limit: 50,
  });
  console.log(`Found ${activeOrders.results.length} active orders.`);
  if (activeOrders.results.length === 0) return;

  const orderToCancel = activeOrders.results[0];

  console.log("\n=== Step 3: bulkOrders — cancel 1 + place 2 ===");
  const limitTick2 = Number(
    estimateTickForRate(FixedX18.fromNumber(0.02), TICK_STEP, false)
  );
  const limitTick3 = Number(
    estimateTickForRate(FixedX18.fromNumber(0.01), TICK_STEP, false)
  );

  const bulkResult = await exchange.bulkPlaceOrders({
    orderRequests: [
      {
        cross: true,
        slippage: 1,
        bulks: [
          {
            marketId: MARKET_ID,
            cancelData: {
              ids: [BigInt(orderToCancel.orderId)],
              isAll: false,
              isStrict: true,
            },
            orders: {
              sizes: [FixedX18.fromNumber(15).value, FixedX18.fromNumber(20).value],
              limitTicks: [limitTick2, limitTick3],
              tif: TimeInForce.GOOD_TIL_CANCELLED,
              side: Side.LONG,
            },
          },
        ],
      },
    ],
  });
  console.log("Bulk operation result:", bulkResult);
}

run(mainDirect);
