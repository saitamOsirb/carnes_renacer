"use client";

import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product-card";
import type { StoreProduct } from "@/components/cart-context";

export function ProductCatalog({ products, categories, initialCategory }: { products: StoreProduct[]; categories: string[]; initialCategory?: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(initialCategory ? [initialCategory] : []);
  const [sort, setSort] = useState("featured");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-CL");
    const result = products.filter((product) => {
      const matchesQuery = !normalized || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("es-CL").includes(normalized);
      const matchesCategory = selected.length === 0 || selected.includes(product.category);
      return matchesQuery && matchesCategory;
    });
    return [...result].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "price-desc") return b.price - a.price;
      if (sort === "name") return a.name.localeCompare(b.name, "es");
      return Number(b.featured) - Number(a.featured);
    });
  }, [products, query, selected, sort]);

  function toggle(category: string) {
    setSelected((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  return (
    <section className="catalog-section container">
      <aside className="catalog-filters">
        <div className="filter-title"><strong>Filtrar productos</strong><span>☷</span></div>
        <h3>Categorías</h3>
        {categories.map((category) => (
          <label className="check-row" key={category}>
            <input type="checkbox" checked={selected.includes(category)} onChange={() => toggle(category)} />
            <span>{category}</span>
            <small>{products.filter((product) => product.category === category).length}</small>
          </label>
        ))}
        <h3>Disponibilidad</h3>
        <div className="check-row"><input type="checkbox" checked readOnly /><span>En stock</span></div>
        <button type="button" className="button button-primary full" onClick={() => { setSelected([]); setQuery(""); }}>Limpiar filtros</button>
      </aside>
      <div className="catalog-main">
        <div className="catalog-toolbar">
          <span>Mostrando {filtered.length} de {products.length} productos</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar productos…" aria-label="Buscar productos" />
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar productos">
            <option value="featured">Más vendidos</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option><option value="name">Nombre</option>
          </select>
        </div>
        <div className="product-grid">{filtered.map((product) => <ProductCard product={product} key={product.id} />)}</div>
        {filtered.length === 0 && <div className="empty-state"><h2>No encontramos productos</h2><p>Prueba con otra categoría o término de búsqueda.</p></div>}
      </div>
    </section>
  );
}
