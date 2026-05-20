import { FixedX18 } from "@pendle/boros-offchain-math";
import axios from "axios";
import { API_BASE_URL } from "../src/utils/api";
import { AgentCall, run, setup, signAndSubmit } from "../src/utils/setup";

type AgentCalldataResponse = {
  calls: AgentCall[];
};

/**
 * Transfer collateral between cross margin and isolated margin accounts.
 *
 * `direction` is explicit (CROSS_TO_ISOLATED or ISOLATED_TO_CROSS).
 * `amount` is always positive — the backend applies the sign off-chain
 * based on `direction` before encoding the on-chain calldata. Amounts are
 * 1e18-scaled bigint strings.
 */

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, agent } = setup();

  const { data } = await axios.post<AgentCalldataResponse>(
    `${API_BASE_URL}/v1/calldata-builder/agent/cash-transfer`,
    {
      accountId: 0,
      marketId: 135,
      direction: "CROSS_TO_ISOLATED",
      amount: FixedX18.fromNumber(1).value.toString(),
    }
  );

  const transferResult = await signAndSubmit(agent, account.address, data.calls);

  console.log("Cash transfer result:", transferResult);
}

// === Version 2: using @pendle/boros-sdk-public ===
async function _mainSdk() {
  const { exchange } = setup();

  const transferResult = await exchange.cashTransfer({
    marketId: 135,
    isDeposit: true, // CROSS_TO_ISOLATED
    amount: FixedX18.fromNumber(1).value,
  });

  console.log("Cash transfer result:", transferResult);
}

run(mainDirect);
