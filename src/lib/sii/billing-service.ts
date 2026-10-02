import "server-only";

import { randomUUID } from "node:crypto";
import {
  DteDocumentType,
  DteEnvironment,
  DteStatus,
  Prisma,
  type DteDocument,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSiiCanSubmit, getSiiConfig } from "@/lib/sii/config";
import { buildDteXmlDraft, type DteXmlSnapshot } from "@/lib/sii/dte-xml";
import { queryDteStatus, submitDteToSii } from "@/lib/sii/transport";

export type IssuePosDteInput = {
  saleId: string;
  type: DteDocumentType;
  receiverRut?: string;
  receiverName?: string;
  receiverGiro?: string;
  receiverAddress?: string;
  receiverCommune?: string;
  receiverCity?: string;
};

export class DteBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DteBillingError";
  }
}

export function dteTypeCode(type: DteDocumentType): number {
  switch (type) {
    case DteDocumentType.BOLETA_ELECTRONICA: return 39;
    case DteDocumentType.FACTURA_ELECTRONICA: return 33;
    case DteDocumentType.NOTA_CREDITO: return 61;
    case DteDocumentType.NOTA_DEBITO: return 56;
  }
}

export function dteTypeLabel(type: DteDocumentType): string {
  switch (type) {
    case DteDocumentType.BOLETA_ELECTRONICA: return "Boleta electrónica";
    case DteDocumentType.FACTURA_ELECTRONICA: return "Factura electrónica";
    case DteDocumentType.NOTA_CREDITO: return "Nota de crédito";
    case DteDocumentType.NOTA_DEBITO: return "Nota de débito";
  }
}

export function normalizeRut(value: string): string {
  const cleaned = value.replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) return "";
  return `${cleaned.slice(0, -1)}-${cleaned.slice(-1)}`;
}

export function isValidRut(value: string): boolean {
  const normalized = normalizeRut(value);
  const [body, verifier] = normalized.split("-");
  if (!body || !verifier || !/^\d+$/.test(body)) return false;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return verifier === expected;
}

function clean(value: string | undefined | null, max: number): string | null {
  const result = value?.trim().slice(0, max) ?? "";
  return result || null;
}

