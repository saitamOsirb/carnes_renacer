CREATE TABLE `Warehouse` (
  `id` VARCHAR(30) NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `address` VARCHAR(255) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Warehouse_code_key`(`code`),
  INDEX `Warehouse_active_name_idx`(`active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryStock` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `onHand` INTEGER NOT NULL DEFAULT 0,
  `reserved` INTEGER NOT NULL DEFAULT 0,
  `minStock` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `InventoryStock_warehouseId_productId_key`(`warehouseId`, `productId`),
  INDEX `InventoryStock_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryMovement` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `type` ENUM('OPENING', 'RECEIVE', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVATION', 'RESERVATION_RELEASE', 'SALE') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `onHandAfter` INTEGER NOT NULL,
  `reservedAfter` INTEGER NOT NULL,
  `note` VARCHAR(500) NULL,
  `reference` VARCHAR(100) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `InventoryMovement_productId_createdAt_idx`(`productId`, `createdAt`),
  INDEX `InventoryMovement_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryReservation` (
  `id` VARCHAR(30) NOT NULL,
  `orderItemId` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `InventoryReservation_orderItemId_warehouseId_key`(`orderItemId`, `warehouseId`),
  INDEX `InventoryReservation_warehouseId_idx`(`warehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryStock` ADD CONSTRAINT `InventoryStock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryStock` ADD CONSTRAINT `InventoryStock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryMovement` ADD CONSTRAINT `InventoryMovement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryMovement` ADD CONSTRAINT `InventoryMovement_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `InventoryReservation` ADD CONSTRAINT `InventoryReservation_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InventoryReservation` ADD CONSTRAINT `InventoryReservation_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `Warehouse` (`id`, `code`, `name`, `address`, `active`, `isDefault`, `createdAt`, `updatedAt`)
VALUES ('warehouse-central', 'CENTRAL', 'Bodega principal', NULL, true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT INTO `InventoryStock` (`id`, `warehouseId`, `productId`, `onHand`, `reserved`, `minStock`, `createdAt`, `updatedAt`)
SELECT CONCAT('stock-', LEFT(MD5(`id`), 24)), 'warehouse-central', `id`, `stock` + `reserved`, `reserved`, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Product`;

INSERT INTO `InventoryMovement` (`id`, `warehouseId`, `productId`, `type`, `quantity`, `onHandAfter`, `reservedAfter`, `note`, `reference`, `createdAt`)
SELECT CONCAT('move-', LEFT(MD5(`id`), 25)), 'warehouse-central', `id`, 'OPENING', `stock` + `reserved`, `stock` + `reserved`, `reserved`, 'Saldo inicial migrado desde Product.stock', 'inventory-migration', CURRENT_TIMESTAMP(3)
FROM `Product`
WHERE (`stock` + `reserved`) > 0;

INSERT INTO `InventoryReservation` (`id`, `orderItemId`, `warehouseId`, `quantity`, `createdAt`)
SELECT CONCAT('res-', LEFT(MD5(oi.`id`), 26)), oi.`id`, 'warehouse-central', oi.`quantity`, CURRENT_TIMESTAMP(3)
FROM `OrderItem` oi
INNER JOIN `Order` o ON o.`id` = oi.`orderId`
WHERE o.`status` IN ('PENDING_PAYMENT', 'PAYMENT_REVIEW');
