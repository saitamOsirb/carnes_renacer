CREATE TABLE `PosSale` (
  `id` VARCHAR(30) NOT NULL,
  `saleNumber` VARCHAR(40) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `customerName` VARCHAR(191) NULL,
  `customerRut` VARCHAR(20) NULL,
  `subtotal` INTEGER NOT NULL,
  `discount` INTEGER NOT NULL DEFAULT 0,
  `total` INTEGER NOT NULL,
  `paymentMethod` ENUM('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER') NOT NULL,
  `amountReceived` INTEGER NULL,
  `changeDue` INTEGER NOT NULL DEFAULT 0,
  `notes` VARCHAR(500) NULL,
  `cashier` VARCHAR(80) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PosSale_saleNumber_key`(`saleNumber`),
  INDEX `PosSale_createdAt_idx`(`createdAt`),
  INDEX `PosSale_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosSaleItem` (
  `id` VARCHAR(30) NOT NULL,
  `saleId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPrice` INTEGER NOT NULL,
  `subtotal` INTEGER NOT NULL,

  INDEX `PosSaleItem_saleId_idx`(`saleId`),
  INDEX `PosSaleItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PosSale` ADD CONSTRAINT `PosSale_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PosSaleItem` ADD CONSTRAINT `PosSaleItem_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `PosSale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PosSaleItem` ADD CONSTRAINT `PosSaleItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
