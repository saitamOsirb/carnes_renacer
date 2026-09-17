import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertCsrf, assertJsonRequest, assertTrustedOrigin, enforceRateLimit, errorResponse, getClientIp, hashIdentifier, HttpError } from "@/lib/security";

const contactSchema = z.object({
  name: z.string().trim().min(3).max(120),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().max(18).optional().or(z.literal("")),
  subject: z.enum(["Cotización", "Despacho", "Productos", "Otro"]),
  message: z.string().trim().min(10).max(1000),
});

export async function POST(request: Request) {
  try {
    assertJsonRequest(request);
    assertTrustedOrigin(request);
    assertCsrf(request);
    const ip = getClientIp(request);
    await enforceRateLimit(`contact:${hashIdentifier(ip)}`, 5, 30 * 60_000);
    const parsed = contactSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Datos inválidos.", "VALIDATION_ERROR");
    await prisma.contactMessage.create({
      data: { ...parsed.data, company: parsed.data.company || null, phone: parsed.data.phone || null, ipHash: hashIdentifier(ip) },
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
