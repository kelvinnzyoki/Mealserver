import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/AppError";

const BASE_URL =
  env.mpesa.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

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

  const credentials = Buffer.from(`${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`).toString("base64");
  const { data } = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3599) * 1000,
  };
  return cachedToken.token;
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

// Initiates an STK Push against the platform's Till Number ("Buy Goods").
// If you're using a Paybill shortcode instead of a Till, change
// TransactionType to "CustomerPayBillOnline" and set an AccountReference
// that means something to you (e.g. the order number).
export async function initiateStkPush(params: {
  amount: number;
  phone: string;
  orderNumber: string;
  description: string;
}): Promise<StkPushResult> {
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const shortcode = env.mpesa.tillNumber || env.mpesa.shortcode;
  const password = Buffer.from(`${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`).toString("base64");
  const msisdn = toMsisdn(params.phone);

  const payload = {
    BusinessShortCode: env.mpesa.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: env.mpesa.tillNumber ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    Amount: Math.round(params.amount),
    PartyA: msisdn,
    PartyB: shortcode,
    PhoneNumber: msisdn,
    CallBackURL: env.mpesa.callbackUrl,
    AccountReference: params.orderNumber,
    TransactionDesc: params.description.slice(0, 13), // Daraja truncates/limits this field
  };

  try {
    const { data } = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}` },
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
    logger.error("STK push failed", { error: err instanceof Error ? err.message : String(err) });
    throw AppError.badRequest("Could not reach M-Pesa right now — please try again in a moment");
  }
}

// Defense-in-depth: actively ask Daraja for the status of a CheckoutRequestID
// rather than relying solely on the callback ever arriving. Used by the
// payment-status polling endpoint if a callback hasn't landed within a few
// seconds, and by the stale-order sweep before giving up on a payment.
export async function queryStkStatus(checkoutRequestId: string) {
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`).toString("base64");

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: env.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data as { ResultCode?: string; ResultDesc?: string; ResponseCode?: string };
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
