"use server";

import { InventoryMovementType, UnitType } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearAdminSession, createAdminSession, requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isValidQuantityForUnit, roundQuantity, toQuantityNumber } from "@/lib/quantity";
import { setCheckoutWhatsappNumber } from "@/lib/store-settings";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function text(formData: FormData, key: string, max = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(formData: FormData, key: string, min = 0, max = 100_000_000): number | null {
  const value = Number(text(formData, key, 30));
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function decimalQuantity(formData: FormData, key: string, min = 0, max = 1_000_000): number | null {
  const raw = text(formData, key, 30).replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  const rounded = roundQuantity(value);
  if (!Number.isFinite(value) || Math.abs(value - rounded) > 1e-9 || rounded < min || rounded > max) return null;
  return rounded;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function statusUrl(path: string, type: "ok" | "error", message: string): string {
  return `${path}?${type}=${encodeURIComponent(message)}`;
}

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("hex") === "52494646" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
}

async function saveUploadedImage(formData: FormData): Promise<string | null> {
  const value = formData.get("image");
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_IMAGE_BYTES) throw new Error("La imagen supera el máximo de 5 MB.");

  const buffer = Buffer.from(await value.arrayBuffer());
  const mimeType = detectImageMime(buffer);
  if (!mimeType) throw new Error("La imagen debe ser WebP, PNG o JPEG.");

  const image = await prisma.productImage.create({
    data: { mimeType, byteSize: buffer.length, data: buffer },
    select: { id: true },
  });
  return `/api/product-images/${image.id}`;
}

function uploadedImageId(imageUrl: string): string | null {
  return imageUrl.match(/^\/api\/product-images\/([a-zA-Z0-9_-]+)$/)?.[1] ?? null;
}

async function cleanupImage(imageUrl: string): Promise<void> {
  const id = uploadedImageId(imageUrl);
  if (!id) return;
  await prisma.productImage.delete({ where: { id } }).catch(() => undefined);
}

async function uniqueSlug(candidate: string, excludeId?: string): Promise<string> {
  const base = slugify(candidate) || "producto";
  let value = base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const found = await prisma.product.findUnique({ where: { slug: value }, select: { id: true } });
    if (!found || found.id === excludeId) return value;
    value = `${base.slice(0, 175)}-${suffix}`;
  }
  throw new Error("No fue posible generar un slug único.");
}

function revalidateCatalog(slug?: string): void {
  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/carrito");
  revalidatePath("/checkout");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/inventario/mapa");
  revalidatePath("/admin/consulta-precio");
  revalidatePath("/consulta-precio");
  if (slug) revalidatePath(`/productos/${slug}`);
}

async function productUnitCanChange(productId: string): Promise<boolean> {
  const [movement, stock, placement] = await Promise.all([
    prisma.inventoryMovement.findFirst({ where: { productId }, select: { id: true } }),
    prisma.inventoryStock.findFirst({
      where: {
        productId,
        OR: [
          { onHand: { not: 0 } },
          { reserved: { not: 0 } },
          { minStock: { not: 0 } },
        ],
      },
      select: { id: true },
    }),
    prisma.warehouseProductPlacement.findFirst({ where: { productId }, select: { id: true } }),
  ]);
  return !movement && !stock && !placement;
}

export async function loginAdmin(formData: FormData): Promise<void> {
  const username = text(formData, "username", 80);
  const password = text(formData, "password", 500);
  if (!username || !password || !(await createAdminSession(username, password))) {
    redirect(statusUrl("/admin/login", "error", "Usuario o contraseña incorrectos."));
  }
  redirect("/admin/productos");
}

export async function logoutAdmin(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}

