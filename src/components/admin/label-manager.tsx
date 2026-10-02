"use client";

import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";
import { saveLabelTemplate } from "@/app/admin/label-actions";
import { Code128Barcode } from "@/components/admin/code128-barcode";

type LabelTemplate = {
  name: string;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  paddingMm: number;
  printMode: "ROLL" | "SHEET";
  showCompany: boolean;
  showCategory: boolean;
  showPrice: boolean;
  showUnit: boolean;
  showBarcode: boolean;
  showImage: boolean;
  showDate: boolean;
  border: boolean;
};

type LabelProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  barcode: string | null;
};

type Props = {
  initialTemplate: LabelTemplate;
  products: LabelProduct[];
};

type QueueItem = {
  productId: string;
  quantity: number;
};

const PRESETS = [
  { label: "50 × 30 mm", widthMm: 50, heightMm: 30 },
  { label: "58 × 40 mm", widthMm: 58, heightMm: 40 },
  { label: "80 × 50 mm", widthMm: 80, heightMm: 50 },
] as const;

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatClp(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
}

function LabelPreview({ product, template }: { product: LabelProduct; template: LabelTemplate }) {
  const style = {
    "--label-width": `${template.widthMm}mm`,
    "--label-height": `${template.heightMm}mm`,
    "--label-padding": `${template.paddingMm}mm`,
  } as CSSProperties;

  return (
    <article className={`product-label${template.border ? " has-border" : ""}${template.showImage ? " with-image" : ""}`} style={style}>
      {template.showImage && (
        <div className="product-label-image">
          <Image src={product.imageUrl} alt="" fill sizes="90px" />
        </div>
      )}
      <div className="product-label-content">
        {template.showCompany && <span className="product-label-company">Renacer Distribuidora</span>}
        {template.showCategory && <span className="product-label-category">{product.category}</span>}
        <strong className="product-label-name">{product.name}</strong>
        {template.showPrice && (
          <div className="product-label-price">
            <strong>{formatClp(product.price)}</strong>
            {template.showUnit && <span>/ {product.unit === "KG" ? "kg" : "unidad"}</span>}
          </div>
        )}
        {template.showBarcode && (
          <div className="product-label-barcode">
            {product.barcode ? (
              <>
                <Code128Barcode value={product.barcode} />
                <span>{product.barcode}</span>
              </>
            ) : (
              <strong className="product-label-no-code">SIN CÓDIGO</strong>
            )}
          </div>
        )}
        {template.showDate && <small className="product-label-date">Precio vigente · {todayLabel()}</small>}
      </div>
    </article>
  );
}

