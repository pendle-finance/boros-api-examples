# BOROS API Examples

Minimal TypeScript examples for integrating with BOROS trading APIs.

These examples target the v1 Boros Open API set served under `/apis/v1/...`
on `api-boros.pendle.finance`. The interactive docs (OpenAPI spec) are at
https://api-boros.pendle.finance/apis/docs.

## Quick Start

1. Clone and install:

   ```bash
   git clone <repo>
   cd boros-api-examples
   yarn install
   ```

2. Configure environment:

   ```bash
   cp .env.example .env
   # Edit .env with your keys
   ```

3. Run examples in order:
   ```bash
   yarn example:agent     # Approve your agent wallet
   yarn example:assets    # View available assets
   yarn example:markets   # View active markets
   yarn example:deposit   # Deposit collateral
   yarn example:balance   # Check your balance
   yarn example:place-order  # Place a limit order
   ```

## Concepts

### Agent Wallet

A separate key that can only trade (not withdraw). Generate any random wallet,
add to `.env`, then run `01-agent.ts` to approve it.

### API Signing Key

Only the stop-order endpoints need this. It is an **Ed25519** keypair, separate
from both your wallet and your agent: every request carries a short-lived
self-signed JWT in `x-pendle-auth`, so there is no static token on the wire.

Mint one at https://api-boros.pendle.finance/dashboard, or from a script with the
SDK's `ApiKeys` — no browser required (see `yarn example:api-keys`):

```ts
const apiKeys = ApiKeys.asAgent(ROOT_ADDRESS, AGENT_PRIVATE_KEY); // or ApiKeys.asRoot(PRIVATE_KEY)
const key = await apiKeys.create({ name: "prod-bot", expiresInDays: 90 });
ApiKeys.activate(key); // installs it for every later open-api read
```

These routes take an EIP-712 signature from your root wallet **or from an agent
approved on its sub-account 0**, and an approved agent has full parity with the
root over API keys — it can mint, list and revoke every key of that root — which
keeps the withdraw-capable root key out of your bot's environment. The PKCS#8 PEM
is returned **once**. Put the id and the PEM in `.env` as `BOROS_API_KEY_ID` /
`BOROS_API_KEY_PEM`; on restart `ApiKeys.activate({ keyId, privateKey })` takes
them directly, with nothing to mint.

The key proves *which root you are*, nothing more — placing and cancelling still
need the agent signature, so a leaked key cannot move your position.

### Account ID (Sub-accounts)

You can have up to 256 sub-accounts (0-255). Default is 0. Each sub-account
has separate margin and positions.

### Market Account (`marketAcc`)

A packed identifier containing: `(walletAddress, accountId, tokenId, marketId)`

- For cross-margin: use `CROSS_MARKET_ID`
- For isolated-margin: use the specific `marketId`

### Decimals

- **Deposits/Withdrawals**: Native token decimals (e.g., 6 for USDT)
- **Trading/Balances**: Always 18 decimals internally

### Ticks & Rates

Rates are represented as integer ticks. Formula:

```
rate = 1.00005^(tick * tickStep) - 1
```

Conversion between rate and tick using SDK helpers:
- `getRateAtTick()`
- `estimateTickForRate()`

## Examples Overview

| #   | Script             | Requires Agent | Description                                  |
| --- | ------------------ | -------------- | -------------------------------------------- |
| 01  | agent              | No             | Approve agent wallet                         |
| 02  | assets             | No             | List available assets                        |
| 03  | markets            | No             | List active markets                          |
| 04  | deposit            | No             | Deposit collateral                           |
| 05  | balance            | No             | Check balance and positions                  |
| 06  | withdraw           | No             | Request withdrawal                           |
| 07  | cash-transfer      | Yes            | Move funds between cross/isolated            |
| 08  | market-order       | Yes            | Open/close position at market                |
| 09  | place-order        | Yes            | Place limit order                            |
| 10  | cancel-order       | Yes            | Cancel existing order                        |
| 11  | bulk-place-orders  | Yes            | Place many resting orders + atomic cancel    |
| 12  | top-up-gas-account | Yes            | Top up off-chain gas balance from collateral |
| 13  | top-up-isolated-account | Yes        | Fund an isolated-only market account         |
| 14  | stop-order         | Yes + API key  | Place / list / cancel take-profit & stop-loss |
| 15  | api-keys           | Yes (or root)  | Mint / list / use / revoke an API signing key |

