import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/AppError";

// Live Daraja (production) only — the sandbox host and its test shortcode /
// passkey have been removed. Every request here moves real money.
const BASE_URL = "https://api.safaricom.co.ke";

// Resolves the credentials sent to Daraja for a Till ("Buy Goods") collection:
//   - BusinessShortCode: the shortcode the Lipa Na M-Pesa Online passkey was
//     issued for (the Head Office / store number on a Till). It is also what
//     the password is built from. If the Till has no separate Head Office
//     number, this is simply the Till number itself.
//   - PartyB: the Till number that receives the money.
//   - TransactionType: CustomerBuyGoodsOnline (required for Tills — using
//     CustomerPayBillOnline against a Till is rejected).
type StkCredentials = {
  passwordShortcode: string;
  passkey: string;
  partyB: string;
  transactionType: "CustomerBuyGoodsOnline";
};

function resolveStkCredentials(): StkCredentials {
  const till = (env.mpesa.tillNumber ?? "").trim();
  const shortcode = (env.mpesa.shortcode ?? "").trim() || till;
  const passkey = (env.mpesa.passkey ?? "").trim();
  const callbackUrl = (env.mpesa.callbackUrl ?? "").trim();

  const missing = [
    !till && "MPESA_TILL_NUMBER",
    !shortcode && "MPESA_SHORTCODE",
    !passkey && "MPESA_PASSKEY",
    !callbackUrl && "MPESA_CALLBACK_URL",
  ].filter(Boolean);

  if (missing.length) {
    logger.error("M-Pesa production config is incomplete", { missing });
    throw AppError.badRequest("M-Pesa is not configured on this server yet");
  }
  // Daraja only delivers callbacks to a public HTTPS URL.
  if (!callbackUrl.startsWith("https://")) {
    logger.error("MPESA_CALLBACK_URL must be a public https:// URL", { callbackUrl });
    throw AppError.badRequest("M-Pesa is not configured on this server yet");
  }

  return {
    passwordShortcode: shortcode,
    passkey,
    partyB: till,
    transactionType: "CustomerBuyGoodsOnline",
  };
}

// ----------------------------------------------------------------------------
// OAuth token — cached in-memory with a safety margin before expiry. Daraja
// tokens last ~1 hour. On a serverless platform each cold start refetches,
// which is fine (Safaricom's OAuth endpoint is cheap and not rate-limited
// like the payment endpoints are).
// ----------------------------------------------------------------------------
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  if (!env.mpesa.consumerKey || !env.mpesa.consumerSecret) {
    throw AppError.badRequest("M-Pesa is not configured on this server yet");
  }

  // .trim() guards against the single most common cause of a 400 here: a
  // trailing newline or space left over from pasting the key/secret out of
  // the Daraja dashboard into an env var.
  const credentials = Buffer.from(
    `${env.mpesa.consumerKey.trim()}:${env.mpesa.consumerSecret.trim()}`
  ).toString("base64");

  try {
    const { data } = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}` },
      timeout: 20_000,
    });

    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in ?? 3599) * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    // A 400 here is almost always Safaricom rejecting the consumer
    // key/secret itself — e.g. leftover sandbox keys (they don't work on the
    // live host; use the production app's keys), or a stray whitespace
    // character.
    // Logging the real response body (rather than just Axios's generic
    // "Request failed with status code 400") is what actually tells you
    // which of those it is.
    logger.error("M-Pesa OAuth token request failed", {
      baseUrl: BASE_URL,
      status: axios.isAxiosError(err) ? err.response?.status : undefined,
      responseData: axios.isAxiosError(err) ? err.response?.data : undefined,
    });
    throw AppError.badRequest("Could not authenticate with M-Pesa right now — please try again shortly");
  }
}

// Daraja expects the timestamp in Nairobi time (EAT, UTC+3, no DST). Serverless
// hosts such as Vercel run in UTC, so build it explicitly instead of relying
// on the server's local clock.
function darajaTimestamp(): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

// Normalises to Daraja's expected 2547XXXXXXXX / 2541XXXXXXXX format.
export function toMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseDescription: string;
}

// Initiates a live STK Push against the configured Till ("Buy Goods").
export async function initiateStkPush(params: {
  amount: number;
  phone: string;
  orderNumber: string;
  description: string;
}): Promise<StkPushResult> {
  const { passwordShortcode, passkey, partyB, transactionType } = resolveStkCredentials();
  const msisdn = toMsisdn(params.phone);
  if (!/^254[17]\d{8}$/.test(msisdn)) {
    throw AppError.badRequest("Enter a valid Safaricom M-Pesa number, e.g. 0712345678");
  }
  const amount = Math.round(params.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw AppError.badRequest("Invalid payment amount");
  }

  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${passwordShortcode}${passkey}${timestamp}`).toString("base64");

  const payload = {
    BusinessShortCode: passwordShortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: amount,
    PartyA: msisdn,
    PartyB: partyB,
    PhoneNumber: msisdn,
    CallBackURL: env.mpesa.callbackUrl.trim(),
    // Live Daraja enforces its length limits (the sandbox is lenient):
    // AccountReference max 12 chars, TransactionDesc max 13.
    AccountReference: params.orderNumber.slice(0, 12),
    TransactionDesc: params.description.slice(0, 13),
  };

  try {
    const { data } = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    });

    if (data.ResponseCode !== "0") {
      throw AppError.badRequest(data.ResponseDescription ?? "M-Pesa declined the payment request");
    }

    return {
      merchantRequestId: data.MerchantRequestID,
      checkoutRequestId: data.CheckoutRequestID,
      responseDescription: data.ResponseDescription,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Log Safaricom's actual response body, not just Axios's generic
    // "Request failed with status code 400" — that body is what tells you
    // *why* (wrong PartyB/shortcode pairing, malformed phone, etc.)
    // instead of just that something failed.
    logger.error("STK push failed", {
      transactionType,
      status: axios.isAxiosError(err) ? err.response?.status : undefined,
      responseData: axios.isAxiosError(err) ? err.response?.data : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.badRequest("Could not reach M-Pesa right now — please try again in a moment");
  }
}

// Defense-in-depth: actively ask Daraja for the status of a CheckoutRequestID
// rather than relying solely on the callback ever arriving (it can be late,
// lost, or arrive while the network is poor).
async function postStkQuery(checkoutRequestId: string) {
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const { passwordShortcode, passkey } = resolveStkCredentials();
  const password = Buffer.from(`${passwordShortcode}${passkey}${timestamp}`).toString("base64");

  return axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: passwordShortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20_000 }
  );
}

