"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceCheckerProduct } from "@/lib/price-checker-service";

type Props = {
  products: PriceCheckerProduct[];
  mode?: "public" | "admin";
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function priceLabel(product: PriceCheckerProduct): string {
  const amount = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(product.price);
  return `${amount} / ${product.unit === "KG" ? "kg" : "unidad"}`;
}

export function PriceChecker({ products, mode = "public" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("TODAS");
  const [selectedId, setSelectedId] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))).sort((a, b) => a.localeCompare(b, "es")),
    [products],
  );

  const results = useMemo(() => {
    const needle = normalize(query);
    return products
      .filter((product) => category === "TODAS" || product.category === category)
      .filter((product) => !needle || normalize(`${product.name} ${product.category}`).includes(needle))
      .sort((left, right) => Number(right.stock > 0) - Number(left.stock > 0) || left.name.localeCompare(right.name, "es"));
  }, [products, query, category]);

  const selected = products.find((product) => product.id === selectedId) ?? null;

  function choose(product: PriceCheckerProduct): void {
    setSelectedId(product.id);
    setQuery(product.name);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
    } catch {
      // El navegador puede bloquear fullscreen si no existe interacción válida.
    }
  }

  return (
    <div ref={rootRef} className={`price-checker${mode === "admin" ? " is-admin" : " is-public"}`}>
      <header className="price-checker-hero">
        <div>
          <span className="price-checker-kicker">Renacer Distribuidora</span>
          <h1>Consulta de precio</h1>
          <p>Busca un producto para conocer su precio vigente.</p>
        </div>
        <button type="button" className="price-checker-fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        </button>
      </header>

      <section className="price-checker-search-panel">
        <label htmlFor="price-checker-search">Buscar producto</label>
        <div className="price-checker-search-row">
          <span aria-hidden="true">⌕</span>
          <input
            id="price-checker-search"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) choose(results[0]);
            }}
            placeholder="Ej: lomo vetado, pollo, costillar…"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="price-checker-clear"
              onClick={() => {
                setQuery("");
                setSelectedId("");
              }}
            >
              Limpiar
            </button>
          )}
        </div>

        <div className="price-checker-categories" aria-label="Categorías">
          <button type="button" className={category === "TODAS" ? "is-active" : ""} onClick={() => setCategory("TODAS")}>Todos</button>
          {categories.map((item) => (
            <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>
      </section>

      <div className="price-checker-layout">
        <section className="price-checker-results" aria-label="Resultados de búsqueda">
          <div className="price-checker-results-heading">
            <strong>{results.length} producto{results.length === 1 ? "" : "s"}</strong>
            <span>Toca un producto para ver su precio</span>
          </div>

          <div className="price-checker-grid">
            {results.map((product) => (
              <button
                type="button"
                key={product.id}
                className={`price-checker-card${selected?.id === product.id ? " is-selected" : ""}`}
                onClick={() => choose(product)}
              >
                <span className="price-checker-card-image">
                  <Image src={product.imageUrl} alt={product.name} fill sizes="180px" />
                </span>
                <span className="price-checker-card-body">
                  <small>{product.category}</small>
                  <strong>{product.name}</strong>
                  <b>{priceLabel(product)}</b>
                  <em className={product.stock > 0 ? "is-available" : "is-out"}>{product.stock > 0 ? "Disponible" : "Agotado"}</em>
                </span>
              </button>
            ))}
          </div>

          {results.length === 0 && (
            <div className="price-checker-empty">
              <strong>No encontramos productos</strong>
              <span>Prueba con otro nombre o selecciona otra categoría.</span>
            </div>
          )}
        </section>

        <aside className={`price-checker-detail${selected ? " has-product" : ""}`}>
          {selected ? (
            <>
              <div className="price-checker-detail-image">
                <Image src={selected.imageUrl} alt={selected.name} fill sizes="(max-width: 800px) 80vw, 420px" priority />
              </div>
              <span className="price-checker-detail-category">{selected.category}</span>
              <h2>{selected.name}</h2>
              <span className="price-checker-detail-caption">Precio vigente</span>
              <strong className="price-checker-detail-price">{priceLabel(selected)}</strong>
              <span className={`price-checker-status${selected.stock > 0 ? " is-available" : " is-out"}`}>
                {selected.stock > 0 ? "Disponible para compra" : "Producto agotado"}
              </span>
              <button
                type="button"
                className="price-checker-another"
                onClick={() => {
                  setSelectedId("");
                  setQuery("");
                }}
              >
                Consultar otro producto
              </button>
            </>
          ) : (
            <div className="price-checker-detail-placeholder">
              <span aria-hidden="true">$</span>
              <strong>Selecciona un producto</strong>
              <small>El precio aparecerá aquí en formato grande.</small>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
