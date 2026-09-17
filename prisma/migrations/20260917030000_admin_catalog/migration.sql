CREATE TABLE `ProductImage` (
  `id` VARCHAR(30) NOT NULL,
  `mimeType` VARCHAR(50) NOT NULL,
  `byteSize` INTEGER NOT NULL,
  `data` LONGBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StoreSetting` (
  `key` VARCHAR(100) NOT NULL,
  `value` VARCHAR(500) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `StoreSetting` (`key`, `value`, `updatedAt`)
VALUES ('checkout_whatsapp', '56991851942', CURRENT_TIMESTAMP(3));
