-- Product.stock representa stock físico global de bodegas activas.
-- Product.reserved representa la reserva global. InventoryStock es la fuente de verdad.
UPDATE `Product` p
LEFT JOIN (
  SELECT
    s.`productId`,
    COALESCE(SUM(s.`onHand`), 0) AS `physicalStock`,
    COALESCE(SUM(s.`reserved`), 0) AS `reservedStock`
  FROM `InventoryStock` s
  INNER JOIN `Warehouse` w ON w.`id` = s.`warehouseId`
  WHERE w.`active` = TRUE
  GROUP BY s.`productId`
) totals ON totals.`productId` = p.`id`
SET
  p.`stock` = COALESCE(totals.`physicalStock`, 0.000),
  p.`reserved` = COALESCE(totals.`reservedStock`, 0.000);
