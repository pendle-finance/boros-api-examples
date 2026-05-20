import { waitForTransaction } from "@pendle/sdk-boros";
import axios from "axios";
import {
  createPublicClient,
  createWalletClient,
  Hex,
  http,
  parseUnits,
} from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { loadConfig } from "../src/utils/config";
import { run } from "../src/utils/setup";

type UserCalldataResponse = {
  calldata: Hex;
  from: Address;
  to: Address;
  gas?: string;
};

// After submitting a withdraw request, wait 10 minutes for assets to be
// transferred to your wallet — a backend bot calls the finalize step on a
// timer once the cooldown elapses.
async function main() {
  const config = loadConfig();

  const walletAccount = privateKeyToAccount(config.privateKey);
  const walletClient = createWalletClient({
    account: walletAccount,
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(config.rpcUrl),
  });

  const { data } = await axios.post<UserCalldataResponse>(
    `${config.apiBaseUrl}/apis/v1/calldata-builder/user/request-withdrawal`,
    {
      root: walletAccount.address,
      tokenId: 3, // USDT0 (see 02-assets.ts)
      // `amount` is the bigint string in the token's native decimals
      // (USDT0 has 6 decimals).
      amount: parseUnits("1", 6).toString(),
    }
  );

  const txHash = await walletClient.sendTransaction({
    to: data.to,
    data: data.calldata,
  });

  await waitForTransaction(publicClient, txHash);

  console.log("Withdraw request tx:", txHash);
}

run(main);
