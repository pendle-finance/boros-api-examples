import { FixedX18 } from "@pendle/boros-offchain-math";
import {
  CROSS_MARKET_ID,
  MarketAccLib,
  getOpenApiSdk,
} from "@pendle/boros-sdk-public";
import axios from "axios";
import { API_BASE_URL } from "../src/utils/api";
import { run, setup } from "../src/utils/setup";

type MarketAccInfo = {
  marketAcc: string;
  totalCash: string;
  netBalance: string;
  initialMargin: string;
  initialMarginWithLeverage: string;
  availableInitialMargin: string;
  availableMaintMargin: string;
  positions: {
    marketId: number;
    signedSize: string;
    positionValue: string;
  }[];
};

const format = (v: string) =>
  FixedX18.fromBigIntString(v).toNumber().toFixed(2);

function printInfo(info: MarketAccInfo) {
  console.log("Cross-margin account:");
  console.log("  Total cash:", format(info.totalCash));
  console.log("  Net balance:", format(info.netBalance));
  console.log("  Available IM:", format(info.availableInitialMargin));
  console.log("  Available MM:", format(info.availableMaintMargin));

  if (info.positions.length > 0) {
    console.log("\nPositions:");
    console.table(
      info.positions.map((p) => ({
        marketId: p.marketId,
        signedSize: FixedX18.fromBigIntString(p.signedSize).toNumber().toFixed(4),
        positionValue: FixedX18.fromBigIntString(p.positionValue).toNumber().toFixed(4),
      }))
    );
  }
}

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account } = setup();

  // Query cross-margin account (tokenId=3 is USDT0)
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  const { data } = await axios.post<{ results: MarketAccInfo[] }>(
    `${API_BASE_URL}/v1/accounts/market-acc-infos`,
    { marketAccs: [marketAcc] }
  );

  printInfo(data.results[0]);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// The SDK doesn't expose a high-level helper for batch-margin-state lookups,
// so this calls the typed OpenAPI client directly. The SDK's
// `Exchange.getUserPositions` is contract-based and returns a different
// shape (per-position rather than per-marketAcc).
async function _mainSdk() {
  const { account } = setup();
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  const { data } = await getOpenApiSdk().accounts.accountsV2ControllerGetMarketAccInfos(
    { marketAccs: [marketAcc] }
  );

  printInfo(data.results[0] as unknown as MarketAccInfo);
}

run(mainDirect);
