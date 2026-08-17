import {
  Account,
  ApiSigningKey,
  Side,
  StopAprOrderType,
  StopOrders,
  TimeInForce,
  setInternalAgent,
  setOpenApiSigningKey,
  signCancelStopOrderV2Request,
  signStopOrderRequest,
} from "@pendle/boros-sdk-public";
import axios from "axios";
import { Hex } from "viem";
import { API_BASE_URL } from "../src/utils/api";
import { apiKeyHeaders } from "../src/utils/api-key";
import { loadApiSigningKey } from "../src/utils/config";
import { run, setup } from "../src/utils/setup";

/**
 * Stop orders (take-profit / stop-loss)
 *
 * Two credentials are in play:
 *   - the Ed25519 **API signing key** proves WHICH ROOT you are — every request
 *     carries a short-lived self-signed JWT in `x-pendle-auth`. Reads need only this.
 *   - the **agent signature** proves the action MAY MOVE FUNDS, so place/cancel need
 *     it too and a leaked API key cannot touch your position.
 *
 * The account is derived server-side from the API key (root + sub-account 0); you
 * never send `account`.
 *
 * Prerequisites: an approved agent (`yarn example:agent`), an open position to protect
 * (`yarn example:place-order`), and `BOROS_API_KEY_ID` / `BOROS_API_KEY_PEM` in `.env`
 * (mint them with `yarn example:api-keys` or at https://api-boros.pendle.finance/dashboard).
 */

// Run `yarn example:markets` to see available markets
const MARKET_ID = 180;

// APR that arms the trigger, as a decimal. For a stop-loss on a long it is the
// lower bound: the order fires once the market APR falls through it.
const STOP_APR = 0.01;

// === Version 1 (default): direct API calls ===
//
// Mints the request JWT by hand — see `mintToken` in `src/utils/api-key.ts` for
// exactly what the gateway verifies.
async function mainDirect() {
  const { agent } = setup();
  const key = loadApiSigningKey();

  const auth = (method: string, path: string) => apiKeyHeaders(key, method, path);

  setInternalAgent(agent);

  // --- 1. Build the order struct and trigger condition. Reads only.
  const { data: prepared } = await axios.get(`${API_BASE_URL}/v1/stop-orders/prepare`, {
    headers: auth("GET", "/v1/stop-orders/prepare"),
    params: {
      marketId: MARKET_ID,
      // Where the position sits: true = cross, false = isolated on MARKET_ID.
      isCross: true,
      // The side that CLOSES the position — SHORT closes a long.
      side: Side.SHORT,
      type: StopAprOrderType.STOP_LOSS_MARKET,
      closePosition: true,
      // Ignored when closePosition is true, but the query field is required.
      size: "0",
      stopApr: STOP_APR,
    },
  });
  const { req, offchainCondition } = prepared;
  console.log("Prepared for account:", req.account, "at tick", req.tick);

  // --- 2. Sign it with the agent.
  const { agent: agentAddress, signature, orderHash } = await signStopOrderRequest({
    req: {
      account: req.account as Account,
      cross: req.cross,
      marketId: req.marketId,
      side: req.side as Side,
      tif: req.tif as TimeInForce,
      size: BigInt(req.size),
      tick: req.tick,
      reduceOnly: req.reduceOnly,
      salt: req.salt,
      expiry: req.expiry,
    },
    offchainCondition: offchainCondition as Hex,
  });

  // --- 3. Submit.
  const { data: placed } = await axios.post(
    `${API_BASE_URL}/v1/stop-orders/place`,
    {
      agent: agentAddress,
      placeMsg: { actionHash: orderHash },
      placeSignature: signature,
      request: {
        cross: req.cross,
        marketId: req.marketId,
        side: req.side,
        tif: req.tif,
        size: req.size,
        tick: req.tick,
        reduceOnly: req.reduceOnly,
        salt: req.salt,
        expiry: req.expiry,
      },
      offchainCondition,
      type: StopAprOrderType.STOP_LOSS_MARKET,
      closePosition: true,
    },
    { headers: auth("POST", "/v1/stop-orders/place") }
  );
  console.log("Placed:", placed.orderHash);

  // --- 4. Read it back.
  const { data: detail } = await axios.get(`${API_BASE_URL}/v1/stop-orders/detail`, {
    headers: auth("GET", "/v1/stop-orders/detail"),
    params: { orderId: placed.orderHash },
  });
  console.log("Detail:", {
    marketId: detail.result.marketId,
    status: detail.result.status,
    stopApr: detail.result.stopApr,
  });

  // --- 5. List the live ones.
  const { data: list } = await axios.get(`${API_BASE_URL}/v1/stop-orders`, {
    headers: auth("GET", "/v1/stop-orders"),
    params: { isActive: true, limit: 10 },
  });
  console.log("Active stop orders:", list.results.length);

  // --- 6. Cancel. All-or-nothing across up to 50 ids.
  const cancelSigned = await signCancelStopOrderV2Request({
    orderIds: [placed.orderHash as Hex],
  });
  const { data: cancelled } = await axios.post(
    `${API_BASE_URL}/v1/stop-orders/cancel`,
    {
      agent: cancelSigned.agent,
      orderIds: [placed.orderHash],
      cancelSignature: cancelSigned.signature,
    },
    { headers: auth("POST", "/v1/stop-orders/cancel") }
  );
  console.log("Cancelled:", cancelled);
}

// === Version 2: using @pendle/boros-sdk-public ===
//
// `setOpenApiSigningKey` installs a request interceptor that mints the JWT for
// every open-api call, so none of the signing above is at the call site. It does
// NOT cover the `/v1/api-keys` tree, which takes an EIP-712 signature instead
// (see example 15).
async function _mainSdk() {
  const { agent } = setup();

  setOpenApiSigningKey(new ApiSigningKey(loadApiSigningKey()));

  // No accountId argument: the account comes from the key's root.
  const stopOrders = new StopOrders();

  // Reads need only the API signing key.
  const live = await stopOrders.list({ isActive: true });
  console.log("Active stop orders:", live.results.length);

  // Writes also need an agent approved on the account.
  setInternalAgent(agent);

  // `place` runs prepare -> agent-sign -> submit and returns the order hash.
  const orderId = await stopOrders.place({
    marketId: MARKET_ID,
    isCross: true,
    side: Side.SHORT,
    type: StopAprOrderType.STOP_LOSS_MARKET,
    stopApr: STOP_APR,
    closePosition: true,
  });
  console.log("Placed:", orderId);

  const order = await stopOrders.get(orderId);
  console.log("Detail:", {
    marketId: order.result.marketId,
    status: order.result.status,
    stopApr: order.result.stopApr,
  });

  console.log("Cancelled:", await stopOrders.cancel([orderId]));

  // To close a fixed size instead of the whole position, drop `closePosition`
  // and pass `size` scaled by 1e18: `size: 10n ** 18n` closes 1.0 of notional.
}

run(mainDirect);
