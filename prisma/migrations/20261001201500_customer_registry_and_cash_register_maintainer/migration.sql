CREATE TABLE `Customer` (
  `id` VARCHAR(30) NOT NULL,
  `rut` VARCHAR(20) NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(40) NULL,
  `address` VARCHAR(255) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `privacyNoticeVersion` VARCHAR(40) NOT NULL,
  `privacyAcknowledgedAt` DATETIME(3) NULL,
  `privacySource` VARCHAR(80) NULL,
  `marketingConsent` BOOLEAN NOT NULL DEFAULT false,
  `marketingConsentAt` DATETIME(3) NULL,
  `marketingConsentSource` VARCHAR(80) NULL,
  `anonymizedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Customer_rut_key`(`rut`),
  INDEX `Customer_active_name_idx`(`active`, `name`),
  INDEX `Customer_email_idx`(`email`),
  INDEX `Customer_phone_idx`(`phone`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerConsentEvent` (
  `id` VARCHAR(30) NOT NULL,
  `customerId` VARCHAR(30) NOT NULL,
  `kind` ENUM('PRIVACY_NOTICE', 'MARKETING') NOT NULL,
  `granted` BOOLEAN NOT NULL,
  `noticeVersion` VARCHAR(40) NULL,
  `source` VARCHAR(80) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CustomerConsentEvent_customerId_createdAt_idx`(`customerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PosSale` ADD COLUMN `customerId` VARCHAR(30) NULL;
CREATE INDEX `PosSale_customerId_createdAt_idx` ON `PosSale`(`customerId`, `createdAt`);

ALTER TABLE `CustomerConsentEvent`
  ADD CONSTRAINT `CustomerConsentEvent_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PosSale`
  ADD CONSTRAINT `PosSale_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
