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
import { toQuantityNumber } from "@/lib/quantity";
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

export type IssuePosReturnCreditNoteInput = {
  returnId: string;
  parentDocumentId?: string;
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
    await tx.dteEvent.create({ data: { documentId: document.id, status: result.status, code: result.code, message: result.message, raw: result.raw } });
    return updated;
  });
}

async function markTransportError(documentIdValue: string, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : "Error desconocido al enviar el DTE.";
  await prisma.$transaction(async (tx) => {
    await tx.dteDocument.update({ where: { id: documentIdValue }, data: { status: DteStatus.ERROR, errorMessage: message, siiStatusMessage: message } });
    await tx.dteEvent.create({ data: { documentId: documentIdValue, status: DteStatus.ERROR, message } });
  });
  throw new DteBillingError(message);
}

async function submitCreatedDocument(document: DteDocument): Promise<DteDocument> {
  const config = getSiiConfig();
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

export async function issuePosSaleDte(input: IssuePosDteInput): Promise<DteDocument> {
  if (input.type !== DteDocumentType.BOLETA_ELECTRONICA && input.type !== DteDocumentType.FACTURA_ELECTRONICA) {
    throw new DteBillingError("Este flujo solo permite boleta electrónica tipo 39 o factura electrónica tipo 33.");
  }

  const config = getSiiConfig();
  if (config.environment !== DteEnvironment.MOCK) assertSiiCanSubmit(config);

  const typeCode = dteTypeCode(input.type);
  const sale = await prisma.posSale.findUnique({
    where: { id: input.saleId.slice(0, 30) },
    include: { items: { orderBy: { productName: "asc" } }, dteDocuments: { orderBy: { createdAt: "desc" } } },
  });
  if (!sale) throw new DteBillingError("Venta POS no encontrada.");

  const blocking = sale.dteDocuments.find((item) => [33, 39].includes(item.typeCode) && item.status !== DteStatus.CANCELLED && item.status !== DteStatus.REJECTED);
  if (blocking) throw new DteBillingError(`La venta ya tiene ${dteTypeLabel(blocking.type)} folio ${blocking.folio} en estado ${blocking.status}.`);

  const receiverRutRaw = clean(input.receiverRut, 20) ?? sale.customerRut;
  const receiverName = clean(input.receiverName, 191) ?? sale.customerName;
  const receiverGiro = clean(input.receiverGiro, 191);
  const receiverAddress = clean(input.receiverAddress, 255);
  const receiverCommune = clean(input.receiverCommune, 120);
  const receiverCity = clean(input.receiverCity, 120);

  if (input.type === DteDocumentType.FACTURA_ELECTRONICA) {
    if (!receiverRutRaw || !isValidRut(receiverRutRaw)) throw new DteBillingError("Para emitir factura debes ingresar un RUT receptor válido.");
    if (!receiverName || !receiverGiro || !receiverAddress || !receiverCommune) throw new DteBillingError("Para emitir factura completa razón social, giro, dirección y comuna del receptor.");
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
      receiver: receiverRut && receiverName ? { rut: receiverRut, name: receiverName, giro: receiverGiro, address: receiverAddress, commune: receiverCommune, city: receiverCity } : null,
      netAmount: net,
      exemptAmount: 0,
      vatRate: config.vatRate,
      vatAmount: vat,
      totalAmount: sale.total,
      lines: sale.items.map((item, index) => ({
        line: index + 1,
        name: item.productName,
        quantity: toQuantityNumber(item.quantity),
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
    await tx.dteEvent.create({ data: { documentId: created.id, status: DteStatus.GENERATED, code: "DTE_GENERATED", message: `${dteTypeLabel(input.type)} generada desde venta ${sale.saleNumber}.` } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return submitCreatedDocument(document);
}

export async function issuePosReturnCreditNote(input: IssuePosReturnCreditNoteInput): Promise<DteDocument> {
  const config = getSiiConfig();
  if (config.environment !== DteEnvironment.MOCK) assertSiiCanSubmit(config);

  const posReturn = await prisma.posReturn.findUnique({
    where: { id: input.returnId.slice(0, 30) },
    include: {
      items: { orderBy: { productName: "asc" } },
      dteDocuments: { orderBy: { createdAt: "desc" } },
      sale: {
        include: {
          returns: { select: { totalAmount: true } },
          dteDocuments: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!posReturn) throw new DteBillingError("Devolución POS no encontrada.");

  const blocking = posReturn.dteDocuments.find((item) => item.typeCode === 61 && item.status !== DteStatus.CANCELLED && item.status !== DteStatus.REJECTED);
  if (blocking) throw new DteBillingError(`La devolución ya tiene nota de crédito folio ${blocking.folio} en estado ${blocking.status}.`);

  const originalDocuments = posReturn.sale.dteDocuments.filter((item) =>
    (item.typeCode === 33 || item.typeCode === 39)
    && item.status !== DteStatus.CANCELLED
    && item.status !== DteStatus.REJECTED,
  );
  const parent = input.parentDocumentId
    ? originalDocuments.find((item) => item.id === input.parentDocumentId?.slice(0, 30))
    : originalDocuments[0];
  if (!parent) throw new DteBillingError("La venta original no tiene una boleta o factura válida para referenciar en la nota de crédito.");
  if (parent.environment !== config.environment) throw new DteBillingError("El DTE original pertenece a otro ambiente SII.");
  if (config.environment !== DteEnvironment.MOCK && parent.status !== DteStatus.ACCEPTED && parent.status !== DteStatus.OBSERVED) {
    throw new DteBillingError(`El DTE original está en estado ${parent.status}. Actualiza su estado antes de emitir la nota de crédito.`);
  }

  const cumulativeRefund = posReturn.sale.returns.reduce((sum, item) => sum + item.totalAmount, 0);
  const fullReturn = cumulativeRefund >= posReturn.sale.total;
  const referenceCode = fullReturn ? 1 : 3;
  const typeCode = dteTypeCode(DteDocumentType.NOTA_CREDITO);
  const { net, vat } = taxTotals(posReturn.totalAmount, config.vatRate);
  const now = new Date();
  const id = documentId();

  const document = await prisma.$transaction(async (tx) => {
    const folio = await nextFolio(tx, typeCode, config.environment);
    const snapshot: DteXmlSnapshot = {
      id: `DTE-${typeCode}-${folio}`,
      typeCode,
      folio,
      issueDate: now,
      saleNumber: posReturn.sale.saleNumber,
      issuer: {
        rut: placeholder(config.company.rut, "76000000-0", config.environment),
        legalName: placeholder(config.company.legalName, "Renacer Distribuidora", config.environment),
        giro: placeholder(config.company.giro, "Venta de alimentos", config.environment),
        activityCode: placeholder(config.company.activityCode, "000000", config.environment),
        address: placeholder(config.company.address, "Dirección pendiente", config.environment),
        commune: placeholder(config.company.commune, "Comuna pendiente", config.environment),
        city: placeholder(config.company.city, "Ciudad pendiente", config.environment),
      },
      receiver: parent.receiverRut && parent.receiverName ? {
        rut: parent.receiverRut,
        name: parent.receiverName,
        giro: parent.receiverGiro,
        address: parent.receiverAddress,
        commune: parent.receiverCommune,
        city: parent.receiverCity,
      } : null,
      netAmount: net,
      exemptAmount: 0,
      vatRate: config.vatRate,
      vatAmount: vat,
      totalAmount: posReturn.totalAmount,
      lines: posReturn.items.map((item, index) => ({
        line: index + 1,
        name: item.productName,
        quantity: toQuantityNumber(item.quantity),
        unit: item.unit,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        amount: item.totalAmount,
      })),
      references: [{
        line: 1,
        documentType: parent.typeCode,
        folio: parent.folio,
        issueDate: parent.issueDate,
        code: referenceCode,
        reason: fullReturn
          ? `Anulación por devolución total ${posReturn.returnNumber}`
          : `Corrección de montos por devolución parcial ${posReturn.returnNumber}`,
      }],
    };
    const xmlDraft = buildDteXmlDraft(snapshot);

    const created = await tx.dteDocument.create({
      data: {
        id,
        saleId: posReturn.saleId,
        returnId: posReturn.id,
        parentId: parent.id,
        type: DteDocumentType.NOTA_CREDITO,
        typeCode,
        folio,
        environment: config.environment,
        status: DteStatus.GENERATED,
        issueDate: now,
        receiverRut: parent.receiverRut,
        receiverName: parent.receiverName,
        receiverGiro: parent.receiverGiro,
        receiverAddress: parent.receiverAddress,
        receiverCommune: parent.receiverCommune,
        receiverCity: parent.receiverCity,
        netAmount: net,
        exemptAmount: 0,
        vatAmount: vat,
        vatRate: config.vatRate,
        totalAmount: posReturn.totalAmount,
        xmlDraft,
        issuedAt: now,
      },
    });
    await tx.dteEvent.create({
      data: {
        documentId: created.id,
        status: DteStatus.GENERATED,
        code: "CREDIT_NOTE_GENERATED",
        message: `Nota de crédito generada por ${posReturn.returnNumber}, referenciando DTE ${parent.typeCode} folio ${parent.folio}.`,
      },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return submitCreatedDocument(document);
}

export async function retryDteSubmission(documentIdValue: string): Promise<DteDocument> {
  const document = await prisma.dteDocument.findUnique({ where: { id: documentIdValue.slice(0, 30) } });
  if (!document) throw new DteBillingError("DTE no encontrado.");
  const retryable = document.status === DteStatus.ERROR || document.status === DteStatus.GENERATED || document.status === DteStatus.QUEUED;
  if (!retryable) throw new DteBillingError(`El documento está en estado ${document.status} y no puede reenviarse automáticamente.`);
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
    await prisma.dteEvent.create({ data: { documentId: document.id, status: document.status, code: "STATUS_QUERY_ERROR", message } });
    throw new DteBillingError(message);
  }
}
