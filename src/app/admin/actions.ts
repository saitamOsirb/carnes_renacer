"use server";

import { UnitType } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearAdminSession, createAdminSession, requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
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

export async function loginAdmin(formData: FormData): Promise<void> {
  const password = text(formData, "password", 500);
  if (!password || !(await createAdminSession(password))) {
    redirect(statusUrl("/admin/login", "error", "Contraseña incorrecta."));
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
  const stock = integer(formData, "stock", 0, 1_000_000);
  const unit = text(formData, "unit", 10) === "UNIT" ? UnitType.UNIT : UnitType.KG;

  if (name.length < 2 || description.length < 3 || category.length < 2 || price === null || stock === null) {
    redirect(statusUrl("/admin/productos", "error", "Completa correctamente nombre, descripción, categoría, precio y stock."));
  }

  let imageUrl: string | null = null;
  try {
    imageUrl = await saveUploadedImage(formData);
  } catch (error) {
    redirect(statusUrl("/admin/productos", "error", error instanceof Error ? error.message : "Imagen inválida."));
  }
  if (!imageUrl) redirect(statusUrl("/admin/productos", "error", "Debes subir una imagen para el producto."));

  const slug = await uniqueSlug(text(formData, "slug", 191) || name);
  await prisma.product.create({
    data: {
      slug,
      name,
      description,
      category,
      imageUrl,
      price,
      stock,
      unit,
      active: formData.get("active") === "on",
      featured: formData.get("featured") === "on",
    },
  });

  revalidatePath("/");
  revalidatePath("/productos");
  redirect(statusUrl("/admin/productos", "ok", "Producto creado correctamente."));
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
  const stock = integer(formData, "stock", 0, 1_000_000);
  if (name.length < 2 || description.length < 3 || category.length < 2 || price === null || stock === null) {
    redirect(statusUrl("/admin/productos", "error", "Los datos del producto son inválidos."));
  }
  if (stock < current.reserved) {
    redirect(statusUrl("/admin/productos", "error", `El stock no puede ser menor que las ${current.reserved} unidades reservadas.`));
  }

  let replacement: string | null = null;
  try {
    replacement = await saveUploadedImage(formData);
  } catch (error) {
    redirect(statusUrl("/admin/productos", "error", error instanceof Error ? error.message : "Imagen inválida."));
  }

  const slug = await uniqueSlug(text(formData, "slug", 191) || name, id);
  const updated = await prisma.product.update({
    where: { id },
    data: {
      slug,
      name,
      description,
      category,
      price,
      stock,
      unit: text(formData, "unit", 10) === "UNIT" ? UnitType.UNIT : UnitType.KG,
      active: formData.get("active") === "on",
      featured: formData.get("featured") === "on",
      ...(replacement ? { imageUrl: replacement } : {}),
    },
  });

  if (replacement && current.imageUrl !== updated.imageUrl) await cleanupImage(current.imageUrl);
  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath(`/productos/${updated.slug}`);
  redirect(statusUrl("/admin/productos", "ok", `Producto ${updated.name} actualizado.`));
}

export async function deleteProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, "id", 30);
  const product = await prisma.product.findUnique({
    where: { id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!product) redirect(statusUrl("/admin/productos", "error", "Producto no encontrado."));

  if (product._count.orderItems > 0) {
    await prisma.product.update({ where: { id }, data: { active: false, featured: false } });
    revalidatePath("/");
    revalidatePath("/productos");
    redirect(statusUrl("/admin/productos", "ok", "El producto tiene historial de pedidos y fue desactivado en vez de eliminarse."));
  }

  await prisma.product.delete({ where: { id } });
  await cleanupImage(product.imageUrl);
  revalidatePath("/");
  revalidatePath("/productos");
  redirect(statusUrl("/admin/productos", "ok", "Producto eliminado."));
}

export async function updateCheckoutWhatsapp(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = text(formData, "whatsapp", 40);
  try {
    const normalized = await setCheckoutWhatsappNumber(raw);
    revalidatePath("/checkout");
    redirect(statusUrl("/admin/configuracion", "ok", `WhatsApp actualizado a +${normalized}.`));
  } catch (error) {
    redirect(statusUrl("/admin/configuracion", "error", error instanceof Error ? error.message : "Número inválido."));
  }
}
