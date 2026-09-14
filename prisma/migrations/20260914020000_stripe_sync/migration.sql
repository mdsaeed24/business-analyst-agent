-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillingStatus" ADD VALUE 'trialing';
ALTER TYPE "BillingStatus" ADD VALUE 'past_due';
ALTER TYPE "BillingStatus" ADD VALUE 'unpaid';
ALTER TYPE "BillingStatus" ADD VALUE 'incomplete';
ALTER TYPE "BillingStatus" ADD VALUE 'incomplete_expired';
ALTER TYPE "BillingStatus" ADD VALUE 'paused';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'pending';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'other';

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "activeRunId" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMPTZ(3),
ADD COLUMN     "liveMode" BOOLEAN,
ADD COLUMN     "nextSyncAt" TIMESTAMPTZ(3),
ADD COLUMN     "requestedFullSync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "syncRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "syncWatermark" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "StripeCustomer" ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceCreatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceDeletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceObservedAt" TIMESTAMPTZ(3),
ALTER COLUMN "companyId" DROP NOT NULL,
ALTER COLUMN "customerSince" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "country" DROP NOT NULL,
ALTER COLUMN "sourceUpdatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StripeSubscription" ADD COLUMN     "billingComponents" JSONB,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN,
ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceCreatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceDeletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceObservedAt" TIMESTAMPTZ(3),
ALTER COLUMN "monthlyRecurringRevenueUsd" DROP NOT NULL,
ALTER COLUMN "sourceUpdatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StripePayment" ADD COLUMN     "amountMinor" BIGINT,
ADD COLUMN     "capturedAmountMinor" BIGINT,
ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "invoiceSourceId" TEXT,
ADD COLUMN     "paymentMethodType" TEXT,
ADD COLUMN     "refundedAmountMinor" BIGINT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceCreatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceDeletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceObservedAt" TIMESTAMPTZ(3),
ALTER COLUMN "customerId" DROP NOT NULL,
ALTER COLUMN "subscriptionId" DROP NOT NULL,
ALTER COLUMN "amountUsd" DROP NOT NULL,
ALTER COLUMN "refundAmountUsd" DROP NOT NULL,
ALTER COLUMN "sourceUpdatedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "fullSync" BOOLEAN NOT NULL,
    "cutoff" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "report" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_organizationId_connectionId_startedAt_idx" ON "SyncRun"("organizationId", "connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "StripeCustomer_organizationId_sourceConnectionId_idx" ON "StripeCustomer"("organizationId", "sourceConnectionId");

-- CreateIndex
CREATE INDEX "StripeSubscription_organizationId_sourceConnectionId_idx" ON "StripeSubscription"("organizationId", "sourceConnectionId");

-- CreateIndex
CREATE INDEX "StripePayment_organizationId_sourceConnectionId_idx" ON "StripePayment"("organizationId", "sourceConnectionId");

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_organizationId_sourceConnectionId_fkey" FOREIGN KEY ("organizationId", "sourceConnectionId") REFERENCES "Connection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_organizationId_sourceConnectionId_fkey" FOREIGN KEY ("organizationId", "sourceConnectionId") REFERENCES "Connection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_organizationId_sourceConnectionId_fkey" FOREIGN KEY ("organizationId", "sourceConnectionId") REFERENCES "Connection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "Connection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One configured Stripe account/mode per tenant prevents source ID collisions.
CREATE UNIQUE INDEX "Connection_stripe_tenant_key" ON "Connection" ("organizationId")
WHERE "provider" = 'STRIPE' AND "secretReference" IS NOT NULL;
CREATE UNIQUE INDEX "Connection_stripe_account_mode_key" ON "Connection" ("externalAccountId", "liveMode")
WHERE "provider" = 'STRIPE' AND "secretReference" IS NOT NULL;
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_sync_interval_check" CHECK ("syncIntervalMinutes" BETWEEN 5 AND 1440);
