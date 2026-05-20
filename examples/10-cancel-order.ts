import { FixedX18 } from "@pendle/boros-offchain-math";
import { Side } from "@pendle/sdk-boros";
import axios from "axios";
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

async function main() {
  const { config, account, agent } = setup();

  // Query active orders (cursor-based pagination, sorted by last-updated).
  // `orderType` accepts a single value or a CSV list.
  const { data: activeOrders } = await axios.get<{
    results: Order[];
    resumeToken?: string;
  }>(`${config.apiBaseUrl}/apis/v1/accounts/orders`, {
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

  const formatOrder = (o: Order) => ({
    orderId: o.orderId,
    marketId: o.marketId,
    side: o.side === Side.LONG ? "LONG" : "SHORT",
    size: FixedX18.fromBigIntString(o.placedSize).toNumber().toFixed(2),
    status: OrderStatusV2[o.status] ?? o.status,
  });

  console.log(`Found ${activeOrders.results.length} active orders:`);
  console.table(activeOrders.results.map(formatOrder));

  const orderToCancel = activeOrders.results[0];
  console.log(`Cancelling order ${orderToCancel.orderId}...`);

  // Cancel-orders is multi-market; one on-chain `bulkCancels` call per
  // `markets[]` entry. The response has N `calls` for N markets.
  const { data } = await axios.post<CancelOrdersResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/cancel-orders`,
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

  const result = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calls
  );
  console.log("Cancel result:", result);

  // Wait for indexer to update
  await sleep_s(2);

  // Query order history to verify cancellation
  const { data: history } = await axios.get<{
    results: Order[];
    resumeToken?: string;
  }>(`${config.apiBaseUrl}/apis/v1/accounts/orders`, {
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

run(main);
