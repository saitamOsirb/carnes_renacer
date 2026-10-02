import "server-only";

export type DteXmlLine = {
  line: number;
  name: string;
  quantity: number;
  unit: "KG" | "UNIT";
  unitPrice: number;
  amount: number;
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

export function buildDteXmlDraft(snapshot: DteXmlSnapshot): string {
  const detail = snapshot.lines.map((line) => [
    "<Detalle>",
    `<NroLinDet>${line.line}</NroLinDet>`,
    `<NmbItem>${xml(line.name)}</NmbItem>`,
    `<QtyItem>${line.quantity}</QtyItem>`,
    `<UnmdItem>${line.unit === "KG" ? "KG" : "UN"}</UnmdItem>`,
    `<PrcItem>${line.unitPrice}</PrcItem>`,
    `<MontoItem>${line.amount}</MontoItem>`,
    "</Detalle>",
  ].join("")).join("");

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
    "<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>SET</TpoDocRef>",
    `<FolioRef>${xml(snapshot.saleNumber)}</FolioRef><RazonRef>Venta POS origen</RazonRef></Referencia>`,
    "</Documento>",
    "</DTE>",
  ].filter(Boolean).join("");
}
