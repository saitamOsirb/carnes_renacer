import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createProduct, deleteProduct, updateProduct } from "@/app/admin/actions";
import { updateProductBarcode } from "@/app/admin/product-barcode-actions";
import { formatQuantity, roundQuantity, toQuantityNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const BARCODE_PREFIX = "barcode:";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [products, barcodeSettings, query] = await Promise.all([
    prisma.product.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.storeSetting.findMany({
      where: { key: { startsWith: BARCODE_PREFIX } },
      select: { key: true, value: true },
    }),
    searchParams,
  ]);

  const barcodeByProduct = new Map(
    barcodeSettings.map((setting) => [setting.value, setting.key.slice(BARCODE_PREFIX.length)]),
  );

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div><span className="admin-kicker">Catálogo</span><h1>Mantenedor de productos</h1><p>Los cambios se reflejan en la tienda. Productos por kg admiten stock con precisión de 0,001 kg.</p></div>
        <div className="admin-stat"><strong>{products.length}</strong><span>productos</span></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading"><div><h2>Nuevo producto</h2><p>WebP, PNG o JPEG. Máximo 5 MB. El stock inicial se asigna a la bodega principal.</p></div></div>
        <form action={createProduct} className="admin-product-form">
          <div className="admin-grid admin-grid-3">
            <label>Nombre<input name="name" required minLength={2} maxLength={191} /></label>
            <label>Slug <small>(opcional)</small><input name="slug" maxLength={191} placeholder="se genera desde el nombre" /></label>
            <label>Categoría<input name="category" required maxLength={100} placeholder="Vacuno, Cerdo, Pollo…" /></label>
            <label>Precio CLP<input name="price" type="number" required min="0" step="1" /></label>
            <label>Stock inicial<input name="stock" type="number" required min="0" step="0.001" /><small>KG permite hasta tres decimales; unidad exige enteros.</small></label>
            <label>Unidad<select name="unit" defaultValue="KG"><option value="KG">Kilogramo (KG)</option><option value="UNIT">Unidad</option></select></label>
          </div>
          <label>Descripción<textarea name="description" required minLength={3} maxLength={5000} rows={3} /></label>
          <label className="admin-file">Imagen<input name="image" type="file" required accept="image/webp,image/png,image/jpeg" /></label>
          <div className="admin-checks">
            <label><input type="checkbox" name="active" defaultChecked /> Activo</label>
            <label><input type="checkbox" name="featured" /> Destacado</label>
          </div>
          <button className="admin-button admin-button-primary" type="submit">Crear producto</button>
        </form>
        <div className="admin-inline-notice" style={{ marginTop: 16 }}>Después de crear el producto podrás asociar su código de barras directamente en su ficha. Puedes escribirlo o enfocar el campo y escanear con un lector USB/Bluetooth.</div>
      </section>

      <div className="admin-inline-notice">El stock físico y reservado es de solo lectura aquí. Usa <Link href="/admin/inventario">Inventario</Link> para entradas, salidas, ajustes, mínimos y transferencias. La unidad de medida no puede cambiarse una vez que exista historial de inventario.</div>

      <section className="admin-products-list">
        {products.map((product) => {
          const barcode = barcodeByProduct.get(product.id) ?? "";
          const physical = toQuantityNumber(product.stock);
          const reserved = toQuantityNumber(product.reserved);
          const available = roundQuantity(Math.max(0, physical - reserved));
          return (
            <article className={`admin-product-card${product.active ? "" : " is-inactive"}`} key={product.id}>
              <div className="admin-product-preview">
                <Image src={product.imageUrl} alt={product.name} width={180} height={138} sizes="180px" />
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.active ? "Activo" : "Inactivo"}</span>
                  <small>ID: {product.id}</small>
                  <small>Código: {barcode || "Sin código de barras"}</small>
                </div>
              </div>

              <form action={updateProductBarcode} className="admin-form" style={{ marginBottom: 20, paddingBottom: 18, borderBottom: "1px solid #ece8e3" }}>
                <input type="hidden" name="productId" value={product.id} />
                <div className="admin-grid admin-grid-3" style={{ alignItems: "end" }}>
                  <label>Código de barras<input name="barcode" defaultValue={barcode} minLength={4} maxLength={80} autoComplete="off" placeholder="Ej: 7801234567890" /><small>Enfoca este campo y escanea. Dejar vacío desasocia el código.</small></label>
                  <div><button className="admin-button admin-button-secondary" type="submit">Guardar código</button></div>
                  <div><Link className="admin-button admin-button-secondary" href="/admin/consulta-precio">Probar consulta</Link></div>
                </div>
              </form>

              <form action={updateProduct} className="admin-product-form">
                <input type="hidden" name="id" value={product.id} />
                <div className="admin-grid admin-grid-3">
                  <label>Nombre<input name="name" required defaultValue={product.name} maxLength={191} /></label>
                  <label>Slug<input name="slug" required defaultValue={product.slug} maxLength={191} /></label>
                  <label>Categoría<input name="category" required defaultValue={product.category} maxLength={100} /></label>
                  <label>Precio CLP<input name="price" type="number" required min="0" step="1" defaultValue={product.price} /></label>
                  <label>Stock disponible<input value={formatQuantity(available, product.unit)} readOnly aria-readonly="true" /><small>Físico {formatQuantity(physical, product.unit)} · reservado {formatQuantity(reserved, product.unit)}</small></label>
                  <label>Unidad<select name="unit" defaultValue={product.unit}><option value="KG">Kilogramo (KG)</option><option value="UNIT">Unidad</option></select></label>
                </div>
                <label>Descripción<textarea name="description" required maxLength={5000} rows={3} defaultValue={product.description} /></label>
                <label className="admin-file">Reemplazar imagen <small>(opcional, máx. 5 MB)</small><input name="image" type="file" accept="image/webp,image/png,image/jpeg" /></label>
                <div className="admin-checks">
                  <label><input type="checkbox" name="active" defaultChecked={product.active} /> Activo</label>
                  <label><input type="checkbox" name="featured" defaultChecked={product.featured} /> Destacado</label>
                  {reserved > 0 && <span className="admin-reserved">Reservado: {formatQuantity(reserved, product.unit)}</span>}
                </div>
                <button className="admin-button admin-button-primary" type="submit">Guardar cambios</button>
              </form>
              <form action={deleteProduct} className="admin-delete-form">
                <input type="hidden" name="id" value={product.id} />
                <button className="admin-button admin-button-danger" type="submit">Eliminar / desactivar</button>
                <small>Si tiene historial de pedidos, se desactivará para conservar la trazabilidad.</small>
              </form>
            </article>
          );
        })}
      </section>
    </div>
  );
}
