import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  Side,
  TICK_MAX_VALUE,
  TICK_MIN_VALUE,
  TimeInForce,
} from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { run, setup, signAndSubmit } from "../src/utils/setup";
import { sleep_s } from "../src/utils/time";

// Run `yarn example:markets` to see available markets
const MARKET_ID = 21; // BTC-USD (2025-12-26)
const SIZE = 1; // 1 USDT notional (internally 18 decimals)

type Position = {
  marketId: number;
  signedSize: string;
  positionValue: string;
  liquidationApr: string;
  initialMargin: string;
  maintMargin: string;
  orders: unknown[];
};

type MarketAccInfo = {
  totalCash: string;
  positions: Position[];
  availableInitialMargin: string;
  availableMaintMargin: string;
};

async function main() {
  const { config, account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0 (run `yarn example:assets`)
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // Open position (LONG)
  const { data: openData } = await axios.post<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/place-orders`,
    {
      orderRequests: [
        {
          singleOrder: {
            marketAcc,
            marketId: MARKET_ID,
            side: Side.LONG,
            size: FixedX18.fromNumber(SIZE).value.toString(),
            // limitTick is the worst rate you're willing to accept, so
            // for market long order, we use the max tick (accepts all rates)
            limitTick: TICK_MAX_VALUE,
            tif: TimeInForce.FILL_OR_KILL,
            slippage: 0.05, // 5% absolute slippage in APR
          },
        },
      ],
    }
  );
  const openResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    openData.calldatas
  );
  console.log("Open:", openResult);

  await sleep_s(5);

  // Query position
  const {
    data: {
      results: [marketAccInfo],
    },
  } = await axios.post<{ results: MarketAccInfo[] }>(
    `${config.apiBaseUrl}/open-api/v1/accounts/market-acc-infos`,
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
  const { data: closeData } = await axios.post<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/place-orders`,
    {
      orderRequests: [
        {
          singleOrder: {
            marketAcc,
            marketId: MARKET_ID,
            side: Side.SHORT,
            size: positionSize,
            limitTick: TICK_MIN_VALUE,
            tif: TimeInForce.FILL_OR_KILL,
            slippage: 0.05, // 5% absolute slippage in APR
          },
        },
      ],
    }
  );
  const closeResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    closeData.calldatas
  );
  console.log("Close:", closeResult);
}

run(main);
