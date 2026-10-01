ALTER TABLE `WarehouseProductPlacement`
  ADD COLUMN `quantity` INTEGER NOT NULL DEFAULT 0;

UPDATE `WarehouseProductPlacement` p
JOIN `InventoryStock` s
  ON s.`warehouseId` = p.`warehouseId`
 AND s.`productId` = p.`productId`
SET p.`quantity` = GREATEST(s.`onHand`, 0);

UPDATE `WarehouseProductPlacement`
SET `locationCode` = ''
WHERE `locationCode` IS NULL;

ALTER TABLE `WarehouseProductPlacement`
  MODIFY `locationCode` VARCHAR(80) NOT NULL DEFAULT '';

DROP INDEX `WarehouseProductPlacement_warehouseId_productId_key`
  ON `WarehouseProductPlacement`;

CREATE UNIQUE INDEX `WarehouseProductPlacement_objectId_productId_locationCode_key`
  ON `WarehouseProductPlacement`(`objectId`, `productId`, `locationCode`);

CREATE INDEX `WarehouseProductPlacement_warehouseId_productId_idx`
  ON `WarehouseProductPlacement`(`warehouseId`, `productId`);

CREATE TABLE `WarehouseLocationMovement` (
  `id` VARCHAR(30) NOT NULL,
  `warehouseId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `type` ENUM('ALLOCATE','INTERNAL_TRANSFER','ADJUST','UNASSIGN','SYSTEM_DECREMENT') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `locatedAfter` INTEGER NOT NULL,
  `fromObjectId` VARCHAR(30) NULL,
  `fromObjectLabel` VARCHAR(120) NULL,
  `fromLocationCode` VARCHAR(80) NULL,
  `toObjectId` VARCHAR(30) NULL,
  `toObjectLabel` VARCHAR(120) NULL,
  `toLocationCode` VARCHAR(80) NULL,
  `reference` VARCHAR(100) NULL,
  `note` VARCHAR(500) NULL,
  `actor` VARCHAR(80) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `WarehouseLocationMovement_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
  INDEX `WarehouseLocationMovement_productId_createdAt_idx`(`productId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WarehouseLocationMovement`
  ADD CONSTRAINT `WarehouseLocationMovement_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `WarehouseLocationMovement`
  ADD CONSTRAINT `WarehouseLocationMovement_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `WarehouseLocationMovement` (
  `id`, `warehouseId`, `productId`, `type`, `quantity`, `locatedAfter`,
  `fromObjectId`, `fromObjectLabel`, `fromLocationCode`,
  `toObjectId`, `toObjectLabel`, `toLocationCode`,
  `reference`, `note`, `actor`, `createdAt`
)
SELECT
  CONCAT('loc_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 26)),
  p.`warehouseId`,
  p.`productId`,
  'ALLOCATE',
  p.`quantity`,
  p.`quantity`,
  NULL,
  NULL,
  NULL,
  p.`objectId`,
  o.`label`,
  NULLIF(p.`locationCode`, ''),
  'MIGRATION',
  'Asignación inicial al habilitar stock por ubicación',
  'migration',
  p.`updatedAt`
FROM `WarehouseProductPlacement` p
JOIN `WarehouseVisualObject` o ON o.`id` = p.`objectId`
WHERE p.`quantity` > 0;
