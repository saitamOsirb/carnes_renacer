import { expireOldReservations } from "@/lib/order-service";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const expired = await expireOldReservations();
  return Response.json({ ok: true, expired });
}
