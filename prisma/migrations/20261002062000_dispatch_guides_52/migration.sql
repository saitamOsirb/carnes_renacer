-- Guías de despacho electrónicas tipo 52 y trazabilidad logística.
-- La emisión DTE y el movimiento físico de stock permanecen desacoplados.

ALTER TABLE `DteDocument`
  MODIFY `type` ENUM('BOLETA_ELECTRONICA', 'FACTURA_ELECTRONICA', 'GUIA_DESPACHO', 'NOTA_CREDITO', 'NOTA_DEBITO') NOT NULL;

CREATE TABLE `Dispatch` (
  `id` VARCHAR(30) NOT NULL,
  `dispatchNumber` VARCHAR(40) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `type` ENUM('SALE_DELIVERY', 'INTERNAL_TRANSFER', 'OTHER') NOT NULL,
  `status` ENUM('DRAFT', 'READY', 'DISPATCHED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `sourceWarehouseId` VARCHAR(30) NOT NULL,
  `destinationWarehouseId` VARCHAR(30) NULL,
  `saleId` VARCHAR(30) NULL,
  `orderId` VARCHAR(30) NULL,
  `transferReasonCode` VARCHAR(10) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `receiverRut` VARCHAR(20) NULL,
  `receiverName` VARCHAR(191) NOT NULL,
  `receiverGiro` VARCHAR(191) NULL,
  `receiverAddress` VARCHAR(255) NOT NULL,
  `receiverCommune` VARCHAR(120) NOT NULL,
  `receiverCity` VARCHAR(120) NULL,
  `transportCompanyRut` VARCHAR(20) NULL,
  `transportCompanyName` VARCHAR(191) NULL,
  `driverRut` VARCHAR(20) NULL,
  `driverName` VARCHAR(191) NULL,
  `vehiclePlate` VARCHAR(20) NULL,
  `trailerPlate` VARCHAR(20) NULL,
  `notes` VARCHAR(1000) NULL,
  `dispatchedAt` DATETIME(3) NULL,
  `receivedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Dispatch_dispatchNumber_key`(`dispatchNumber`),
  UNIQUE INDEX `Dispatch_requestKey_key`(`requestKey`),
  INDEX `Dispatch_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `Dispatch_sourceWarehouseId_createdAt_idx`(`sourceWarehouseId`, `createdAt`),
  INDEX `Dispatch_destinationWarehouseId_createdAt_idx`(`destinationWarehouseId`, `createdAt`),
  INDEX `Dispatch_saleId_idx`(`saleId`),
  INDEX `Dispatch_orderId_idx`(`orderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DispatchItem` (
  `id` VARCHAR(30) NOT NULL,
  `dispatchId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unitPrice` INTEGER NOT NULL,
  `amount` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `DispatchItem_dispatchId_idx`(`dispatchId`),
  INDEX `DispatchItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DteDocument`
  ADD COLUMN `dispatchId` VARCHAR(30) NULL,
  ADD INDEX `DteDocument_dispatchId_createdAt_idx`(`dispatchId`, `createdAt`);

ALTER TABLE `Dispatch`
  ADD CONSTRAINT `Dispatch_sourceWarehouseId_fkey`
  FOREIGN KEY (`sourceWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Dispatch_destinationWarehouseId_fkey`
  FOREIGN KEY (`destinationWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Dispatch_saleId_fkey`
  FOREIGN KEY (`saleId`) REFERENCES `PosSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Dispatch_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DispatchItem`
  ADD CONSTRAINT `DispatchItem_dispatchId_fkey`
  FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchItem_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DteDocument`
  ADD CONSTRAINT `DteDocument_dispatchId_fkey`
  FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
