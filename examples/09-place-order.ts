import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  Side,
  TimeInForce,
} from "@pendle/sdk-boros";
import axios from "axios";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";

// Run `yarn example:markets` to see available markets
const MARKET_ID = 135; // BTCUSDC (2026-06-26)

type PlaceOrderResponse = {
  calls: (AgentCall & {
    resolved?: { limitTick: string; actualRate?: number };
  })[];
};

async function main() {
  const { config, account, agent } = setup();

  // MarketAccLib.pack(address, accountId, tokenId, marketId)
  // - tokenId: 3 = USDT0
  // - marketId: CROSS_MARKET_ID for cross-margin, or specific marketId for isolated
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  // Use the simple, UI-style `/place-order` endpoint: pass `rate` (APR as a
  // float) and the backend handles the tick conversion. For a resting limit
  // order, GOOD_TIL_CANCELLED with no `slippage` rests at exactly `rate`.
  const { data } = await axios.post<PlaceOrderResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/place-order`,
    {
      marketAcc,
      marketId: MARKET_ID,
      side: Side.LONG,
      size: FixedX18.fromNumber(11).value.toString(),
      tif: TimeInForce.GOOD_TIL_CANCELLED,
      rate: 0.02, // 2% APR
    }
  );

  const result = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calls
  );
  console.log("Order result:", result);
}

run(main);
