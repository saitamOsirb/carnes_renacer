import "server-only";

import { Prisma, WarehouseLocationMovementType } from "@prisma/client";
import { roundQuantity, toQuantityNumber } from "@/lib/quantity";

type InventoryTx = Prisma.TransactionClient;

type ReconcileContext = {
  reference?: string | null;
  note?: string | null;
  actor?: string;
};

function locationCode(value: string): string | null {
  return value ? value : null;
}

export async function getLocatedWarehouseQuantity(
  tx: InventoryTx,
  warehouseId: string,
  productId: string,
): Promise<number> {
  const aggregate = await tx.warehouseProductPlacement.aggregate({
    where: { warehouseId, productId },
    _sum: { quantity: true },
  });
  return roundQuantity(toQuantityNumber(aggregate._sum.quantity));
}

export async function reconcileWarehouseLocationStock(
  tx: InventoryTx,
  warehouseId: string,
  productId: string,
  physicalOnHand: number,
  context: ReconcileContext = {},
): Promise<void> {
  const placements = await tx.warehouseProductPlacement.findMany({
    where: { warehouseId, productId, quantity: { gt: 0 } },
    include: { object: { select: { id: true, label: true } } },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
  });

  let located = roundQuantity(placements.reduce((sum, placement) => sum + toQuantityNumber(placement.quantity), 0));
  let excess = roundQuantity(Math.max(0, located - Math.max(0, physicalOnHand)));
  if (excess <= 0) return;

  for (const placement of placements) {
    if (excess <= 0) break;
    const placementQuantity = toQuantityNumber(placement.quantity);
    const quantity = roundQuantity(Math.min(excess, placementQuantity));
    const remaining = roundQuantity(placementQuantity - quantity);

    if (remaining <= 0) {
      await tx.warehouseProductPlacement.delete({ where: { id: placement.id } });
    } else {
      await tx.warehouseProductPlacement.update({
        where: { id: placement.id },
        data: { quantity: remaining },
      });
    }

    located = roundQuantity(located - quantity);
    excess = roundQuantity(excess - quantity);

    await tx.warehouseLocationMovement.create({
      data: {
        warehouseId,
        productId,
        type: WarehouseLocationMovementType.SYSTEM_DECREMENT,
        quantity: -quantity,
        locatedAfter: located,
        fromObjectId: placement.objectId,
        fromObjectLabel: placement.object.label,
        fromLocationCode: locationCode(placement.locationCode),
        reference: context.reference ?? null,
        note: context.note ?? "Reconciliación automática por disminución del stock físico",
        actor: (context.actor ?? "system").slice(0, 80),
      },
    });
  }
}
