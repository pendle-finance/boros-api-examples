import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  Side,
  TimeInForce,
} from "@pendle/sdk-boros";
import axios from "axios";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

// Run `yarn example:markets` to see available markets
const MARKET_ID = 135; // BTCUSDC (2026-06-26)
const SIZE = 11; // 1 USDT notional (internally 18 decimals)

type Position = {
  marketId: number;
  signedSize: string;
  positionValue: string;
};

type MarketAccInfo = {
  totalCash: string;
  netBalance: string;
  positions: Position[];
  availableInitialMargin: string;
  availableMaintMargin: string;
};

type PlaceOrderResponse = {
  calls: (AgentCall & {
    resolved?: { limitTick: string; actualRate?: number };
  })[];
};

async function main() {
  const { config, account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0 (run `yarn example:assets`)
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // Open position (LONG) — `FILL_OR_KILL` with `rate` omitted asks the
  // backend to match at the side's extreme tick (swallow at any rate).
  // If neither `slippage` nor `desiredRate` is provided, the backend
  // applies the default 5% slippage for FOK market orders.
  const { data: openData } = await axios.post<PlaceOrderResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/place-order`,
    {
      marketAcc,
      marketId: MARKET_ID,
      side: Side.LONG,
      size: FixedX18.fromNumber(SIZE).value.toString(),
      tif: TimeInForce.FILL_OR_KILL,
      slippage: 0.05, // 5% absolute slippage in APR
    }
  );
  const openResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    openData.calls
  );
  console.log("Open:", openResult);

  await sleep_s(5);

  // Query position
  const {
    data: {
      results: [marketAccInfo],
    },
  } = await axios.post<{ results: MarketAccInfo[] }>(
    `${config.apiBaseUrl}/apis/v1/accounts/market-acc-infos`,
    { marketAccs: [marketAcc] }
  );
  const positionSize = marketAccInfo.positions.find(
    (p) => p.marketId === MARKET_ID
  )?.signedSize;

  if (positionSize == null) {
    console.log("No position found");
    return;
  }
  console.log(
    "Position size:",
    FixedX18.fromBigIntString(positionSize).toNumber()
  );

  // Close position (SHORT)
  const { data: closeData } = await axios.post<PlaceOrderResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/place-order`,
    {
      marketAcc,
      marketId: MARKET_ID,
      side: Side.SHORT,
      size: positionSize,
      tif: TimeInForce.FILL_OR_KILL,
      slippage: 0.05,
    }
  );
  const closeResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    closeData.calls
  );
  console.log("Close:", closeResult);
}

run(main);
