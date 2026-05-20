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
    marginFloor: number;
  };
  extConfig: {
    ammAddress?: string;
    ammId?: number;
    isPositiveAMM?: boolean;
    settleFeeRate: string;
    paymentPeriod: number;
    maxUpdateDelay: number;
  };
  metadata: {
    underlyingSymbol?: string;
    fundingRateSymbol?: string;
    maxLeverage: number;
    maxPerpLeverage?: number;
    isUiWhitelisted: boolean;
  };
  data: {
    volume24h: number;
    notionalOI: number;
    markApr: number;
    midApr: number;
    nextSettlementTime?: number;
    timeToMaturity?: number;
    assetMarkPrice: number;
  };
};

async function main() {
  const config = loadConfig();

  // /v1/markets is cursor-paginated; this fetch returns the first page.
  // For full pagination, follow `resumeToken` until the response omits it.
  const { data } = await axios.get<{
    results: Market[];
    resumeToken?: string;
  }>(`${config.apiBaseUrl}/apis/v1/markets`, {
    params: {
      isMatured: false,
      isUiWhitelisted: true,
      limit: 100,
    },
  });

  console.log(`Active UI-whitelisted markets (${data.results.length}):`);
  console.table(
    data.results.map((m) => ({
      marketId: m.marketId,
      name: m.imData.name,
      maturity: new Date(m.imData.maturity * 1000).toISOString().split("T")[0],
      tickStep: m.imData.tickStep,
      maxLeverage: `${m.metadata.maxLeverage}x`,
      markApr: m.data.markApr.toFixed(4),
    }))
  );

  if (data.results.length > 0) {
    const example = data.results[0];
    console.log(
      `\nExample: Use MARKET_ID=${example.marketId}, tickStep=${example.imData.tickStep}`
    );
  }
}

run(main);
