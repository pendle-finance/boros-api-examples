import axios from "axios";
import { loadConfig } from "../src/utils/config";
import { run } from "../src/utils/setup";

type Market = {
  marketId: number;
  address: string;
  tokenId: number;
  imData: {
    name: string;
    symbol: string;
    isIsolatedOnly: boolean;
    maturity: number;
    tickStep: number;
    iTickThresh: number;
  };
  config: {
    maxOpenOrders: number;
    markRateOracle: string;
    fIndexOracle: string;
    hardOICap: string;
    takerFee: string;
    otcFee: string;
    liqSettings: {
      base: string;
      slope: string;
      feeRate: string;
    };
    kIM: string;
    kMM: string;
    tThresh: number;
    maxRateDeviationFactorBase1e4: number;
    closingOrderBoundBase1e4: number;
    loUpperConstBase1e4: number;
    loUpperSlopeBase1e4: number;
    loLowerConstBase1e4: number;
    loLowerSlopeBase1e4: number;
    status: number;
    useImpliedAsMarkRate: boolean;
    softOICap: number;
    cloLowerThresh: number;
    cloUpperThresh: number;
  };
  extConfig: {
    settleFeeRate: string;
    paymentPeriod: number;
    maxUpdateDelay: number;
  };
  metadata: {
    name: string;
    maxLeverage: number;
    defaultLeverage: number;
    ammAddress: string;
    ammId: number;
    isPositiveAMM: boolean;
  };
  data: {
    volume24h: number;
    notionalOI: number;
    markApr: number;
    lastTradedApr: number;
    midApr: number;
    floatingApr: number;
    longYieldApr: number;
    nextSettlementTime: number;
    timeToMaturity: number;
    assetMarkPrice: number;
  };
  state: "Paused" | "Capped" | "Normal" | "Halted";
};

async function main() {
  const config = loadConfig();

  const { data } = await axios.get<{
    results: Market[];
    total: number;
    skip: number;
  }>(`${config.apiBaseUrl}/open-api/v1/markets`);

  console.log("All markets:");
  console.table(
    data.results.map((m) => ({
      marketId: m.marketId,
      name: m.metadata.name,
      state: m.state,
      maturity: new Date(m.imData.maturity * 1000).toISOString().split("T")[0],
    }))
  );

  // Filter for active markets (markets have expiry dates)
  const activeMarkets = data.results.filter((m) => m.state === "Normal");

  console.log("Active markets for trading:");
  console.table(
    activeMarkets.map((m) => ({
      marketId: m.marketId,
      name: `${m.metadata.name} (${new Date(m.imData.maturity * 1000).toISOString().split("T")[0]})`,
      tickStep: m.imData.tickStep,
      maxLeverage: `${m.metadata.maxLeverage}x`,
    }))
  );

  if (activeMarkets.length > 0) {
    const example = activeMarkets[0];
    console.log(
      `\nExample: Use MARKET_ID=${example.marketId}, tickStep=${example.imData.tickStep}`
    );
  }
}

run(main);
