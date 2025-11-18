import { FixedX18 } from "@pendle/boros-offchain-math";
import { Agent } from "@pendle/sdk-boros";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/utils/config";
import { run, signAndSubmit } from "../src/utils/setup";

type CashTransferResponse = {
  calldatas: Hex[];
};

/**
 * Transfer collateral between cross margin and isolated margin accounts
 */
async function main() {
  const config = loadConfig();

  const walletAccount = privateKeyToAccount(config.privateKey);
  const agent = Agent.createFromPrivateKey(config.agentPrivateKey);

  // isDeposit: true = cross -> isolated, false = isolated -> cross
  const { data } = await axios.get<CashTransferResponse>(
    `${config.apiBaseUrl}/open-api/v1/calldata/cash-transfer`,
    {
      params: {
        marketId: 18,
        isDeposit: true,
        amount: FixedX18.fromNumber(1).value.toString(),
      },
    }
  );

  const transferResult = await signAndSubmit(
    config.apiBaseUrl,
    agent,
    walletAccount.address,
    data.calldatas
  );

  console.log("Cash transfer result:", transferResult);
}

run(main);
