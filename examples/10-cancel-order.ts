import { FixedX18 } from "@pendle/boros-offchain-math";
import { Side } from "@pendle/boros-sdk-public";
import axios from "axios";
import { API_BASE_URL } from "../src/utils/api";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

enum OrderStatusV2 {
  Filling = 0,
  Cancelled = 1,
  FullyFilled = 2,
  Expired = 3,
  Purged = 4,
  Pending = 5,
  Executing = 6,
  Retrying = 7,
  Failed = 8,
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

type CancelOrdersResponse = {
  calls: AgentCall[];
};

const formatOrder = (o: Order) => ({
  orderId: o.orderId,
  marketId: o.marketId,
  side: o.side === Side.LONG ? "LONG" : "SHORT",
  size: FixedX18.fromBigIntString(o.placedSize).toNumber().toFixed(2),
  status: OrderStatusV2[o.status] ?? o.status,
});

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, agent } = setup();

  // Query active orders (cursor-based pagination, sorted by last-updated).
  // `orderType` accepts a single value or a CSV list.
  const { data: activeOrders } = await axios.get<{
    results: Order[];
    resumeToken?: string;
  }>(`${API_BASE_URL}/v1/accounts/orders`, {
    params: {
      root: account.address,
      accountId: 0,
      isActive: true,
      orderType: OrderType.LIMIT,
      limit: 10,
    },
  });

  if (activeOrders.results.length === 0) {
    console.log("No active orders to cancel");
    return;
  }

  console.log(`Found ${activeOrders.results.length} active orders:`);
  console.table(activeOrders.results.map(formatOrder));

  const orderToCancel = activeOrders.results[0];
  console.log(`Cancelling order ${orderToCancel.orderId}...`);

  // Cancel-orders is multi-market; one on-chain `bulkCancels` call per
  // `markets[]` entry. The response has N `calls` for N markets.
  const { data } = await axios.post<CancelOrdersResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/cancel-orders`,
    {
      markets: [
        {
          marketAcc: orderToCancel.marketAcc,
          marketId: orderToCancel.marketId,
          cancelAll: false,
          orderIds: [orderToCancel.orderId],
        },
      ],
    }
  );

  const result = await signAndSubmit(agent, account.address, data.calls);
  console.log("Cancel result:", result);

  // Wait for indexer to update
  await sleep_s(2);

  // Query order history to verify cancellation
  const { data: history } = await axios.get<{
    results: Order[];
    resumeToken?: string;
  }>(`${API_BASE_URL}/v1/accounts/orders`, {
    params: {
      root: account.address,
      accountId: 0,
      isActive: false,
      limit: 5,
    },
  });

  console.log(`Order history (${history.results.length} shown):`);
  console.table(history.results.map(formatOrder));
}

// === Version 2: using @pendle/boros-sdk-public ===
async function _mainSdk() {
  const { exchange } = setup();

  const activeOrders = await exchange.getOrdersPage({
    isActive: true,
    orderType: [OrderType.LIMIT],
    limit: 10,
  });

  if (activeOrders.results.length === 0) {
    console.log("No active orders to cancel");
    return;
  }

  console.log(`Found ${activeOrders.results.length} active orders:`);
  console.table(activeOrders.results.map(formatOrder as any));

  const orderToCancel = activeOrders.results[0];
  console.log(`Cancelling order ${orderToCancel.orderId}...`);

  const result = await exchange.cancelOrders({
    marketAcc: orderToCancel.marketAcc as `0x${string}`,
    marketId: orderToCancel.marketId,
    cancelAll: false,
    orderIds: [orderToCancel.orderId],
  });
  console.log("Cancel result:", result);

  await sleep_s(2);

  const history = await exchange.getOrdersPage({
    isActive: false,
    limit: 5,
  });
  console.log(`Order history (${history.results.length} shown):`);
  console.table(history.results.map(formatOrder as any));
}

run(mainDirect);
