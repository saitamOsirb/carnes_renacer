import "server-only";

import { DteEnvironment, DteStatus } from "@prisma/client";
import { assertSiiCanSubmit, getSiiConfig } from "@/lib/sii/config";

export type SiiTransportPayload = {
  documentId: string;
  typeCode: number;
  folio: number;
  environment: DteEnvironment;
  issueDate: string;
  issuerRut: string;
  receiverRut: string | null;
  totalAmount: number;
  xmlDraft: string;
};

export type SiiTransportResult = {
  status: DteStatus;
  trackId: string | null;
  code: string | null;
  message: string;
  raw: string | null;
  signedXml?: string | null;
};

function normalizedStatus(value: unknown): DteStatus {
  const status = String(value ?? "").trim().toUpperCase();
  if (["ACCEPTED", "ACEPTADO", "ACEPTADA", "OK"].includes(status)) return DteStatus.ACCEPTED;
  if (["OBSERVED", "OBSERVADO", "OBSERVADA", "REPARO"].includes(status)) return DteStatus.OBSERVED;
  if (["REJECTED", "RECHAZADO", "RECHAZADA"].includes(status)) return DteStatus.REJECTED;
  if (["ERROR", "FAILED", "FALLIDO", "FALLIDA"].includes(status)) return DteStatus.ERROR;
  if (["SENT", "ENVIADO", "ENVIADA", "PROCESSING", "PENDING", "RECIBIDO", "RECIBIDA"].includes(status)) return DteStatus.SENT;
  return DteStatus.SENT;
}

function safeRaw(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 100_000);
  } catch {
    return String(value ?? "").slice(0, 100_000);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function submitDteToSii(payload: SiiTransportPayload): Promise<SiiTransportResult> {
  const config = getSiiConfig();

  if (config.environment === DteEnvironment.MOCK || config.provider === "mock") {
    return {
      status: DteStatus.ACCEPTED,
      trackId: `MOCK-${payload.typeCode}-${payload.folio}-${Date.now()}`,
      code: "MOCK_ACCEPTED",
      message: "Documento aceptado en simulación interna. No fue enviado al SII.",
      raw: JSON.stringify({ mock: true, accepted: true, folio: payload.folio, typeCode: payload.typeCode }),
      signedXml: null,
    };
  }

  assertSiiCanSubmit(config);
  const response = await fetch(config.gateway.submitUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.gateway.token}`,
      "user-agent": "Renacer-DTE/1.0",
    },
    body: JSON.stringify({
      version: 1,
      environment: config.environment.toLowerCase(),
      issuer: {
        rut: config.company.rut,
        rutSender: config.company.rutSender,
        legalName: config.company.legalName,
        giro: config.company.giro,
        activityCode: config.company.activityCode,
        address: config.company.address,
        commune: config.company.commune,
        city: config.company.city,
      },
      document: payload,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await responseJson(response);
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Gateway SII respondió HTTP ${response.status}: ${String(record.message ?? record.error ?? "sin detalle")}`);
  }

  return {
    status: normalizedStatus(record.status),
    trackId: String(record.trackId ?? record.track_id ?? "").trim() || null,
    code: String(record.code ?? record.statusCode ?? "").trim() || null,
    message: String(record.message ?? "Documento recibido por el proveedor SII.").slice(0, 500),
    raw: safeRaw(body),
    signedXml: typeof record.signedXml === "string" ? record.signedXml.slice(0, 2_000_000) : null,
  };
}

export async function queryDteStatus(trackId: string): Promise<SiiTransportResult> {
  const config = getSiiConfig();
  if (!trackId) throw new Error("El documento no tiene Track ID para consultar.");

  if (config.environment === DteEnvironment.MOCK || config.provider === "mock" || trackId.startsWith("MOCK-")) {
    return {
      status: DteStatus.ACCEPTED,
      trackId,
      code: "MOCK_ACCEPTED",
      message: "Documento aceptado en simulación interna.",
      raw: JSON.stringify({ mock: true, trackId, status: "ACCEPTED" }),
    };
  }

  assertSiiCanSubmit(config);
  const url = new URL(config.gateway.statusUrl);
  url.searchParams.set("trackId", trackId);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${config.gateway.token}`,
      "user-agent": "Renacer-DTE/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await responseJson(response);
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Consulta SII respondió HTTP ${response.status}: ${String(record.message ?? record.error ?? "sin detalle")}`);
  }

  return {
    status: normalizedStatus(record.status),
    trackId,
    code: String(record.code ?? record.statusCode ?? "").trim() || null,
    message: String(record.message ?? "Estado consultado correctamente.").slice(0, 500),
    raw: safeRaw(body),
  };
}
