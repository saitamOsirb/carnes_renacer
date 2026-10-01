CREATE TABLE `WarehouseLayout` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `widthCm` INTEGER NOT NULL,
  `depthCm` INTEGER NOT NULL,
  `heightCm` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WarehouseLayout_warehouseId_key`(`warehouseId`),
  INDEX `WarehouseLayout_warehouseId_idx`(`warehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseVisualObject` (
  `id` VARCHAR(30) NOT NULL,
  `layoutId` VARCHAR(30) NOT NULL,
  `type` ENUM('RACK','PALLET','COLD_ROOM','FREEZER','FRIDGE','TABLE','WALL','DOOR','RECEIVING','DISPATCH','CUSTOM') NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `xCm` INTEGER NOT NULL,
  `zCm` INTEGER NOT NULL,
  `widthCm` INTEGER NOT NULL,
  `depthCm` INTEGER NOT NULL,
  `heightCm` INTEGER NOT NULL,
  `rotation` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WarehouseVisualObject_layoutId_idx`(`layoutId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseProductPlacement` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `objectId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `locationCode` VARCHAR(80) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WarehouseProductPlacement_warehouseId_productId_key`(`warehouseId`, `productId`),
  INDEX `WarehouseProductPlacement_objectId_idx`(`objectId`),
  INDEX `WarehouseProductPlacement_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WarehouseLayout`
  ADD CONSTRAINT `WarehouseLayout_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarehouseVisualObject`
  ADD CONSTRAINT `WarehouseVisualObject_layoutId_fkey`
  FOREIGN KEY (`layoutId`) REFERENCES `WarehouseLayout`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarehouseProductPlacement`
  ADD CONSTRAINT `WarehouseProductPlacement_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarehouseProductPlacement`
  ADD CONSTRAINT `WarehouseProductPlacement_objectId_fkey`
  FOREIGN KEY (`objectId`) REFERENCES `WarehouseVisualObject`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarehouseProductPlacement`
  ADD CONSTRAINT `WarehouseProductPlacement_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
