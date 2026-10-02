-- Production / cutting traceability by lot.
ALTER TABLE `InventoryMovement`
  MODIFY `type` ENUM(
    'OPENING','RECEIVE','ISSUE','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN',
    'RESERVATION','RESERVATION_RELEASE','SALE','RETURN',
    'PRODUCTION_CONSUME','PRODUCTION_OUTPUT'
  ) NOT NULL;

ALTER TABLE `InventoryLotMovement`
  MODIFY `type` ENUM(
    'OPENING','RECEIVE','SALE','ISSUE','TRANSFER_OUT','TRANSFER_IN','RETURN','ADJUSTMENT',
    'PRODUCTION_CONSUME','PRODUCTION_OUTPUT'
  ) NOT NULL;

ALTER TABLE `ProductLot`
  ADD COLUMN `unitCostNet` INTEGER NULL AFTER `supplierLotNumber`;

UPDATE `ProductLot` pl
JOIN `PurchaseReceiptItem` pri ON pri.`id` = pl.`purchaseReceiptItemId`
SET pl.`unitCostNet` = pri.`unitCostNet`
WHERE pl.`unitCostNet` IS NULL;

CREATE TABLE `ProductionBatch` (
  `id` VARCHAR(30) NOT NULL,
  `productionNumber` VARCHAR(40) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `processType` ENUM('DESPOSTE','PORCIONADO','MOLIENDA','ENVASADO','ELABORACION','OTRO') NOT NULL,
  `performedBy` VARCHAR(80) NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `totalInputQuantity` DECIMAL(14,3) NOT NULL,
  `totalOutputQuantity` DECIMAL(14,3) NOT NULL,
  `totalWasteQuantity` DECIMAL(14,3) NOT NULL,
  `yieldPercent` DECIMAL(7,3) NOT NULL,
  `totalInputCost` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProductionBatch_productionNumber_key` (`productionNumber`),
  UNIQUE INDEX `ProductionBatch_requestKey_key` (`requestKey`),
  INDEX `ProductionBatch_warehouseId_createdAt_idx` (`warehouseId`, `createdAt`),
  INDEX `ProductionBatch_processType_createdAt_idx` (`processType`, `createdAt`),
  CONSTRAINT `ProductionBatch_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionInput` (
  `id` VARCHAR(30) NOT NULL,
  `productionBatchId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG','UNIT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unitCostNet` INTEGER NULL,
  `totalCostNet` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProductionInput_productionBatchId_lotId_key` (`productionBatchId`, `lotId`),
  INDEX `ProductionInput_lotId_idx` (`lotId`),
  INDEX `ProductionInput_productId_idx` (`productId`),
  CONSTRAINT `ProductionInput_productionBatchId_fkey`
    FOREIGN KEY (`productionBatchId`) REFERENCES `ProductionBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionInput_lotId_fkey`
    FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductionInput_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionOutput` (
  `id` VARCHAR(30) NOT NULL,
  `productionBatchId` VARCHAR(30) NOT NULL,
  `lotId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG','UNIT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `allocatedCostNet` INTEGER NULL,
  `unitCostNet` INTEGER NULL,
  `manufacturedAt` DATETIME(3) NULL,
  `expirationDate` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProductionOutput_lotId_key` (`lotId`),
  UNIQUE INDEX `ProductionOutput_productionBatchId_productId_key` (`productionBatchId`, `productId`),
  INDEX `ProductionOutput_productId_idx` (`productId`),
  CONSTRAINT `ProductionOutput_productionBatchId_fkey`
    FOREIGN KEY (`productionBatchId`) REFERENCES `ProductionBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionOutput_lotId_fkey`
    FOREIGN KEY (`lotId`) REFERENCES `ProductLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductionOutput_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionWaste` (
  `id` VARCHAR(30) NOT NULL,
  `productionBatchId` VARCHAR(30) NOT NULL,
  `sourceProductId` VARCHAR(30) NULL,
  `sourceProductName` VARCHAR(191) NULL,
  `type` ENUM('RECORTE','HUESO','GRASA','MERMA_PROCESO','DERRAME','DETERIORO','OTRO') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `note` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ProductionWaste_productionBatchId_idx` (`productionBatchId`),
  INDEX `ProductionWaste_sourceProductId_idx` (`sourceProductId`),
  CONSTRAINT `ProductionWaste_productionBatchId_fkey`
    FOREIGN KEY (`productionBatchId`) REFERENCES `ProductionBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionWaste_sourceProductId_fkey`
    FOREIGN KEY (`sourceProductId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
