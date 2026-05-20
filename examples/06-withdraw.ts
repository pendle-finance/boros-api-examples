import { waitForTransaction } from "@pendle/boros-sdk-public";
import axios from "axios";
import { Address, Hex, parseUnits } from "viem";
import { API_BASE_URL } from "../src/utils/api";
import { run, setup } from "../src/utils/setup";

type UserCalldataResponse = {
  calldata: Hex;
  from: Address;
  to: Address;
  gas?: string;
};

// After submitting a withdraw request, wait 10 minutes for assets to be
// transferred to your wallet — a backend bot calls the finalize step on a
// timer once the cooldown elapses.

// === Version 1 (default): direct API calls ===
async function mainDirect() {
  const { account, walletClient, publicClient } = setup();

  const { data } = await axios.post<UserCalldataResponse>(
    `${API_BASE_URL}/v1/calldata-builder/user/request-withdrawal`,
    {
      root: account.address,
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

// === Version 2: using @pendle/boros-sdk-public ===
async function _mainSdk() {
  const { exchange, account } = setup();

  const receipt = await exchange.withdraw({
    userAddress: account.address,
    tokenId: 3,
    amount: parseUnits("1", 6),
  });

  console.log("Withdraw request tx:", receipt.transactionHash);
}

run(mainDirect);
