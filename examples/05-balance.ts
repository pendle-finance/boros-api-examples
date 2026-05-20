import { FixedX18 } from "@pendle/boros-offchain-math";
import { CROSS_MARKET_ID, MarketAccLib } from "@pendle/sdk-boros";
import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/utils/config";
import { run } from "../src/utils/setup";

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

async function main() {
  const config = loadConfig();
  const account = privateKeyToAccount(config.privateKey);

  // Query cross-margin account (tokenId=3 is USDT0)
  const marketAcc = MarketAccLib.pack(account.address, 0, 3, CROSS_MARKET_ID);

  const { data } = await axios.post<{ results: MarketAccInfo[] }>(
    `${config.apiBaseUrl}/apis/v1/accounts/market-acc-infos`,
    { marketAccs: [marketAcc] }
  );

  const info = data.results[0];
  const format = (v: string) =>
    FixedX18.fromBigIntString(v).toNumber().toFixed(2);

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

run(main);
