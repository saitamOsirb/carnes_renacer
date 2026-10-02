-- Sistema de facturación/boleta electrónica Chile.
-- Los flujos oficiales SII se habilitan únicamente cuando SII_ENABLED=true
-- y las credenciales/endpoints del ambiente correspondiente están configurados.

CREATE TABLE `DteFolioSequence` (
  `id` VARCHAR(30) NOT NULL,
  `typeCode` INTEGER NOT NULL,
  `environment` ENUM('MOCK', 'CERTIFICATION', 'PRODUCTION') NOT NULL,
  `nextFolio` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DteFolioSequence_typeCode_environment_key`(`typeCode`, `environment`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DteDocument` (
  `id` VARCHAR(30) NOT NULL,
  `saleId` VARCHAR(30) NULL,
  `parentId` VARCHAR(30) NULL,
  `type` ENUM('BOLETA_ELECTRONICA', 'FACTURA_ELECTRONICA', 'NOTA_CREDITO', 'NOTA_DEBITO') NOT NULL,
  `typeCode` INTEGER NOT NULL,
  `folio` INTEGER NOT NULL,
  `environment` ENUM('MOCK', 'CERTIFICATION', 'PRODUCTION') NOT NULL,
  `status` ENUM('DRAFT', 'GENERATED', 'QUEUED', 'SENT', 'ACCEPTED', 'OBSERVED', 'REJECTED', 'ERROR', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `issueDate` DATETIME(3) NOT NULL,
  `receiverRut` VARCHAR(20) NULL,
  `receiverName` VARCHAR(191) NULL,
  `receiverGiro` VARCHAR(191) NULL,
  `receiverAddress` VARCHAR(255) NULL,
  `receiverCommune` VARCHAR(120) NULL,
  `receiverCity` VARCHAR(120) NULL,
  `netAmount` INTEGER NOT NULL,
  `exemptAmount` INTEGER NOT NULL DEFAULT 0,
  `vatAmount` INTEGER NOT NULL,
  `vatRate` INTEGER NOT NULL DEFAULT 19,
  `totalAmount` INTEGER NOT NULL,
  `trackId` VARCHAR(100) NULL,
  `siiStatusCode` VARCHAR(80) NULL,
  `siiStatusMessage` VARCHAR(500) NULL,
  `xmlDraft` LONGTEXT NULL,
  `xmlSigned` LONGTEXT NULL,
  `responseRaw` LONGTEXT NULL,
  `errorMessage` VARCHAR(1000) NULL,
  `issuedAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DteDocument_environment_typeCode_folio_key`(`environment`, `typeCode`, `folio`),
  INDEX `DteDocument_saleId_createdAt_idx`(`saleId`, `createdAt`),
  INDEX `DteDocument_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `DteDocument_trackId_idx`(`trackId`),
  INDEX `DteDocument_parentId_idx`(`parentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DteEvent` (
  `id` VARCHAR(30) NOT NULL,
  `documentId` VARCHAR(30) NOT NULL,
  `status` ENUM('DRAFT', 'GENERATED', 'QUEUED', 'SENT', 'ACCEPTED', 'OBSERVED', 'REJECTED', 'ERROR', 'CANCELLED') NOT NULL,
  `code` VARCHAR(80) NULL,
  `message` VARCHAR(1000) NOT NULL,
  `raw` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `DteEvent_documentId_createdAt_idx`(`documentId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DteDocument`
  ADD CONSTRAINT `DteDocument_saleId_fkey`
  FOREIGN KEY (`saleId`) REFERENCES `PosSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DteDocument`
  ADD CONSTRAINT `DteDocument_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `DteDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DteEvent`
  ADD CONSTRAINT `DteEvent_documentId_fkey`
  FOREIGN KEY (`documentId`) REFERENCES `DteDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
