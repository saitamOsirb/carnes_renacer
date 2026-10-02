"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceCheckerProduct } from "@/lib/price-checker-service";

type Props = {
  products: PriceCheckerProduct[];
  mode?: "public" | "admin";
};

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
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
  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const scannerBufferRef = useRef({ value: "", lastAt: 0 });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("TODAS");
  const [selectedId, setSelectedId] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("Lector listo. Escanea un código y termina con Enter.");

  const barcodeMap = useMemo(() => {
    const entries = products
      .filter((product) => product.barcode)
      .map((product) => [normalizeBarcode(product.barcode ?? ""), product] as const);
    return new Map(entries);
  }, [products]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    setCameraSupported(Boolean(window.BarcodeDetector && navigator.mediaDevices?.getUserMedia));
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const now = performance.now();
      const buffer = scannerBufferRef.current;

      if (event.key.length === 1) {
        if (now - buffer.lastAt > 120) buffer.value = "";
        buffer.value += event.key;
        buffer.lastAt = now;
        return;
      }

      if (event.key === "Enter") {
        const code = normalizeBarcode(buffer.value);
        const looksLikeScanner = code.length >= 4 && now - buffer.lastAt < 300;
        buffer.value = "";
        if (looksLikeScanner) {
          event.preventDefault();
          resolveBarcode(code, "lector");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => () => stopCamera(), []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))).sort((a, b) => a.localeCompare(b, "es")),
    [products],
  );

  const results = useMemo(() => {
    const needle = normalize(query);
    const barcodeNeedle = normalizeBarcode(query);
    return products
      .filter((product) => category === "TODAS" || product.category === category)
      .filter((product) => {
        if (!needle) return true;
        if (product.barcode && normalizeBarcode(product.barcode).includes(barcodeNeedle)) return true;
        return normalize(`${product.name} ${product.category}`).includes(needle);
      })
      .sort((left, right) => Number(right.stock > 0) - Number(left.stock > 0) || left.name.localeCompare(right.name, "es"));
  }, [products, query, category]);

  const selected = products.find((product) => product.id === selectedId) ?? null;

  function choose(product: PriceCheckerProduct): void {
    setSelectedId(product.id);
    setQuery(product.name);
  }

  function resolveBarcode(raw: string, source: "lector" | "cámara"): void {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const product = barcodeMap.get(code);
    if (product) {
      choose(product);
      setScanMessage(`${source === "cámara" ? "Cámara" : "Lector"}: ${code} · ${product.name}`);
      if (source === "cámara") stopCamera();
      return;
    }

    setSelectedId("");
    setQuery(code);
    setCategory("TODAS");
    setScanMessage(`Código ${code} no registrado. Asígnalo desde el mantenedor de productos.`);
    searchRef.current?.focus();
  }

  function stopCamera(): void {
    if (scanFrameRef.current !== null) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    detectBusyRef.current = false;
  }

  async function startCamera(): Promise<void> {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setScanMessage("Este navegador no soporta lectura de códigos con cámara. Puedes usar un lector USB/Bluetooth.");
      return;
    }

    try {
      stopCamera();
      setCameraOpen(true);
      setScanMessage("Abriendo cámara…");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      mediaStreamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("No se encontró el visor de cámara.");
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector();
      setScanMessage("Apunta la cámara al código de barras.");

      const scan = async () => {
        if (!mediaStreamRef.current || !videoRef.current) return;
        if (video.readyState >= 2 && !detectBusyRef.current) {
          detectBusyRef.current = true;
          try {
            const detected = await detector.detect(video);
            const code = detected.find((item) => item.rawValue)?.rawValue;
            if (code) {
              resolveBarcode(code, "cámara");
              return;
            }
          } catch {
            // Algunos navegadores pueden fallar temporalmente entre frames.
          } finally {
            detectBusyRef.current = false;
          }
        }
        scanFrameRef.current = requestAnimationFrame(scan);
      };
      scanFrameRef.current = requestAnimationFrame(scan);
    } catch (error) {
      stopCamera();
      setScanMessage(error instanceof Error ? `No fue posible usar la cámara: ${error.message}` : "No fue posible usar la cámara.");
    }
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
          <p>Busca, escanea con lector o usa la cámara para conocer el precio vigente.</p>
        </div>
        <button type="button" className="price-checker-fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        </button>
      </header>

      <section className="price-checker-scanner-panel" aria-label="Escáner de códigos">
        <div className="price-checker-scanner-status">
          <span className="price-checker-scanner-icon" aria-hidden="true">▥</span>
          <div>
            <strong>Escáner de código de barras</strong>
            <small>{scanMessage}</small>
          </div>
        </div>
        <div className="price-checker-scanner-actions">
          {cameraSupported && !cameraOpen && <button type="button" onClick={startCamera}>Escanear con cámara</button>}
          {cameraOpen && <button type="button" className="is-stop" onClick={stopCamera}>Cerrar cámara</button>}
        </div>
        <div className={`price-checker-camera${cameraOpen ? " is-open" : ""}`}>
          <video ref={videoRef} muted playsInline aria-label="Vista de cámara para escanear código" />
          {cameraOpen && <div className="price-checker-camera-frame" aria-hidden="true" />}
        </div>
      </section>

      <section className="price-checker-search-panel">
        <label htmlFor="price-checker-search">Buscar producto o código</label>
        <div className="price-checker-search-row">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
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
            placeholder="Ej: lomo vetado, pollo o 7801234567890"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="price-checker-clear"
              onClick={() => {
                setQuery("");
                setSelectedId("");
                setScanMessage("Lector listo. Escanea un código y termina con Enter.");
                searchRef.current?.focus();
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
                  {mode === "admin" && product.barcode && <code>{product.barcode}</code>}
                  <em className={product.stock > 0 ? "is-available" : "is-out"}>{product.stock > 0 ? "Disponible" : "Agotado"}</em>
                </span>
              </button>
            ))}
          </div>

          {results.length === 0 && (
            <div className="price-checker-empty">
              <strong>No encontramos productos</strong>
              <span>Prueba con otro nombre, categoría o revisa que el código esté asignado.</span>
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
              {mode === "admin" && selected.barcode && <span className="price-checker-detail-barcode">Código: {selected.barcode}</span>}
              <span className={`price-checker-status${selected.stock > 0 ? " is-available" : " is-out"}`}>
                {selected.stock > 0 ? "Disponible para compra" : "Producto agotado"}
              </span>
              <button
                type="button"
                className="price-checker-another"
                onClick={() => {
                  setSelectedId("");
                  setQuery("");
                  setScanMessage("Lector listo. Escanea un código y termina con Enter.");
                  searchRef.current?.focus();
                }}
              >
                Consultar otro producto
              </button>
            </>
          ) : (
            <div className="price-checker-detail-placeholder">
              <span aria-hidden="true">▥</span>
              <strong>Escanea o selecciona un producto</strong>
              <small>El precio aparecerá aquí en formato grande.</small>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
