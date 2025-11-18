import { arbitrum } from "viem/chains";
import { getAddresses } from "./addresses";

export const PENDLE_BOROS_ROUTER_DOMAIN = {
  name: "Pendle Boros Router",
  version: "1.0",
  chainId: BigInt(arbitrum.id),
  verifyingContract: getAddresses().router,
} as const;

export const EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
