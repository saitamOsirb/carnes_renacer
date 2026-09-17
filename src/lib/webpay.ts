import "server-only";

import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/security";

const createResponseSchema = z.object({
  token: z.string().min(1),
  url: z.string().url(),
});

const commitResponseSchema = z.object({
  vci: z.string().optional(),
  amount: z.number(),
  status: z.string(),
  buy_order: z.string(),
  session_id: z.string(),
  card_detail: z.object({ card_number: z.string().optional() }).optional(),
  accounting_date: z.string().optional(),
  transaction_date: z.string().optional(),
  authorization_code: z.string().optional(),
  payment_type_code: z.string().optional(),
  response_code: z.number(),
  installments_number: z.number().optional(),
});

export type WebpayCommitResponse = z.infer<typeof commitResponseSchema>;

function baseUrl(): string {
  return getServerEnv().WEBPAY_ENV === "production"
    ? "https://webpay3g.transbank.cl/rswebpaytransaction/api/webpay/v1.2"
    : "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2";
}

function headers(): HeadersInit {
  const env = getServerEnv();
  return {
    "Content-Type": "application/json",
    "Tbk-Api-Key-Id": env.WEBPAY_COMMERCE_CODE,
    "Tbk-Api-Key-Secret": env.WEBPAY_API_KEY_SECRET,
  };
}

async function parseWebpayResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Webpay upstream error", { status: response.status });
    throw new HttpError(502, "Webpay no pudo procesar la solicitud.", "WEBPAY_UPSTREAM_ERROR");
  }
  return body;
}

export async function createWebpayTransaction(input: {
  buyOrder: string;
  sessionId: string;
  amount: number;
  returnUrl: string;
}) {
  const response = await fetch(`${baseUrl()}/transactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      buy_order: input.buyOrder,
      session_id: input.sessionId,
      amount: input.amount,
      return_url: input.returnUrl,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const parsed = createResponseSchema.safeParse(await parseWebpayResponse(response));
  if (!parsed.success) throw new HttpError(502, "Respuesta inválida de Webpay.", "WEBPAY_INVALID_RESPONSE");
  return parsed.data;
}

export async function commitWebpayTransaction(token: string): Promise<WebpayCommitResponse> {
  const response = await fetch(`${baseUrl()}/transactions/${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const parsed = commitResponseSchema.safeParse(await parseWebpayResponse(response));
  if (!parsed.success) throw new HttpError(502, "Respuesta de confirmación inválida.", "WEBPAY_INVALID_COMMIT");
  return parsed.data;
}

export async function getWebpayTransactionStatus(token: string): Promise<WebpayCommitResponse> {
  const response = await fetch(`${baseUrl()}/transactions/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const parsed = commitResponseSchema.safeParse(await parseWebpayResponse(response));
  if (!parsed.success) throw new HttpError(502, "Respuesta de estado inválida.", "WEBPAY_INVALID_STATUS");
  return parsed.data;
}
