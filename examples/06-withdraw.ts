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

type WithdrawCalldata = {
  data: Hex;
  from: Address;
  to: Address;
  gas: string;
};

// After submitting a withdraw request, wait 10 minutes for assets to be transferred to your wallet
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
  const { data } = await axios.get<WithdrawCalldata>(
    `${config.apiBaseUrl}/open-api/v1/calldata/withdraw-request`,
    {
      params: {
        userAddress: walletAccount.address,
        tokenId: 3,
        amount: parseUnits("1", 6).toString(),
      },
    }
  );

  const txHash = await walletClient.sendTransaction({
    to: data.to,
    data: data.data,
  });

  await waitForTransaction(publicClient, txHash);

  console.log("Withdraw request tx:", txHash);
}

run(main);
