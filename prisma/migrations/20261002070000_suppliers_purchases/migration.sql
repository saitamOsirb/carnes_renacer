CREATE TABLE `Supplier` (
  `id` VARCHAR(30) NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `rut` VARCHAR(20) NULL,
  `name` VARCHAR(191) NOT NULL,
  `contactName` VARCHAR(191) NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(40) NULL,
  `address` VARCHAR(255) NULL,
  `commune` VARCHAR(120) NULL,
  `city` VARCHAR(120) NULL,
  `paymentTermsDays` INTEGER NOT NULL DEFAULT 0,
  `notes` VARCHAR(1000) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Supplier_code_key`(`code`),
  UNIQUE INDEX `Supplier_rut_key`(`rut`),
  INDEX `Supplier_active_name_idx`(`active`, `name`),
  INDEX `Supplier_email_idx`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrder` (
  `id` VARCHAR(30) NOT NULL,
  `orderNumber` VARCHAR(40) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `supplierId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `status` ENUM('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'ORDERED',
  `expectedDate` DATETIME(3) NULL,
  `supplierReference` VARCHAR(100) NULL,
  `vatRate` INTEGER NOT NULL DEFAULT 19,
  `netAmount` INTEGER NOT NULL,
  `vatAmount` INTEGER NOT NULL,
  `totalAmount` INTEGER NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `orderedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PurchaseOrder_orderNumber_key`(`orderNumber`),
  UNIQUE INDEX `PurchaseOrder_requestKey_key`(`requestKey`),
  INDEX `PurchaseOrder_supplierId_createdAt_idx`(`supplierId`, `createdAt`),
  INDEX `PurchaseOrder_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  INDEX `PurchaseOrder_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderItem` (
  `id` VARCHAR(30) NOT NULL,
  `purchaseOrderId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL,
  `orderedQuantity` DECIMAL(14,3) NOT NULL,
  `receivedQuantity` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `unitCostNet` INTEGER NOT NULL,
  `netAmount` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PurchaseOrderItem_purchaseOrderId_productId_key`(`purchaseOrderId`, `productId`),
  INDEX `PurchaseOrderItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseReceipt` (
  `id` VARCHAR(30) NOT NULL,
  `receiptNumber` VARCHAR(40) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `purchaseOrderId` VARCHAR(30) NOT NULL,
  `documentType` ENUM('GUIA_DESPACHO', 'FACTURA', 'BOLETA', 'OTRO') NULL,
  `supplierDocumentNumber` VARCHAR(100) NULL,
  `receivedBy` VARCHAR(80) NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PurchaseReceipt_receiptNumber_key`(`receiptNumber`),
  UNIQUE INDEX `PurchaseReceipt_requestKey_key`(`requestKey`),
  INDEX `PurchaseReceipt_purchaseOrderId_receivedAt_idx`(`purchaseOrderId`, `receivedAt`),
  INDEX `PurchaseReceipt_supplierDocumentNumber_idx`(`supplierDocumentNumber`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseReceiptItem` (
  `id` VARCHAR(30) NOT NULL,
  `purchaseReceiptId` VARCHAR(30) NOT NULL,
  `purchaseOrderItemId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unitCostNet` INTEGER NOT NULL,
  `netAmount` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PurchaseReceiptItem_purchaseReceiptId_purchaseOrderItemId_key`(`purchaseReceiptId`, `purchaseOrderItemId`),
  INDEX `PurchaseReceiptItem_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
  INDEX `PurchaseReceiptItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PurchaseOrder`
  ADD CONSTRAINT `PurchaseOrder_supplierId_fkey`
  FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrder`
  ADD CONSTRAINT `PurchaseOrder_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderItem`
  ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey`
  FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderItem`
  ADD CONSTRAINT `PurchaseOrderItem_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseReceipt`
  ADD CONSTRAINT `PurchaseReceipt_purchaseOrderId_fkey`
  FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseReceiptItem`
  ADD CONSTRAINT `PurchaseReceiptItem_purchaseReceiptId_fkey`
  FOREIGN KEY (`purchaseReceiptId`) REFERENCES `PurchaseReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseReceiptItem`
  ADD CONSTRAINT `PurchaseReceiptItem_purchaseOrderItemId_fkey`
  FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseReceiptItem`
  ADD CONSTRAINT `PurchaseReceiptItem_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
