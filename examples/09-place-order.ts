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

// Run `yarn example:markets` to see available markets
const MARKET_ID = 135; // BTCUSDC (2026-06-26)
const TICK_STEP = 2n; // from market.imData.tickStep

type PlaceOrderResponse = {
  calls: (AgentCall & {
    resolved?: { limitTick: string; actualRate?: number };
  })[];
};

// === Version 1 (default): direct API calls ===
//
// The simple, UI-style `/place-order` endpoint accepts `rate` (APR as a
// float) and the backend handles the tick conversion. For a resting limit
// order, GOOD_TIL_CANCELLED with no `slippage` rests at exactly `rate`.
async function mainDirect() {
  const { account, agent } = setup();

  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  const { data } = await axios.post<PlaceOrderResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/place-order`,
    {
      marketAcc,
      marketId: MARKET_ID,
      side: Side.LONG,
      size: FixedX18.fromNumber(11).value.toString(),
      tif: TimeInForce.GOOD_TIL_CANCELLED,
      rate: 0.02, // 2% APR
    }
  );

  const result = await signAndSubmit(agent, account.address, data.calls);
  console.log("Order result:", result);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `exchange.placeOrder` takes an integer `limitTick`, so we convert from
// APR using `estimateTickForRate` (from `@pendle/boros-offchain-math`).
async function _mainSdk() {
  const { exchange, account } = setup();
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  const limitTick = Number(
    estimateTickForRate(FixedX18.fromNumber(0.02), TICK_STEP, true)
  );

  const result = await exchange.placeOrder({
    marketAcc,
    marketId: MARKET_ID,
    side: Side.LONG,
    size: FixedX18.fromNumber(11).value,
    limitTick,
    tif: TimeInForce.GOOD_TIL_CANCELLED,
  });
  console.log("Order result:", result);
}

run(mainDirect);
