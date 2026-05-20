import axios from "axios";
import { API_BASE_URL } from "../src/utils/api";
import { run, setup } from "../src/utils/setup";

type Asset = {
  id: string;
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

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { data } = await axios.get<{ results: Asset[] }>(
    `${API_BASE_URL}/v1/assets`
  );

  console.table(
    data.results.map((a) => ({
      tokenId: a.tokenId,
      address: a.address,
      symbol: a.symbol,
      name: a.name,
      decimals: a.decimals,
      isCollateral: a.isCollateral,
    }))
  );
}

// === Version 2: using @pendle/boros-sdk-public ===
async function _mainSdk() {
  const { exchange } = setup();
  const { results } = await exchange.getAssets();

  console.table(
    results.map((a) => ({
      tokenId: a.tokenId,
      address: a.address,
      symbol: a.symbol,
      name: a.name,
      decimals: a.decimals,
      isCollateral: a.isCollateral,
    }))
  );
}

run(mainDirect);
