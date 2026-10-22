import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/AppError";

const BASE_URL =
  env.mpesa.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

// Safaricom's sandbox recognises exactly one shortcode/passkey pair — the
// pair published in the Daraja docs — and only reliably supports
// CustomerPayBillOnline. Your real production shortcode, passkey, and Till
// number mean nothing to the sandbox host: sending them there is a
// guaranteed 400, regardless of how "correct" they are for production.
const SANDBOX_SHORTCODE = "174379";
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

// Resolves the shortcode/passkey/PartyB/TransactionType to actually send to
// Daraja. Sandbox always gets the fixed test values above, no matter what
// your Till/Paybill env vars are set to. Production uses your real
// configuration and supports either a Till ("Buy Goods") or a Paybill: if
// MPESA_TILL_NUMBER is set, BusinessShortCode stays your Lipa Na M-Pesa
// Online ("H.O.") shortcode for password generation while PartyB is the
// Till itself — the two are legitimately different numbers on many Till
// setups. With no Till configured, both are your Paybill shortcode.
type StkCredentials = {
  passwordShortcode: string;
  passkey: string;
  partyB: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
};

function resolveStkCredentials(): StkCredentials {
  const isSandbox = env.mpesa.env !== "production";

  if (isSandbox) {
    return {
      passwordShortcode: SANDBOX_SHORTCODE,
      passkey: SANDBOX_PASSKEY,
      partyB: SANDBOX_SHORTCODE,
      transactionType: "CustomerPayBillOnline",
    };
  }

  return {
    passwordShortcode: env.mpesa.shortcode,
    passkey: env.mpesa.passkey,
    partyB: env.mpesa.tillNumber || env.mpesa.shortcode,
    transactionType: env.mpesa.tillNumber ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
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
    // key/secret itself — e.g. sandbox credentials pointed at the
    // production host (or vice versa), or a stray whitespace character.
    // Logging the real response body (rather than just Axios's generic
    // "Request failed with status code 400") is what actually tells you
    // which of those it is.
    logger.error("M-Pesa OAuth token request failed", {
      baseUrl: BASE_URL,
      mpesaEnv: env.mpesa.env,
      status: axios.isAxiosError(err) ? err.response?.status : undefined,
      responseData: axios.isAxiosError(err) ? err.response?.data : undefined,
    });
    throw AppError.badRequest("Could not authenticate with M-Pesa right now — please try again shortly");
  }
}

function darajaTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// Normalises to Daraja's expected 2547XXXXXXXX / 2541XXXXXXXX format.
function toMsisdn(phone: string): string {
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

// Initiates an STK Push — against a Till ("Buy Goods") or a Paybill in
// production, and against Safaricom's fixed sandbox test shortcode
// whenever env.mpesa.env isn't "production" (see resolveStkCredentials).
export async function initiateStkPush(params: {
  amount: number;
  phone: string;
  orderNumber: string;
  description: string;
}): Promise<StkPushResult> {
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const { passwordShortcode, passkey, partyB, transactionType } = resolveStkCredentials();
  const password = Buffer.from(`${passwordShortcode}${passkey}${timestamp}`).toString("base64");
  const msisdn = toMsisdn(params.phone);

  const payload = {
    BusinessShortCode: passwordShortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: Math.round(params.amount),
    PartyA: msisdn,
    PartyB: partyB,
    PhoneNumber: msisdn,
    CallBackURL: env.mpesa.callbackUrl,
    AccountReference: params.orderNumber,
    TransactionDesc: params.description.slice(0, 13), // Daraja truncates/limits this field
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
      mpesaEnv: env.mpesa.env,
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