function documentId(): string {
  return `dte_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

function taxTotals(grossTotal: number, vatRate: number): { net: number; vat: number } {
  if (!Number.isInteger(grossTotal) || grossTotal <= 0) throw new DteBillingError("El total de la venta no es válido para emitir un DTE.");
  if (!Number.isInteger(vatRate) || vatRate < 0 || vatRate > 100) throw new DteBillingError("La tasa de IVA configurada no es válida.");
  if (vatRate === 0) return { net: grossTotal, vat: 0 };
  const net = Math.round(grossTotal / (1 + vatRate / 100));
  return { net, vat: grossTotal - net };
}

async function nextFolio(tx: Prisma.TransactionClient, typeCode: number, environment: DteEnvironment): Promise<number> {
  const sequence = await tx.dteFolioSequence.upsert({
    where: { typeCode_environment: { typeCode, environment } },
    create: { typeCode, environment, nextFolio: 2 },
    update: { nextFolio: { increment: 1 } },
  });
  return sequence.nextFolio - 1;
}

function placeholder(value: string, fallback: string, environment: DteEnvironment): string {
  if (value) return value;
  return environment === DteEnvironment.MOCK ? fallback : value;
}

async function recordTransportResult(document: DteDocument, result: Awaited<ReturnType<typeof submitDteToSii>>): Promise<DteDocument> {
  const now = new Date();
  const wasSent = result.status === DteStatus.SENT
    || result.status === DteStatus.ACCEPTED
    || result.status === DteStatus.OBSERVED
    || result.status === DteStatus.REJECTED;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.dteDocument.update({
      where: { id: document.id },
      data: {
        status: result.status,
        trackId: result.trackId,
        siiStatusCode: result.code,
        siiStatusMessage: result.message,
        responseRaw: result.raw,
        xmlSigned: result.signedXml ?? undefined,
        sentAt: wasSent ? now : undefined,
        acceptedAt: result.status === DteStatus.ACCEPTED ? now : undefined,
        errorMessage: result.status === DteStatus.ERROR ? result.message : null,
      },
    });
    await tx.dteEvent.create({
      data: {
        documentId: document.id,
        status: result.status,
        code: result.code,
        message: result.message,
        raw: result.raw,
      },
    });
    return updated;
  });
}

async function markTransportError(documentIdValue: string, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : "Error desconocido al enviar el DTE.";
  await prisma.$transaction(async (tx) => {
    await tx.dteDocument.update({
      where: { id: documentIdValue },
      data: { status: DteStatus.ERROR, errorMessage: message, siiStatusMessage: message },
    });
    await tx.dteEvent.create({
      data: { documentId: documentIdValue, status: DteStatus.ERROR, message },
    });
  });
  throw new DteBillingError(message);
}

export async function issuePosSaleDte(input: IssuePosDteInput): Promise<DteDocument> {
  if (input.type !== DteDocumentType.BOLETA_ELECTRONICA && input.type !== DteDocumentType.FACTURA_ELECTRONICA) {
    throw new DteBillingError("Este flujo solo permite boleta electrónica tipo 39 o factura electrónica tipo 33.");
  }

  const config = getSiiConfig();
  if (config.environment !== DteEnvironment.MOCK) assertSiiCanSubmit(config);

  const typeCode = dteTypeCode(input.type);
  const sale = await prisma.posSale.findUnique({
    where: { id: input.saleId.slice(0, 30) },
    include: {
      items: { orderBy: { productName: "asc" } },
      dteDocuments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!sale) throw new DteBillingError("Venta POS no encontrada.");

  const blocking = sale.dteDocuments.find((item) =>
    [33, 39].includes(item.typeCode)
    && item.status !== DteStatus.CANCELLED
    && item.status !== DteStatus.REJECTED,
  );
  if (blocking) {
    throw new DteBillingError(`La venta ya tiene ${dteTypeLabel(blocking.type)} folio ${blocking.folio} en estado ${blocking.status}.`);
  }

  const receiverRutRaw = clean(input.receiverRut, 20) ?? sale.customerRut;
  const receiverName = clean(input.receiverName, 191) ?? sale.customerName;
  const receiverGiro = clean(input.receiverGiro, 191);
  const receiverAddress = clean(input.receiverAddress, 255);
  const receiverCommune = clean(input.receiverCommune, 120);
  const receiverCity = clean(input.receiverCity, 120);

  if (input.type === DteDocumentType.FACTURA_ELECTRONICA) {
    if (!receiverRutRaw || !isValidRut(receiverRutRaw)) throw new DteBillingError("Para emitir factura debes ingresar un RUT receptor válido.");
    if (!receiverName || !receiverGiro || !receiverAddress || !receiverCommune) {
      throw new DteBillingError("Para emitir factura completa razón social, giro, dirección y comuna del receptor.");
    }
  }

  const receiverRut = receiverRutRaw ? normalizeRut(receiverRutRaw) : null;
  const { net, vat } = taxTotals(sale.total, config.vatRate);
  const now = new Date();
  const id = documentId();

  const document = await prisma.$transaction(async (tx) => {
    const folio = await nextFolio(tx, typeCode, config.environment);
    const snapshot: DteXmlSnapshot = {
      id: `DTE-${typeCode}-${folio}`,
      typeCode,
      folio,
      issueDate: now,
      saleNumber: sale.saleNumber,
      issuer: {
        rut: placeholder(config.company.rut, "76000000-0", config.environment),
        legalName: placeholder(config.company.legalName, "Renacer Distribuidora", config.environment),
        giro: placeholder(config.company.giro, "Venta de alimentos", config.environment),
        activityCode: placeholder(config.company.activityCode, "000000", config.environment),
        address: placeholder(config.company.address, "Dirección pendiente", config.environment),
        commune: placeholder(config.company.commune, "Comuna pendiente", config.environment),
        city: placeholder(config.company.city, "Ciudad pendiente", config.environment),
      },
      receiver: receiverRut && receiverName ? {
        rut: receiverRut,
        name: receiverName,
        giro: receiverGiro,
        address: receiverAddress,
        commune: receiverCommune,
        city: receiverCity,
      } : null,
      netAmount: net,
      exemptAmount: 0,
      vatRate: config.vatRate,
      vatAmount: vat,
      totalAmount: sale.total,
      lines: sale.items.map((item, index) => ({
        line: index + 1,
        name: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        amount: item.subtotal,
      })),
    };
    const xmlDraft = buildDteXmlDraft(snapshot);

    const created = await tx.dteDocument.create({
      data: {
        id,
        saleId: sale.id,
        type: input.type,
        typeCode,
        folio,
        environment: config.environment,
        status: DteStatus.GENERATED,
        issueDate: now,
        receiverRut,
        receiverName,
        receiverGiro,
        receiverAddress,
        receiverCommune,
        receiverCity,
        netAmount: net,
        exemptAmount: 0,
        vatAmount: vat,
        vatRate: config.vatRate,
        totalAmount: sale.total,
        xmlDraft,
        issuedAt: now,
      },
    });
    await tx.dteEvent.create({
      data: {
        documentId: created.id,
        status: DteStatus.GENERATED,
        code: "DTE_GENERATED",
        message: `${dteTypeLabel(input.type)} generada desde venta ${sale.saleNumber}.`,
      },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  try {
    const result = await submitDteToSii({
      documentId: document.id,
      typeCode: document.typeCode,
      folio: document.folio,
      environment: document.environment,
      issueDate: document.issueDate.toISOString(),
      issuerRut: config.company.rut,
      receiverRut: document.receiverRut,
      totalAmount: document.totalAmount,
      xmlDraft: document.xmlDraft ?? "",
    });
    return await recordTransportResult(document, result);
  } catch (error) {
    return markTransportError(document.id, error);
  }
}

export async function retryDteSubmission(documentIdValue: string): Promise<DteDocument> {
  const document = await prisma.dteDocument.findUnique({ where: { id: documentIdValue.slice(0, 30) } });
  if (!document) throw new DteBillingError("DTE no encontrado.");
  const retryable = document.status === DteStatus.ERROR
    || document.status === DteStatus.GENERATED
    || document.status === DteStatus.QUEUED;
  if (!retryable) {
    throw new DteBillingError(`El documento está en estado ${document.status} y no puede reenviarse automáticamente.`);
  }
  const config = getSiiConfig();
  if (document.environment !== config.environment) throw new DteBillingError("El ambiente configurado cambió desde que se generó el DTE. No se reenviará para evitar mezclar ambientes.");
  if (config.environment !== DteEnvironment.MOCK) assertSiiCanSubmit(config);

  try {
    const result = await submitDteToSii({
      documentId: document.id,
      typeCode: document.typeCode,
      folio: document.folio,
      environment: document.environment,
      issueDate: document.issueDate.toISOString(),
      issuerRut: config.company.rut,
      receiverRut: document.receiverRut,
      totalAmount: document.totalAmount,
      xmlDraft: document.xmlDraft ?? "",
    });
    return await recordTransportResult(document, result);
  } catch (error) {
    return markTransportError(document.id, error);
  }
}

export async function syncDteStatus(documentIdValue: string): Promise<DteDocument> {
  const document = await prisma.dteDocument.findUnique({ where: { id: documentIdValue.slice(0, 30) } });
  if (!document) throw new DteBillingError("DTE no encontrado.");
  if (!document.trackId) throw new DteBillingError("El DTE todavía no tiene Track ID para consultar.");

  try {
    const result = await queryDteStatus(document.trackId);
    return await recordTransportResult(document, result);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "No fue posible consultar el estado SII.";
    await prisma.dteEvent.create({
      data: { documentId: document.id, status: document.status, code: "STATUS_QUERY_ERROR", message },
    });
    throw new DteBillingError(message);
  }
}
