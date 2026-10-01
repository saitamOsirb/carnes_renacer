CREATE TABLE `PosUser` (
  `id` VARCHAR(30) NOT NULL,
  `username` VARCHAR(80) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `pinHash` VARCHAR(191) NOT NULL,
  `role` ENUM('CASHIER', 'MANAGER') NOT NULL DEFAULT 'CASHIER',
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PosUser_username_key`(`username`),
  INDEX `PosUser_active_name_idx`(`active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CashRegister` (
  `id` VARCHAR(30) NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CashRegister_code_key`(`code`),
  INDEX `CashRegister_active_name_idx`(`active`, `name`),
  INDEX `CashRegister_warehouseId_idx`(`warehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosShift` (
  `id` VARCHAR(30) NOT NULL,
  `registerId` VARCHAR(30) NOT NULL,
  `userId` VARCHAR(30) NOT NULL,
  `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `openingAmount` INTEGER NOT NULL DEFAULT 0,
  `expectedCash` INTEGER NULL,
  `declaredCash` INTEGER NULL,
  `difference` INTEGER NULL,
  `openingNotes` VARCHAR(500) NULL,
  `closingNotes` VARCHAR(500) NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  INDEX `PosShift_status_openedAt_idx`(`status`, `openedAt`),
  INDEX `PosShift_registerId_status_idx`(`registerId`, `status`),
  INDEX `PosShift_userId_status_idx`(`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosCashMovement` (
  `id` VARCHAR(30) NOT NULL,
  `shiftId` VARCHAR(30) NOT NULL,
  `type` ENUM('CASH_IN', 'CASH_OUT') NOT NULL,
  `amount` INTEGER NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `PosCashMovement_shiftId_createdAt_idx`(`shiftId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PosSale`
  ADD COLUMN `shiftId` VARCHAR(30) NULL,
  ADD COLUMN `cashierId` VARCHAR(30) NULL,
  ADD INDEX `PosSale_shiftId_createdAt_idx`(`shiftId`, `createdAt`),
  ADD INDEX `PosSale_cashierId_createdAt_idx`(`cashierId`, `createdAt`);

ALTER TABLE `CashRegister`
  ADD CONSTRAINT `CashRegister_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PosShift`
  ADD CONSTRAINT `PosShift_registerId_fkey`
  FOREIGN KEY (`registerId`) REFERENCES `CashRegister`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PosShift_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `PosUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PosCashMovement`
  ADD CONSTRAINT `PosCashMovement_shiftId_fkey`
  FOREIGN KEY (`shiftId`) REFERENCES `PosShift`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PosSale`
  ADD CONSTRAINT `PosSale_shiftId_fkey`
  FOREIGN KEY (`shiftId`) REFERENCES `PosShift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PosSale_cashierId_fkey`
  FOREIGN KEY (`cashierId`) REFERENCES `PosUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `CashRegister` (`id`, `code`, `name`, `warehouseId`, `active`, `createdAt`, `updatedAt`)
SELECT 'cash-register-1', 'CAJA-1', 'Caja 1', w.`id`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Warehouse` w
WHERE w.`isDefault` = true
ORDER BY w.`createdAt` ASC
LIMIT 1;