// Raw Daraja query response (kept for existing callers such as the stale-order sweep).
export async function queryStkStatus(checkoutRequestId: string) {
  const { data } = await postStkQuery(checkoutRequestId);
  return data as { ResultCode?: string; ResultDesc?: string; ResponseCode?: string };
}

export type StkOutcome = {
  state: "SUCCESS" | "PENDING" | "CANCELLED" | "FAILED";
  resultCode?: string;
  resultDesc?: string;
};

// Result codes that are final for a request: the customer cancelled, the PIN
// was wrong, funds were short, or the prompt expired / couldn't be delivered.
// Anything else (including Daraja's "still being processed" errors and any
// network problem) is deliberately reported as PENDING — never as a failure —
// so a slow connection can't turn a real payment into an "unpaid" order.
const FINAL_FAILURE_CODES: Record<string, "CANCELLED" | "FAILED"> = {
  "1": "FAILED",
  "1001": "FAILED",
  "1019": "FAILED",
  "1025": "FAILED",
  "1032": "CANCELLED",
  "1037": "FAILED",
  "2001": "FAILED",
};

export async function queryStkOutcome(checkoutRequestId: string): Promise<StkOutcome> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data } = await postStkQuery(checkoutRequestId);
      const code = data?.ResultCode !== undefined && data?.ResultCode !== null ? String(data.ResultCode) : undefined;
      if (code === "0") return { state: "SUCCESS", resultCode: code, resultDesc: data?.ResultDesc };
      if (code && FINAL_FAILURE_CODES[code]) {
        return { state: FINAL_FAILURE_CODES[code], resultCode: code, resultDesc: data?.ResultDesc };
      }
      return { state: "PENDING", resultCode: code, resultDesc: data?.ResultDesc };
    } catch (err) {
      // Daraja answers a request that is still in progress with an HTTP error
      // (errorCode 500.001.1001) — that means "not decided yet", not "failed".
      if (axios.isAxiosError(err) && err.response) {
        return { state: "PENDING", resultDesc: err.response.data?.errorMessage };
      }
      if (attempt === 2) {
        logger.warn("STK status query could not reach Daraja", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { state: "PENDING" };
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { state: "PENDING" };
}

export interface DarajaCallbackItem {
  Name: string;
  Value?: string | number;
}

export interface DarajaStkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: { Item: DarajaCallbackItem[] };
}

export function parseCallbackMetadata(callback: DarajaStkCallback) {
  const items = callback.CallbackMetadata?.Item ?? [];
  const find = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    amount: find("Amount") as number | undefined,
    mpesaReceiptNumber: find("MpesaReceiptNumber") as string | undefined,
    transactionDate: find("TransactionDate") as number | undefined,
    phoneNumber: find("PhoneNumber") as number | undefined,
  };
}
