import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { createProduct, deleteProduct, updateProduct } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [products, query] = await Promise.all([
    prisma.product.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    searchParams,
  ]);

  return (
    <div className="admin-content">
      <div className="admin-title-row">
        <div><span className="admin-kicker">Catálogo</span><h1>Mantenedor de productos</h1><p>Los cambios se reflejan en la tienda pública y en el carrito.</p></div>
        <div className="admin-stat"><strong>{products.length}</strong><span>productos</span></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading"><div><h2>Nuevo producto</h2><p>WebP, PNG o JPEG. Máximo 5 MB.</p></div></div>
        <form action={createProduct} className="admin-product-form">
          <div className="admin-grid admin-grid-3">
            <label>Nombre<input name="name" required minLength={2} maxLength={191} /></label>
            <label>Slug <small>(opcional)</small><input name="slug" maxLength={191} placeholder="se genera desde el nombre" /></label>
            <label>Categoría<input name="category" required maxLength={100} placeholder="Vacuno, Cerdo, Pollo…" /></label>
            <label>Precio CLP<input name="price" type="number" required min="0" step="1" /></label>
            <label>Stock<input name="stock" type="number" required min="0" step="1" /></label>
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
      </section>

      <section className="admin-products-list">
        {products.map((product) => (
          <article className={`admin-product-card${product.active ? "" : " is-inactive"}`} key={product.id}>
            <div className="admin-product-preview">
              <Image src={product.imageUrl} alt={product.name} width={180} height={138} sizes="180px" />
              <div><strong>{product.name}</strong><span>{product.active ? "Activo" : "Inactivo"}</span><small>ID: {product.id}</small></div>
            </div>
            <form action={updateProduct} className="admin-product-form">
              <input type="hidden" name="id" value={product.id} />
              <div className="admin-grid admin-grid-3">
                <label>Nombre<input name="name" required defaultValue={product.name} maxLength={191} /></label>
                <label>Slug<input name="slug" required defaultValue={product.slug} maxLength={191} /></label>
                <label>Categoría<input name="category" required defaultValue={product.category} maxLength={100} /></label>
                <label>Precio CLP<input name="price" type="number" required min="0" step="1" defaultValue={product.price} /></label>
                <label>Stock<input name="stock" type="number" required min="0" step="1" defaultValue={product.stock} /></label>
                <label>Unidad<select name="unit" defaultValue={product.unit}><option value="KG">Kilogramo (KG)</option><option value="UNIT">Unidad</option></select></label>
              </div>
              <label>Descripción<textarea name="description" required maxLength={5000} rows={3} defaultValue={product.description} /></label>
              <label className="admin-file">Reemplazar imagen <small>(opcional, máx. 5 MB)</small><input name="image" type="file" accept="image/webp,image/png,image/jpeg" /></label>
              <div className="admin-checks">
                <label><input type="checkbox" name="active" defaultChecked={product.active} /> Activo</label>
                <label><input type="checkbox" name="featured" defaultChecked={product.featured} /> Destacado</label>
                {product.reserved > 0 && <span className="admin-reserved">Reservado: {product.reserved}</span>}
              </div>
              <button className="admin-button admin-button-primary" type="submit">Guardar cambios</button>
            </form>
            <form action={deleteProduct} className="admin-delete-form">
              <input type="hidden" name="id" value={product.id} />
              <button className="admin-button admin-button-danger" type="submit">Eliminar / desactivar</button>
              <small>Si tiene historial de pedidos, se desactivará para conservar la trazabilidad.</small>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
