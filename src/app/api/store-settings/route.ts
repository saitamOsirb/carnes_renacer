import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_WHATSAPP = "56991851942";
const WHATSAPP_KEY = "payment_whatsapp";

export async function GET() {
  const setting = await prisma.storeSetting.findUnique({
    where: { key: WHATSAPP_KEY },
    select: { value: true },
  });

  const whatsapp = (setting?.value ?? DEFAULT_WHATSAPP).replace(/\D/g, "");

  return Response.json(
    { whatsapp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
