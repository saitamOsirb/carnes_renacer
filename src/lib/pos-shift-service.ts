import "server-only";

import { PosCashMovementType, PosPaymentMethod, Prisma } from "@prisma/client";

type PosTx = Prisma.TransactionClient;

export type ShiftCashSummary = {
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
};

export async function calculateShiftCash(tx: PosTx, shiftId: string, openingAmount: number): Promise<ShiftCashSummary> {
  const [sales, movements] = await Promise.all([
    tx.posSale.aggregate({
      where: { shiftId, paymentMethod: PosPaymentMethod.CASH },
      _sum: { total: true },
    }),
    tx.posCashMovement.groupBy({
      by: ["type"],
      where: { shiftId },
      _sum: { amount: true },
    }),
  ]);

  const cashSales = sales._sum.total ?? 0;
  const cashIn = movements
    .filter((movement) => movement.type === PosCashMovementType.CASH_IN)
    .reduce((sum, movement) => sum + (movement._sum.amount ?? 0), 0);
  const cashOut = movements
    .filter((movement) => movement.type === PosCashMovementType.CASH_OUT)
    .reduce((sum, movement) => sum + (movement._sum.amount ?? 0), 0);

  return {
    cashSales,
    cashIn,
    cashOut,
    expectedCash: openingAmount + cashSales + cashIn - cashOut,
  };
}
