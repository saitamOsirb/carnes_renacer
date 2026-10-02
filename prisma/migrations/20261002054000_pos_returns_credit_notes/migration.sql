ALTER TABLE `InventoryMovement`
  MODIFY `type` ENUM('OPENING','RECEIVE','ISSUE','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','RESERVATION','RESERVATION_RELEASE','SALE','RETURN') NOT NULL;

CREATE TABLE `PosReturn` (
  `id` VARCHAR(30) NOT NULL,
  `returnNumber` VARCHAR(40) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `saleId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `shiftId` VARCHAR(30) NULL,
  `cashMovementId` VARCHAR(30) NULL,
  `refundMethod` ENUM('CASH','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER') NOT NULL,
  `grossAmount` INTEGER NOT NULL,
  `discountAmount` INTEGER NOT NULL DEFAULT 0,
  `totalAmount` INTEGER NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PosReturn_returnNumber_key`(`returnNumber`),
  UNIQUE INDEX `PosReturn_requestKey_key`(`requestKey`),
  UNIQUE INDEX `PosReturn_cashMovementId_key`(`cashMovementId`),
  INDEX `PosReturn_saleId_createdAt_idx`(`saleId`, `createdAt`),
  INDEX `PosReturn_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  INDEX `PosReturn_shiftId_createdAt_idx`(`shiftId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosReturnItem` (
  `id` VARCHAR(30) NOT NULL,
  `returnId` VARCHAR(30) NOT NULL,
  `saleItemId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG','UNIT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unitPrice` INTEGER NOT NULL,
  `grossAmount` INTEGER NOT NULL,
  `discountAmount` INTEGER NOT NULL DEFAULT 0,
  `totalAmount` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PosReturnItem_returnId_idx`(`returnId`),
  INDEX `PosReturnItem_saleItemId_idx`(`saleItemId`),
  INDEX `PosReturnItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DteDocument`
  ADD COLUMN `returnId` VARCHAR(30) NULL;

CREATE INDEX `DteDocument_returnId_createdAt_idx` ON `DteDocument`(`returnId`, `createdAt`);

ALTER TABLE `PosReturn`
  ADD CONSTRAINT `PosReturn_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `PosSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PosReturn_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PosReturn_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `PosShift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PosReturn_cashMovementId_fkey` FOREIGN KEY (`cashMovementId`) REFERENCES `PosCashMovement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PosReturnItem`
  ADD CONSTRAINT `PosReturnItem_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `PosReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PosReturnItem_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `PosSaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PosReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DteDocument`
  ADD CONSTRAINT `DteDocument_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `PosReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
