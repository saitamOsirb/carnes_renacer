import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const image = await prisma.productImage.findUnique({
    where: { id },
    select: { data: true, mimeType: true, byteSize: true },
  });

  if (!image) return new Response("Not found", { status: 404 });

  return new Response(image.data, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.byteSize),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
