import "server-only";

export type DteXmlLine = {
  line: number;
  name: string;
  quantity: number;
  unit: "KG" | "UNIT";
  unitPrice: number;
  amount: number;
  discountAmount?: number;
};

export type DteXmlReference = {
  line: number;
  documentType: string | number;
  folio: string | number;
  issueDate?: Date | null;
  code?: number | null;
  reason: string;
};

export type DteXmlSnapshot = {
  id: string;
  typeCode: number;
  folio: number;
  issueDate: Date;
  saleNumber: string;
  issuer: {
    rut: string;
    legalName: string;
    giro: string;
    activityCode: string;
    address: string;
    commune: string;
    city: string;
  };
  receiver?: {
    rut: string;
    name: string;
    giro?: string | null;
    address?: string | null;
    commune?: string | null;
    city?: string | null;
  } | null;
  netAmount: number;
  exemptAmount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  lines: DteXmlLine[];
  references?: DteXmlReference[];
};

function xml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function dateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function receiverXml(snapshot: DteXmlSnapshot): string {
  const receiver = snapshot.receiver;
  if (!receiver) return "";
  return [
    "<Receptor>",
    `<RUTRecep>${xml(receiver.rut)}</RUTRecep>`,
    `<RznSocRecep>${xml(receiver.name)}</RznSocRecep>`,
    receiver.giro ? `<GiroRecep>${xml(receiver.giro)}</GiroRecep>` : "",
    receiver.address ? `<DirRecep>${xml(receiver.address)}</DirRecep>` : "",
    receiver.commune ? `<CmnaRecep>${xml(receiver.commune)}</CmnaRecep>` : "",
    receiver.city ? `<CiudadRecep>${xml(receiver.city)}</CiudadRecep>` : "",
    "</Receptor>",
  ].filter(Boolean).join("");
}

function referencesXml(snapshot: DteXmlSnapshot): string {
  const references = snapshot.references?.length
    ? snapshot.references
    : [{ line: 1, documentType: "SET", folio: snapshot.saleNumber, reason: "Venta POS origen" }];

  return references.map((reference) => [
    "<Referencia>",
    `<NroLinRef>${reference.line}</NroLinRef>`,
    `<TpoDocRef>${xml(reference.documentType)}</TpoDocRef>`,
    `<FolioRef>${xml(reference.folio)}</FolioRef>`,
    reference.issueDate ? `<FchRef>${dateOnly(reference.issueDate)}</FchRef>` : "",
    reference.code ? `<CodRef>${reference.code}</CodRef>` : "",
    `<RazonRef>${xml(reference.reason)}</RazonRef>`,
    "</Referencia>",
  ].filter(Boolean).join("")).join("");
}

export function buildDteXmlDraft(snapshot: DteXmlSnapshot): string {
  const detail = snapshot.lines.map((line) => [
    "<Detalle>",
    `<NroLinDet>${line.line}</NroLinDet>`,
    `<NmbItem>${xml(line.name)}</NmbItem>`,
    `<QtyItem>${line.quantity}</QtyItem>`,
    `<UnmdItem>${line.unit === "KG" ? "KG" : "UN"}</UnmdItem>`,
    `<PrcItem>${line.unitPrice}</PrcItem>`,
    line.discountAmount && line.discountAmount > 0 ? `<DescuentoMonto>${line.discountAmount}</DescuentoMonto>` : "",
    `<MontoItem>${line.amount}</MontoItem>`,
    "</Detalle>",
  ].filter(Boolean).join("")).join("");

  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<DTE version="1.0">',
    `<Documento ID="${xml(snapshot.id)}">`,
    "<Encabezado>",
    "<IdDoc>",
    `<TipoDTE>${snapshot.typeCode}</TipoDTE>`,
    `<Folio>${snapshot.folio}</Folio>`,
    `<FchEmis>${dateOnly(snapshot.issueDate)}</FchEmis>`,
    snapshot.typeCode === 39 ? "<MntBruto>1</MntBruto>" : "",
    "</IdDoc>",
    "<Emisor>",
    `<RUTEmisor>${xml(snapshot.issuer.rut)}</RUTEmisor>`,
    `<RznSoc>${xml(snapshot.issuer.legalName)}</RznSoc>`,
    `<GiroEmis>${xml(snapshot.issuer.giro)}</GiroEmis>`,
    `<Acteco>${xml(snapshot.issuer.activityCode)}</Acteco>`,
    `<DirOrigen>${xml(snapshot.issuer.address)}</DirOrigen>`,
    `<CmnaOrigen>${xml(snapshot.issuer.commune)}</CmnaOrigen>`,
    `<CiudadOrigen>${xml(snapshot.issuer.city)}</CiudadOrigen>`,
    "</Emisor>",
    receiverXml(snapshot),
    "<Totales>",
    `<MntNeto>${snapshot.netAmount}</MntNeto>`,
    snapshot.exemptAmount > 0 ? `<MntExe>${snapshot.exemptAmount}</MntExe>` : "",
    `<TasaIVA>${snapshot.vatRate}</TasaIVA>`,
    `<IVA>${snapshot.vatAmount}</IVA>`,
    `<MntTotal>${snapshot.totalAmount}</MntTotal>`,
    "</Totales>",
    "</Encabezado>",
    detail,
    referencesXml(snapshot),
    "</Documento>",
    "</DTE>",
  ].filter(Boolean).join("");
}
