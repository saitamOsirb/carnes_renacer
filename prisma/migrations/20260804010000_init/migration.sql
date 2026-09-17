-- MySQL 8.0.16+ / InnoDB / utf8mb4

CREATE TABLE `Product` (
  `id` VARCHAR(30) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `imageUrl` VARCHAR(500) NOT NULL,
  `price` INTEGER NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL DEFAULT 'KG',
  `stock` INTEGER NOT NULL,
  `reserved` INTEGER NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `featured` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  CONSTRAINT `Product_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `Product_nonnegative_stock` CHECK (`stock` >= 0),
  CONSTRAINT `Product_nonnegative_reserved` CHECK (`reserved` >= 0),
  CONSTRAINT `Product_positive_price` CHECK (`price` > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Order` (
  `id` VARCHAR(30) NOT NULL,
  `orderNumber` VARCHAR(40) NOT NULL,
  `buyOrder` VARCHAR(26) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(61) NOT NULL,
  `status` ENUM('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'PAYMENT_REVIEW', 'CANCELLED', 'FULFILLING', 'SHIPPED', 'COMPLETED', 'REFUNDED') NOT NULL DEFAULT 'PENDING_PAYMENT',
  `paymentStatus` ENUM('PENDING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'FAILED', 'REVIEW', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
  `customerName` VARCHAR(191) NOT NULL,
  `customerEmail` VARCHAR(191) NOT NULL,
  `customerPhone` VARCHAR(40) NOT NULL,
  `customerRut` VARCHAR(20) NULL,
  `addressLine` VARCHAR(255) NOT NULL,
  `addressDetail` VARCHAR(255) NULL,
  `commune` VARCHAR(120) NOT NULL,
  `region` VARCHAR(120) NOT NULL,
  `deliveryDate` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `subtotal` INTEGER NOT NULL,
  `shipping` INTEGER NOT NULL,
  `discount` INTEGER NOT NULL DEFAULT 0,
  `couponCode` VARCHAR(100) NULL,
  `total` INTEGER NOT NULL,
  `tokenWs` VARCHAR(191) NULL,
  `webpayUrl` VARCHAR(500) NULL,
  `authorizationCode` VARCHAR(100) NULL,
  `paymentTypeCode` VARCHAR(20) NULL,
  `installmentsNumber` INTEGER NULL,
  `cardLastFour` VARCHAR(4) NULL,
  `webpayResponse` JSON NULL,
  `reservationExpires` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  CONSTRAINT `Order_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `Order_nonnegative_amounts` CHECK (`subtotal` >= 0 AND `shipping` >= 0 AND `discount` >= 0 AND `total` > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderItem` (
  `id` VARCHAR(30) NOT NULL,
  `orderId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(30) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `imageUrl` VARCHAR(500) NOT NULL,
  `unit` ENUM('KG', 'UNIT') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPrice` INTEGER NOT NULL,
  `subtotal` INTEGER NOT NULL,

  CONSTRAINT `OrderItem_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `OrderItem_positive_values` CHECK (`quantity` > 0 AND `unitPrice` > 0 AND `subtotal` > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Coupon` (
  `id` VARCHAR(30) NOT NULL,
  `code` VARCHAR(100) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `percentOff` INTEGER NULL,
  `fixedAmountOff` INTEGER NULL,
  `minimumSubtotal` INTEGER NOT NULL DEFAULT 0,
  `startsAt` DATETIME(3) NULL,
  `endsAt` DATETIME(3) NULL,
  `usageLimit` INTEGER NULL,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  CONSTRAINT `Coupon_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `Coupon_valid_percent` CHECK (`percentOff` IS NULL OR (`percentOff` BETWEEN 1 AND 100))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ContactMessage` (
  `id` VARCHAR(30) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `company` VARCHAR(191) NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `subject` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `ipHash` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `handledAt` DATETIME(3) NULL,

  CONSTRAINT `ContactMessage_pkey` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RateLimitBucket` (
  `key` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `windowStart` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  CONSTRAINT `RateLimitBucket_pkey` PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `Product_slug_key` ON `Product`(`slug`);
CREATE INDEX `Product_active_category_idx` ON `Product`(`active`, `category`);
CREATE UNIQUE INDEX `Order_orderNumber_key` ON `Order`(`orderNumber`);
CREATE UNIQUE INDEX `Order_buyOrder_key` ON `Order`(`buyOrder`);
CREATE UNIQUE INDEX `Order_idempotencyKey_key` ON `Order`(`idempotencyKey`);
CREATE UNIQUE INDEX `Order_tokenWs_key` ON `Order`(`tokenWs`);
CREATE INDEX `Order_status_createdAt_idx` ON `Order`(`status`, `createdAt`);
CREATE INDEX `Order_customerEmail_createdAt_idx` ON `Order`(`customerEmail`, `createdAt`);
CREATE INDEX `OrderItem_orderId_idx` ON `OrderItem`(`orderId`);
CREATE UNIQUE INDEX `Coupon_code_key` ON `Coupon`(`code`);
CREATE INDEX `ContactMessage_createdAt_idx` ON `ContactMessage`(`createdAt`);

ALTER TABLE `OrderItem`
  ADD CONSTRAINT `OrderItem_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderItem`
  ADD CONSTRAINT `OrderItem_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