export function LabelManager({ initialTemplate, products }: Props) {
  const [template, setTemplate] = useState(initialTemplate);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const filteredProducts = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return products;
    return products.filter((product) => normalize(`${product.name} ${product.category} ${product.barcode ?? ""}`).includes(term));
  }, [products, search]);

  const queueDetailed = queue.flatMap((item) => {
    const product = productMap.get(item.productId);
    return product ? [{ ...item, product }] : [];
  });
  const totalLabels = queue.reduce((sum, item) => sum + item.quantity, 0);
  const previewProduct = queueDetailed[0]?.product ?? products[0] ?? null;

  const printLabels = queueDetailed.flatMap((item) =>
    Array.from({ length: item.quantity }, (_, index) => ({ product: item.product, key: `${item.productId}-${index}` })),
  );

  const printPageCss = template.printMode === "ROLL"
    ? `@page { size: ${template.widthMm}mm ${template.heightMm}mm; margin: 0; }`
    : "@page { size: A4 portrait; margin: 8mm; }";

  function updateTemplate<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K]): void {
    setTemplate((current) => ({ ...current, [key]: value }));
  }

  function addToQueue(productId: string): void {
    setQueue((current) => {
      const found = current.find((item) => item.productId === productId);
      if (found) {
        return current.map((item) => item.productId === productId ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item);
      }
      return [...current, { productId, quantity: 1 }];
    });
  }

  function updateQuantity(productId: string, quantity: number): void {
    const safe = Math.max(1, Math.min(99, Math.trunc(quantity || 1)));
    setQueue((current) => current.map((item) => item.productId === productId ? { ...item, quantity: safe } : item));
  }

  function removeFromQueue(productId: string): void {
    setQueue((current) => current.filter((item) => item.productId !== productId));
  }

  function print(): void {
    if (totalLabels === 0) return;
    window.print();
  }

  return (
    <div className="label-manager">
      <style media="print">{printPageCss}</style>

      <div className="label-manager-grid">
        <section className="admin-card label-template-card">
          <div className="admin-card-heading">
            <div><h2>Plantilla de etiqueta</h2><p>Configura medidas físicas, contenido y tipo de impresión.</p></div>
          </div>

          <div className="label-preset-row">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                className="admin-button admin-button-secondary"
                onClick={() => setTemplate((current) => ({ ...current, widthMm: preset.widthMm, heightMm: preset.heightMm }))}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <form action={saveLabelTemplate} className="admin-form label-template-form">
            <label>Nombre de plantilla<input name="name" value={template.name} maxLength={60} onChange={(event) => updateTemplate("name", event.target.value)} /></label>
            <div className="label-dimension-grid">
              <label>Ancho (mm)<input name="widthMm" type="number" min="25" max="120" step="1" value={template.widthMm} onChange={(event) => updateTemplate("widthMm", Number(event.target.value))} /></label>
              <label>Alto (mm)<input name="heightMm" type="number" min="20" max="100" step="1" value={template.heightMm} onChange={(event) => updateTemplate("heightMm", Number(event.target.value))} /></label>
              <label>Separación (mm)<input name="gapMm" type="number" min="0" max="12" step="0.5" value={template.gapMm} onChange={(event) => updateTemplate("gapMm", Number(event.target.value))} /></label>
              <label>Margen interno (mm)<input name="paddingMm" type="number" min="0" max="8" step="0.5" value={template.paddingMm} onChange={(event) => updateTemplate("paddingMm", Number(event.target.value))} /></label>
            </div>
            <label>Modo de impresión
              <select name="printMode" value={template.printMode} onChange={(event) => updateTemplate("printMode", event.target.value === "SHEET" ? "SHEET" : "ROLL")}>
                <option value="ROLL">Rollo / térmica · una etiqueta por página</option>
                <option value="SHEET">Hoja A4 · varias etiquetas</option>
              </select>
            </label>

            <div className="label-field-switches">
              <label><input name="showCompany" type="checkbox" checked={template.showCompany} onChange={(event) => updateTemplate("showCompany", event.target.checked)} /> Empresa</label>
              <label><input name="showCategory" type="checkbox" checked={template.showCategory} onChange={(event) => updateTemplate("showCategory", event.target.checked)} /> Categoría</label>
              <label><input name="showPrice" type="checkbox" checked={template.showPrice} onChange={(event) => updateTemplate("showPrice", event.target.checked)} /> Precio</label>
              <label><input name="showUnit" type="checkbox" checked={template.showUnit} onChange={(event) => updateTemplate("showUnit", event.target.checked)} /> Unidad</label>
              <label><input name="showBarcode" type="checkbox" checked={template.showBarcode} onChange={(event) => updateTemplate("showBarcode", event.target.checked)} /> Código de barras</label>
              <label><input name="showImage" type="checkbox" checked={template.showImage} onChange={(event) => updateTemplate("showImage", event.target.checked)} /> Imagen</label>
              <label><input name="showDate" type="checkbox" checked={template.showDate} onChange={(event) => updateTemplate("showDate", event.target.checked)} /> Fecha</label>
              <label><input name="border" type="checkbox" checked={template.border} onChange={(event) => updateTemplate("border", event.target.checked)} /> Borde</label>
            </div>

            <button type="submit" className="admin-button admin-button-primary">Guardar plantilla</button>
          </form>
        </section>

        <section className="admin-card label-preview-card">
          <div className="admin-card-heading"><div><h2>Vista previa</h2><p>{template.widthMm} × {template.heightMm} mm</p></div></div>
          <div className="label-preview-stage">
            {previewProduct ? <LabelPreview product={previewProduct} template={template} /> : <div className="pos-empty">No hay productos activos para previsualizar.</div>}
          </div>
        </section>
      </div>

      <section className="admin-card label-product-picker">
        <div className="admin-card-heading">
          <div><h2>Productos</h2><p>Agrega productos a la cola y define cuántas copias imprimir.</p></div>
          <label className="label-search">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, categoría o código" /></label>
        </div>

        <div className="label-product-grid">
          {filteredProducts.map((product) => (
            <article className="label-product-card" key={product.id}>
              <Image src={product.imageUrl} alt={product.name} width={72} height={58} sizes="72px" />
              <div>
                <strong>{product.name}</strong>
                <small>{product.category}</small>
                <span>{formatClp(product.price)} / {product.unit === "KG" ? "kg" : "unidad"}</span>
                <em className={product.barcode ? "has-code" : "no-code"}>{product.barcode ?? "Sin código"}</em>
              </div>
              <button type="button" className="admin-button admin-button-secondary" onClick={() => addToQueue(product.id)}>Agregar</button>
            </article>
          ))}
          {filteredProducts.length === 0 && <div className="pos-empty">No hay productos para este filtro.</div>}
        </div>
      </section>

      <section className="admin-card label-queue-card">
        <div className="admin-card-heading">
          <div><h2>Cola de impresión</h2><p>{totalLabels} etiqueta{totalLabels === 1 ? "" : "s"} preparada{totalLabels === 1 ? "" : "s"}.</p></div>
          <div className="label-queue-actions">
            {queue.length > 0 && <button type="button" className="admin-button admin-button-secondary" onClick={() => setQueue([])}>Vaciar cola</button>}
            <button type="button" className="admin-button admin-button-primary" disabled={totalLabels === 0} onClick={print}>Imprimir etiquetas</button>
          </div>
        </div>

        {queueDetailed.length === 0 ? (
          <div className="pos-empty">Agrega uno o más productos para preparar la impresión.</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table label-queue-table">
              <thead><tr><th>Producto</th><th>Código</th><th>Copias</th><th></th></tr></thead>
              <tbody>
                {queueDetailed.map((item) => (
                  <tr key={item.productId}>
                    <td><strong>{item.product.name}</strong><small>{formatClp(item.product.price)} / {item.product.unit === "KG" ? "kg" : "unidad"}</small></td>
                    <td>{item.product.barcode ?? <span className="label-warning">Sin código</span>}</td>
                    <td><input className="label-qty-input" type="number" min="1" max="99" value={item.quantity} onChange={(event) => updateQuantity(item.productId, Number(event.target.value))} /></td>
                    <td><button type="button" className="label-remove-button" onClick={() => removeFromQueue(item.productId)}>Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`label-print-area is-${template.printMode.toLowerCase()}`} style={{ "--label-gap": `${template.gapMm}mm` } as CSSProperties}>
        {printLabels.map((item) => <LabelPreview key={item.key} product={item.product} template={template} />)}
      </div>
    </div>
  );
}