export async function createProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = text(formData, "name", 191);
  const description = text(formData, "description", 5000);
  const category = text(formData, "category", 100);
  const price = integer(formData, "price", 0);
  const unit = text(formData, "unit", 10) === "UNIT" ? UnitType.UNIT : UnitType.KG;
  const initialStock = decimalQuantity(formData, "stock", 0, 1_000_000);

  if (
    name.length < 2
    || description.length < 3
    || category.length < 2
    || price === null
    || initialStock === null
    || !isValidQuantityForUnit(initialStock, unit, { allowZero: true, max: 1_000_000 })
  ) {
    redirect(statusUrl(
      "/admin/productos",
      "error",
      unit === UnitType.KG
        ? "Completa los datos correctamente. El stock en kg admite hasta tres decimales."
        : "Completa los datos correctamente. El stock por unidad debe ser un número entero.",
    ));
  }

  let imageUrl: string | null = null;
  try {
    imageUrl = await saveUploadedImage(formData);
  } catch (error) {
    redirect(statusUrl("/admin/productos", "error", error instanceof Error ? error.message : "Imagen inválida."));
  }
  if (!imageUrl) redirect(statusUrl("/admin/productos", "error", "Debes subir una imagen para el producto."));

  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!defaultWarehouse) {
    await cleanupImage(imageUrl);
    redirect(statusUrl("/admin/productos", "error", "No existe una bodega activa para asignar el stock inicial."));
  }

  const slug = await uniqueSlug(text(formData, "slug", 191) || name);
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          slug,
          name,
          description,
          category,
          imageUrl,
          price,
          stock: initialStock,
          unit,
          active: formData.get("active") === "on",
          featured: formData.get("featured") === "on",
        },
      });
      await tx.inventoryStock.create({
        data: {
          warehouseId: defaultWarehouse.id,
          productId: product.id,
          onHand: initialStock,
          reserved: 0,
          minStock: 0,
        },
      });
      if (initialStock > 0) {
        await tx.inventoryMovement.create({
          data: {
            warehouseId: defaultWarehouse.id,
            productId: product.id,
            type: InventoryMovementType.OPENING,
            quantity: initialStock,
            onHandAfter: initialStock,
            reservedAfter: 0,
            note: "Stock inicial al crear producto",
            reference: "product-create",
          },
        });
      }
    });
  } catch (error) {
    await cleanupImage(imageUrl);
    throw error;
  }

  revalidateCatalog(slug);
  redirect(statusUrl("/admin/productos", "ok", "Producto creado correctamente. El stock inicial quedó asignado a la bodega principal."));
}

export async function updateProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) redirect(statusUrl("/admin/productos", "error", "Producto no encontrado."));

  const name = text(formData, "name", 191);
  const description = text(formData, "description", 5000);
  const category = text(formData, "category", 100);
  const price = integer(formData, "price", 0);
  const targetUnit = text(formData, "unit", 10) === "UNIT" ? UnitType.UNIT : UnitType.KG;
  if (name.length < 2 || description.length < 3 || category.length < 2 || price === null) {
    redirect(statusUrl("/admin/productos", "error", "Los datos del producto son inválidos."));
  }

  if (targetUnit !== current.unit && !(await productUnitCanChange(id))) {
    redirect(statusUrl(
      "/admin/productos",
      "error",
      `No se puede cambiar ${current.unit === UnitType.KG ? "kg" : "unidad"} a ${targetUnit === UnitType.KG ? "kg" : "unidad"} porque el producto ya tiene inventario o historial de movimientos. Crea un producto nuevo para conservar la trazabilidad.`,
    ));
  }

  let replacement: string | null = null;
  try {
    replacement = await saveUploadedImage(formData);
  } catch (error) {
    redirect(statusUrl("/admin/productos", "error", error instanceof Error ? error.message : "Imagen inválida."));
  }

  const slug = await uniqueSlug(text(formData, "slug", 191) || name, id);
  let updated;
  try {
    updated = await prisma.product.update({
      where: { id },
      data: {
        slug,
        name,
        description,
        category,
        price,
        unit: targetUnit,
        active: formData.get("active") === "on",
        featured: formData.get("featured") === "on",
        ...(replacement ? { imageUrl: replacement } : {}),
      },
    });
  } catch (error) {
    if (replacement) await cleanupImage(replacement);
    throw error;
  }

  if (replacement && current.imageUrl !== updated.imageUrl) await cleanupImage(current.imageUrl);
  revalidateCatalog(current.slug);
  if (updated.slug !== current.slug) revalidateCatalog(updated.slug);
  redirect(statusUrl("/admin/productos", "ok", `Producto ${updated.name} actualizado. El stock se administra desde Inventario.`));
}

export async function deleteProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) redirect(statusUrl("/admin/productos", "error", "Producto no encontrado."));

  await prisma.product.update({ where: { id }, data: { active: false, featured: false } });
  revalidateCatalog(product.slug);
  redirect(statusUrl("/admin/productos", "ok", `Producto ${product.name} desactivado. Su historial e inventario se conservan.`));
}

export async function updateCheckoutWhatsapp(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = text(formData, "whatsapp", 40);
  let normalized: string;
  try {
    normalized = await setCheckoutWhatsappNumber(raw);
  } catch (error) {
    redirect(statusUrl("/admin/configuracion", "error", error instanceof Error ? error.message : "Número inválido."));
  }

  revalidatePath("/checkout");
  redirect(statusUrl("/admin/configuracion", "ok", `WhatsApp actualizado a +${normalized}.`));
}
