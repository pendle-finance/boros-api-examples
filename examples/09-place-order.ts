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

// Run `yarn example:markets` to see available markets
const MARKET_ID = 21; // BTC-USD (2025-12-26)

async function main() {
  const { config, account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // Convert APR to tick (rate = 1.00005^(tick * tickStep) - 1)
  // tickStep: from market.imData.tickStep (run `yarn example:markets`)
  const TICK_STEP = 2n;
  const limitTick = estimateTickForRate(
    FixedX18.fromNumber(0.05), // 5% APR
    TICK_STEP,
    false // round down
  );

  const { data } = await axios.post<{ calldatas: Hex[] }>(
    `${config.apiBaseUrl}/open-api/v1/calldata/place-orders`,
    {
      orderRequests: [
        {
          singleOrder: {
            marketAcc,
            marketId: MARKET_ID,
            side: Side.LONG,
            size: FixedX18.fromNumber(1).value.toString(),
            limitTick: limitTick.toString(),
            tif: TimeInForce.GOOD_TIL_CANCELLED,
          },
        },
      ],
    }
  );

  const result = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calldatas
  );
  console.log("Order result:", result);
}

run(main);
