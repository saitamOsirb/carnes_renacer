import "server-only";

import { Prisma, WarehouseLocationMovementType } from "@prisma/client";

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
  return aggregate._sum.quantity ?? 0;
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

  let located = placements.reduce((sum, placement) => sum + placement.quantity, 0);
  let excess = Math.max(0, located - Math.max(0, physicalOnHand));
  if (excess <= 0) return;

  for (const placement of placements) {
    if (excess <= 0) break;
    const quantity = Math.min(excess, placement.quantity);
    const remaining = placement.quantity - quantity;

    if (remaining === 0) {
      await tx.warehouseProductPlacement.delete({ where: { id: placement.id } });
    } else {
      await tx.warehouseProductPlacement.update({
        where: { id: placement.id },
        data: { quantity: remaining },
      });
    }

    located -= quantity;
    excess -= quantity;

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
