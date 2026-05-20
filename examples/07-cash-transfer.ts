import { FixedX18 } from "@pendle/boros-offchain-math";
import axios from "axios";
import { Hex } from "viem";
import { loadConfig } from "../src/utils/config";
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
async function main() {
  const { config, account, agent } = setup();

  const { data } = await axios.post<AgentCalldataResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/agent/cash-transfer`,
    {
      accountId: 0,
      marketId: 135,
      direction: "CROSS_TO_ISOLATED",
      amount: FixedX18.fromNumber(1).value.toString(),
    }
  );

  const transferResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    account.address,
    data.calls
  );

  console.log("Cash transfer result:", transferResult);
}

run(main);
