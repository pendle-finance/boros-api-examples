import axios from "axios";
import { loadConfig } from "../src/utils/config";
import { run } from "../src/utils/setup";

type Asset = {
  address: string;
  tokenId: number;
  name: string;
  symbol: string;
  decimals: number;
  usdPrice: string;
  isCollateral: boolean;
};

/**
 * Decimal Normalization
 *
 * Deposits/withdrawals: Use native token decimals (6 for USDT0)
 * Internal calculations: All values normalized to 18 decimals
 *
 * Example:
 * - Deposit 1 USDT0: parseUnits('1', 6)
 * - Query balance: Returns parseUnits('1', 18) equivalent
 * - Place order for 1 USDT0: parseUnits('1', 18)
 */
async function main() {
  const config = loadConfig();

  const { data } = await axios.get<{ assets: Asset[] }>(
    `${config.apiBaseUrl}/open-api/v1/assets/all`
  );

  console.table(
    data.assets.map((a) => ({
      tokenId: a.tokenId,
      address: a.address,
      symbol: a.symbol,
      name: a.name,
      decimals: a.decimals,
      isCollateral: a.isCollateral,
    }))
  );
}

run(main);
