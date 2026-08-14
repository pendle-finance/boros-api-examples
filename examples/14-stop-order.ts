import { createPrivateKey, randomBytes, sign } from "crypto";
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
import { loadApiSigningKey } from "../src/utils/config";
import { run, setup } from "../src/utils/setup";

/**
 * Stop orders (take-profit / stop-loss)
 *
 * These endpoints use a second credential that no other example needs: an
 * Ed25519 **API signing key**. Every request carries a short-lived self-signed
 * JWT in `x-pendle-auth`, so there is no static token on the wire.
 *
 * Mint one from https://api-boros.pendle.finance/dashboard, or from a script —
 * `POST /v1/api-keys` is authenticated by an EIP-712 signature from your root
 * wallet. Put the id and the PKCS#8 PEM in `.env` as `BOROS_API_KEY_ID` and
 * `BOROS_API_KEY_PEM`.
 *
 * Two credentials are in play, and they answer different questions:
 *   - the API signing key proves WHICH ROOT you are. Reads need only this.
 *   - the agent signature proves the action MAY MOVE FUNDS. place/cancel need
 *     it as well, which is why a leaked API key cannot touch your position.
 *
 * The account is derived server-side from the API key (root + sub-account 0).
 * You never send `account`, and sending one would be ignored.
 *
 * Prerequisites: an approved agent (`yarn example:agent`) and an open position
 * on the market you want to protect (`yarn example:place-order`).
 */

// Run `yarn example:markets` to see available markets
const MARKET_ID = 180;

// APR that arms the trigger, as a decimal. For a stop-loss on a long this is
// the lower bound: the order fires once the market APR falls through it.
const STOP_APR = 0.01;

// === Version 1 (default): direct API calls ===
//
// Mints the request JWT by hand so you can see exactly what the gateway
// verifies. The `uri` claim binds one method + one path, and the path is the
// PUBLIC one — `/apis/v1/...`, not the `/v1/...` you pass to axios. Query
// strings are not part of it, so one token covers every query on that path.
function mintToken(keyId: string, pem: string, method: string, path: string): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  const header = b64({ alg: "EdDSA", typ: "JWT", kid: keyId });
  const payload = b64({
    sub: keyId,
    iss: "pendle",
    // A plain string. The array form RFC 7519 allows is rejected outright.
    aud: "pendle-open-api",
    jti: randomBytes(16).toString("hex"),
    uri: `${method.toUpperCase()} ${path}`,
    iat: now,
    nbf: now,
    // Must be at most 120 seconds after `nbf`.
    exp: now + 60,
  });

  const signature = sign(
    null,
    Buffer.from(`${header}.${payload}`),
    createPrivateKey(pem)
  ).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

async function mainDirect() {
  const { agent } = setup();
  const { keyId, privateKey } = loadApiSigningKey();

  // `/apis` is the public prefix; axios talks to it via API_BASE_URL.
  const auth = (method: string, path: string) => ({
    "x-pendle-auth": mintToken(keyId, privateKey, method, `/apis${path}`),
  });

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

  // --- 2. Sign it with the agent. This is the half a leaked API key lacks.
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

  // --- 3. Submit. Echo `req` back unchanged minus `account` and
  //        `hashedOffchainCondition`: the backend derives both, and any other
  //        edit invalidates the signature you just produced.
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

  // --- 4. Read it back. `orderId` is a query parameter, not a path segment,
  //        so a single signed `uri` claim covers every lookup.
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
// every open-api call, so none of the signing above is at the call site. Note
// it does NOT cover the `/v1/api-keys` tree — that one takes an EIP-712 root
// signature instead.
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
