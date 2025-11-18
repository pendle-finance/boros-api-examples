# BOROS API Examples

Minimal TypeScript examples for integrating with BOROS trading APIs.

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

| #   | Script        | Requires Agent | Description                       |
| --- | ------------- | -------------- | --------------------------------- |
| 01  | agent         | No             | Approve agent wallet              |
| 02  | assets        | No             | List available assets             |
| 03  | markets       | No             | List active markets               |
| 04  | deposit       | No             | Deposit collateral                |
| 05  | balance       | No             | Check balance and positions       |
| 06  | withdraw      | No             | Request withdrawal                |
| 07  | cash-transfer | Yes            | Move funds between cross/isolated |
| 08  | market-order  | Yes            | Open/close position at market     |
| 09  | place-order   | Yes            | Place limit order                 |
| 10  | cancel-order  | Yes            | Cancel existing order             |
