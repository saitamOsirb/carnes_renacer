CREATE TABLE `ProductLot` (
  `id` VARCHAR(30) NOT NULL,
  `internalCode` VARCHAR(60) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `supplierId` VARCHAR(30) NULL,
  `purchaseReceiptItemId` VARCHAR(30) NULL,
  `supplierLotNumber` VARCHAR(100) NULL,
  `manufacturedAt` DATETIME(3) NULL,
  `expirationDate` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProductLot_internalCode_key`(`internalCode`),
  UNIQUE INDEX `ProductLot_purchaseReceiptItemId_key`(`purchaseReceiptItemId`),
  INDEX `ProductLot_productId_expirationDate_idx`(`productId`, `expirationDate`),
  INDEX `ProductLot_supplierId_supplierLotNumber_idx`(`supplierId`, `supplierLotNumber`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryLotStock` (
  `id` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `onHand` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `InventoryLotStock_lotId_warehouseId_key`(`lotId`, `warehouseId`),
  INDEX `InventoryLotStock_warehouseId_onHand_idx`(`warehouseId`, `onHand`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryLotMovement` (
  `id` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `type` ENUM('OPENING','RECEIVE','SALE','ISSUE','TRANSFER_OUT','TRANSFER_IN','RETURN','ADJUSTMENT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `balanceAfter` DECIMAL(14,3) NOT NULL,
  `reference` VARCHAR(100) NULL,
  `note` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `InventoryLotMovement_lotId_createdAt_idx`(`lotId`, `createdAt`),
  INDEX `InventoryLotMovement_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  INDEX `InventoryLotMovement_reference_idx`(`reference`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseLotPlacement` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `objectId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `locationCode` VARCHAR(80) NOT NULL DEFAULT '',
  `quantity` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `WarehouseLotPlacement_objectId_lotId_locationCode_key`(`objectId`, `lotId`, `locationCode`),
  INDEX `WarehouseLotPlacement_warehouseId_lotId_idx`(`warehouseId`, `lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosSaleLotAllocation` (
  `id` VARCHAR(30) NOT NULL,
  `saleItemId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PosSaleLotAllocation_saleItemId_lotId_key`(`saleItemId`, `lotId`),
  INDEX `PosSaleLotAllocation_lotId_idx`(`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosReturnLotAllocation` (
  `id` VARCHAR(30) NOT NULL,
  `returnItemId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PosReturnLotAllocation_returnItemId_lotId_key`(`returnItemId`, `lotId`),
  INDEX `PosReturnLotAllocation_lotId_idx`(`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderItemLotAllocation` (
  `id` VARCHAR(30) NOT NULL,
  `orderItemId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `OrderItemLotAllocation_orderItemId_lotId_warehouseId_key`(`orderItemId`, `lotId`, `warehouseId`),
  INDEX `OrderItemLotAllocation_lotId_idx`(`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DispatchLotAllocation` (
  `id` VARCHAR(30) NOT NULL,
  `dispatchItemId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DispatchLotAllocation_dispatchItemId_lotId_key`(`dispatchItemId`, `lotId`),
  INDEX `DispatchLotAllocation_lotId_idx`(`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductLot` ADD CONSTRAINT `ProductLot_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductLot` ADD CONSTRAINT `ProductLot_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ProductLot` ADD CONSTRAINT `ProductLot_purchaseReceiptItemId_fkey` FOREIGN KEY (`purchaseReceiptItemId`) REFERENCES `PurchaseReceiptItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InventoryLotStock` ADD CONSTRAINT `InventoryLotStock_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryLotStock` ADD CONSTRAINT `InventoryLotStock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryLotMovement` ADD CONSTRAINT `InventoryLotMovement_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryLotMovement` ADD CONSTRAINT `InventoryLotMovement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WarehouseLotPlacement` ADD CONSTRAINT `WarehouseLotPlacement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarehouseLotPlacement` ADD CONSTRAINT `WarehouseLotPlacement_objectId_fkey` FOREIGN KEY (`objectId`) REFERENCES `WarehouseVisualObject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarehouseLotPlacement` ADD CONSTRAINT `WarehouseLotPlacement_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PosSaleLotAllocation` ADD CONSTRAINT `PosSaleLotAllocation_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `PosSaleItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PosSaleLotAllocation` ADD CONSTRAINT `PosSaleLotAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PosSaleLotAllocation` ADD CONSTRAINT `PosSaleLotAllocation_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PosReturnLotAllocation` ADD CONSTRAINT `PosReturnLotAllocation_returnItemId_fkey` FOREIGN KEY (`returnItemId`) REFERENCES `PosReturnItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PosReturnLotAllocation` ADD CONSTRAINT `PosReturnLotAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PosReturnLotAllocation` ADD CONSTRAINT `PosReturnLotAllocation_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrderItemLotAllocation` ADD CONSTRAINT `OrderItemLotAllocation_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrderItemLotAllocation` ADD CONSTRAINT `OrderItemLotAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrderItemLotAllocation` ADD CONSTRAINT `OrderItemLotAllocation_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DispatchLotAllocation` ADD CONSTRAINT `DispatchLotAllocation_dispatchItemId_fkey` FOREIGN KEY (`dispatchItemId`) REFERENCES `DispatchItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DispatchLotAllocation` ADD CONSTRAINT `DispatchLotAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: cada saldo preexistente se convierte en un lote LEGACY independiente por producto/bodega.
INSERT INTO `ProductLot` (`id`,`internalCode`,`productId`,`supplierId`,`purchaseReceiptItemId`,`supplierLotNumber`,`manufacturedAt`,`expirationDate`,`createdAt`,`updatedAt`)
SELECT
  CONCAT('lg_', LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 24)),
  CONCAT('LEGACY-', UPPER(LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 12))),
  s.`productId`, NULL, NULL, NULL, NULL, NULL, s.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `InventoryStock` s
WHERE s.`onHand` > 0;

INSERT INTO `InventoryLotStock` (`id`,`lotId`,`warehouseId`,`onHand`,`createdAt`,`updatedAt`)
SELECT
  CONCAT('ls_', LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 24)),
  CONCAT('lg_', LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 24)),
  s.`warehouseId`, s.`onHand`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `InventoryStock` s
WHERE s.`onHand` > 0;

INSERT INTO `InventoryLotMovement` (`id`,`lotId`,`warehouseId`,`type`,`quantity`,`balanceAfter`,`reference`,`note`,`createdAt`)
SELECT
  CONCAT('lm_', LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 24)),
  CONCAT('lg_', LEFT(MD5(CONCAT(s.`warehouseId`, ':', s.`productId`)), 24)),
  s.`warehouseId`, 'OPENING', s.`onHand`, s.`onHand`, 'LOT-MIGRATION',
  'Saldo inicial creado al habilitar trazabilidad por lotes', CURRENT_TIMESTAMP(3)
FROM `InventoryStock` s
WHERE s.`onHand` > 0;

-- Las ubicaciones físicas existentes se copian al lote LEGACY, ya que no existía información de lote previa.
INSERT INTO `WarehouseLotPlacement` (`id`,`warehouseId`,`objectId`,`lotId`,`locationCode`,`quantity`,`createdAt`,`updatedAt`)
SELECT
  CONCAT('lp_', LEFT(MD5(CONCAT(p.`id`, ':legacy')), 24)),
  p.`warehouseId`, p.`objectId`,
  CONCAT('lg_', LEFT(MD5(CONCAT(p.`warehouseId`, ':', p.`productId`)), 24)),
  p.`locationCode`, p.`quantity`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `WarehouseProductPlacement` p
INNER JOIN `InventoryStock` s ON s.`warehouseId` = p.`warehouseId` AND s.`productId` = p.`productId`
WHERE s.`onHand` > 0 AND p.`quantity` > 0;