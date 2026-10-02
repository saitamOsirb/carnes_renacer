-- Cantidades comerciales con precisión de 1 gramo / 0,001 unidad.
-- Los valores existentes conservan su magnitud: 25 pasa a 25.000.

ALTER TABLE `Product`
  MODIFY `stock` DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  MODIFY `reserved` DECIMAL(14,3) NOT NULL DEFAULT 0.000;

ALTER TABLE `InventoryStock`
  MODIFY `onHand` DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  MODIFY `reserved` DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  MODIFY `minStock` DECIMAL(14,3) NOT NULL DEFAULT 0.000;

ALTER TABLE `InventoryMovement`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL,
  MODIFY `onHandAfter` DECIMAL(14,3) NOT NULL,
  MODIFY `reservedAfter` DECIMAL(14,3) NOT NULL;

ALTER TABLE `InventoryReservation`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL;

ALTER TABLE `WarehouseProductPlacement`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL DEFAULT 0.000;

ALTER TABLE `WarehouseLocationMovement`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL,
  MODIFY `locatedAfter` DECIMAL(14,3) NOT NULL;

ALTER TABLE `PosSaleItem`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL;

ALTER TABLE `OrderItem`
  MODIFY `quantity` DECIMAL(14,3) NOT NULL;
