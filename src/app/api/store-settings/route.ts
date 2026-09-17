import { getCheckoutWhatsappNumber } from "@/lib/store-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const whatsapp = await getCheckoutWhatsappNumber();

  return Response.json(
    { whatsapp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
