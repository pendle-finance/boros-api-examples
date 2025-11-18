import { FixedX18 } from "@pendle/boros-offchain-math";
import { Side } from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

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

async function main() {
  const { config, account, agent } = setup();

  // Query active orders
  const { data: activeOrders } = await axios.get<{
    results: LimitOrder[];
    total: number;
  }>(`${config.apiBaseUrl}/open-api/v1/accounts/limit-orders`, {
    params: {
      userAddress: account.address,
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

  const formatOrder = (o: LimitOrder) => ({
    orderId: o.orderId,
    marketId: o.marketId,
    side: o.side === Side.LONG ? "LONG" : "SHORT",
    size: FixedX18.fromBigIntString(o.placedSize).toNumber().toFixed(2),
    status: OrderStatus[o.status],
  });

  console.log(`Found ${activeOrders.total} active orders:`);
  console.table(activeOrders.results.map(formatOrder));

  const orderToCancel = activeOrders.results[0];
  console.log(`Cancelling order ${orderToCancel.orderId}...`);

  // Get cancel calldata
  const { data } = await axios.get<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/cancel-order`,
    {
      params: {
        marketAcc: orderToCancel.marketAcc,
        marketId: orderToCancel.marketId,
        cancelAll: false,
        orderIds: orderToCancel.orderId,
      },
    }
  );

  const result = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calldatas
  );
  console.log("Cancel result:", result);

  // Wait for indexer to update
  await sleep_s(2);

  // Query order history to verify cancellation
  const { data: history } = await axios.get<{
    results: LimitOrder[];
    total: number;
  }>(`${config.apiBaseUrl}/open-api/v1/accounts/limit-orders`, {
    params: {
      userAddress: account.address,
      accountId: 0,
      isActive: false,
      limit: 5,
    },
  });

  console.log(`Order history (${history.total} total):`);
  console.table(history.results.map(formatOrder));
}

run(main);
