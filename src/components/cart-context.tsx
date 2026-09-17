"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { catalogProducts } from "@/data/catalog";

export type StoreProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  price: number;
  unit: "KG" | "UNIT";
  stock: number;
  featured: boolean;
};

export type CartItem = { product: StoreProduct; quantity: number };

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hydrated: boolean;
  addItem: (product: StoreProduct, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
};

type PersistedCart = {
  version: 2;
  items: Array<{ productId: string; quantity: number }>;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "renacer_cart_v2";
const LEGACY_STORAGE_KEY = "renacer_cart_v1";
const MAX_LINES = 30;
const MAX_QUANTITY_PER_LINE = 25;

const canonicalProducts: StoreProduct[] = catalogProducts.map((product) => ({
  id: product.slug,
  ...product,
}));
const productById = new Map(canonicalProducts.map((product) => [product.id, product]));

function clampQuantity(product: StoreProduct, value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Math.floor(numeric), MAX_QUANTITY_PER_LINE, product.stock));
}

function hydrateItems(value: unknown): CartItem[] {
  const rawItems = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Partial<PersistedCart>).items)
      ? (value as PersistedCart).items
      : [];

  const quantities = new Map<string, number>();

  for (const entry of rawItems.slice(0, MAX_LINES * 2)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      productId?: unknown;
      quantity?: unknown;
      product?: { id?: unknown; slug?: unknown };
    };
    const productId = typeof candidate.productId === "string"
      ? candidate.productId
      : typeof candidate.product?.id === "string"
        ? candidate.product.id
        : typeof candidate.product?.slug === "string"
          ? candidate.product.slug
          : "";
    const product = productById.get(productId);
    if (!product || product.stock <= 0) continue;

    const quantity = clampQuantity(product, candidate.quantity);
    if (quantity <= 0) continue;
    quantities.set(product.id, clampQuantity(product, (quantities.get(product.id) ?? 0) + quantity));
  }

  return Array.from(quantities.entries())
    .slice(0, MAX_LINES)
    .map(([productId, quantity]) => ({ product: productById.get(productId)!, quantity }));
}

function readStoredCart(): CartItem[] {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) return hydrateItems(JSON.parse(current));

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return hydrateItems(JSON.parse(legacy));
  } catch {
    // Un carrito corrupto o un navegador sin almacenamiento no debe romper la tienda.
  }
  return [];
}

function persistCart(items: CartItem[]) {
  const payload: PersistedCart = {
    version: 2,
    items: items.map(({ product, quantity }) => ({ productId: product.id, quantity })),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // La navegación y el carrito en memoria siguen funcionando aunque el storage esté bloqueado.
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persistCart(items);
  }, [items, hydrated]);

  useEffect(() => {
    function syncAcrossTabs(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      if (!event.newValue) {
        setItems([]);
        return;
      }
      try {
        setItems(hydrateItems(JSON.parse(event.newValue)));
      } catch {
        setItems([]);
      }
    }

    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, []);

  const addItem = useCallback((incomingProduct: StoreProduct, requestedQuantity = 1) => {
    const product = productById.get(incomingProduct.id) ?? productById.get(incomingProduct.slug);
    if (!product || product.stock <= 0) return;

    setItems((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      const increment = Math.max(1, clampQuantity(product, requestedQuantity));

      if (!existing) {
        if (current.length >= MAX_LINES) return current;
        return [...current, { product, quantity: increment }];
      }

      return current.map((item) => item.product.id === product.id
        ? { ...item, product, quantity: clampQuantity(product, item.quantity + increment) }
        : item);
    });
  }, []);

  const updateQuantity = useCallback((productId: string, requestedQuantity: number) => {
    setItems((current) => current.flatMap((item) => {
      if (item.product.id !== productId) return [item];
      const product = productById.get(productId);
      if (!product) return [];
      const quantity = clampQuantity(product, requestedQuantity);
      return quantity > 0 ? [{ product, quantity }] : [];
    }));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((current) => current.filter((item) => item.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => ({
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    hydrated,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
  }), [items, hydrated, addItem, updateQuantity, removeItem, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart debe usarse dentro de CartProvider");
  return context;
}
