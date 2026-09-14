-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('hubspot', 'ga4', 'stripe', 'quickbooks', 'zendesk', 'synthetic');

-- CreateEnum
CREATE TYPE "CompanyLifecycle" AS ENUM ('churned', 'customer', 'lead', 'prospect');

-- CreateEnum
CREATE TYPE "ContactLifecycle" AS ENUM ('MQL', 'SQL', 'customer', 'lead', 'subscriber');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('closed_lost', 'closed_won', 'demo', 'proposal', 'qualification');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('active', 'canceled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('failed', 'succeeded');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ach', 'card');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('paid', 'open', 'void', 'uncollectible');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('high', 'low', 'normal', 'urgent');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('closed', 'open', 'pending', 'solved');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "industry" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "normalizedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceRecordId" TEXT,
ADD COLUMN     "sourceSystem" "SourceSystem",
ADD COLUMN     "sourceUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "syntheticDataset" TEXT;

-- AlterTable
ALTER TABLE "MetricDefinition" ADD COLUMN     "ingestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "normalizedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceRecordId" TEXT,
ADD COLUMN     "sourceSystem" "SourceSystem",
ADD COLUMN     "sourceUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "syntheticDataset" TEXT;

-- CreateTable
CREATE TABLE "CRMCompany" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "annualRevenueUsd" DECIMAL(20,2) NOT NULL,
    "lifecycleStage" "CompanyLifecycle" NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CRMCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CRMContact" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lifecycleStage" "ContactLifecycle" NOT NULL,
    "createdDate" DATE NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CRMContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CRMDeal" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL,
    "stage" "DealStage" NOT NULL,
    "amountUsd" DECIMAL(20,2) NOT NULL,
    "createdDate" DATE NOT NULL,
    "closeDate" DATE,
    "ownerId" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "isClosedWon" BOOLEAN NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CRMDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GA4DailyMetric" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "conversionRate" DECIMAL(7,6) NOT NULL,
    "bounceRate" DECIMAL(7,6) NOT NULL,
    "revenueAttributedUsd" DECIMAL(20,2) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GA4DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerSince" DATE NOT NULL,
    "status" "BillingStatus" NOT NULL,
    "country" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeSubscription" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "monthlyRecurringRevenueUsd" DECIMAL(20,2) NOT NULL,
    "status" "BillingStatus" NOT NULL,
    "startDate" DATE NOT NULL,
    "cancelDate" DATE,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StripeSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripePayment" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amountUsd" DECIMAL(20,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "refundAmountUsd" DECIMAL(20,2) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StripePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksInvoice" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountUsd" DECIMAL(20,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "paidDate" DATE,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuickBooksInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksExpense" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "amountUsd" DECIMAL(20,2) NOT NULL,
    "department" TEXT NOT NULL,
    "isRecurring" BOOLEAN NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuickBooksExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "syntheticDataset" TEXT,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "category" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER,
    "satisfactionScore" DECIMAL(3,2),
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL,
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CRMCompany_organizationId_syntheticDataset_idx" ON "CRMCompany"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE UNIQUE INDEX "CRMCompany_organizationId_sourceSystem_sourceRecordId_key" ON "CRMCompany"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CRMCompany_organizationId_companyId_key" ON "CRMCompany"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "CRMContact_organizationId_companyId_idx" ON "CRMContact"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "CRMContact_organizationId_syntheticDataset_idx" ON "CRMContact"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "CRMContact_organizationId_createdDate_idx" ON "CRMContact"("organizationId", "createdDate");

-- CreateIndex
CREATE UNIQUE INDEX "CRMContact_organizationId_sourceSystem_sourceRecordId_key" ON "CRMContact"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CRMContact_organizationId_contactId_key" ON "CRMContact"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "CRMDeal_organizationId_companyId_idx" ON "CRMDeal"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "CRMDeal_organizationId_syntheticDataset_idx" ON "CRMDeal"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "CRMDeal_organizationId_createdDate_idx" ON "CRMDeal"("organizationId", "createdDate");

-- CreateIndex
CREATE UNIQUE INDEX "CRMDeal_organizationId_sourceSystem_sourceRecordId_key" ON "CRMDeal"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CRMDeal_organizationId_dealId_key" ON "CRMDeal"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "GA4DailyMetric_organizationId_syntheticDataset_idx" ON "GA4DailyMetric"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "GA4DailyMetric_organizationId_date_idx" ON "GA4DailyMetric"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GA4DailyMetric_organizationId_sourceSystem_sourceRecordId_key" ON "GA4DailyMetric"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "GA4DailyMetric_organizationId_sourceSystem_date_channel_key" ON "GA4DailyMetric"("organizationId", "sourceSystem", "date", "channel");

-- CreateIndex
CREATE INDEX "StripeCustomer_organizationId_companyId_idx" ON "StripeCustomer"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "StripeCustomer_organizationId_syntheticDataset_idx" ON "StripeCustomer"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "StripeCustomer_organizationId_customerSince_idx" ON "StripeCustomer"("organizationId", "customerSince");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_organizationId_sourceSystem_sourceRecordId_key" ON "StripeCustomer"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_organizationId_customerId_key" ON "StripeCustomer"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "StripeSubscription_organizationId_customerId_idx" ON "StripeSubscription"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "StripeSubscription_organizationId_syntheticDataset_idx" ON "StripeSubscription"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "StripeSubscription_organizationId_startDate_idx" ON "StripeSubscription"("organizationId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "StripeSubscription_organizationId_sourceSystem_sourceRecord_key" ON "StripeSubscription"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeSubscription_organizationId_subscriptionId_key" ON "StripeSubscription"("organizationId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeSubscription_organizationId_customerId_subscriptionId_key" ON "StripeSubscription"("organizationId", "customerId", "subscriptionId");

-- CreateIndex
CREATE INDEX "StripePayment_organizationId_customerId_idx" ON "StripePayment"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "StripePayment_organizationId_customerId_subscriptionId_idx" ON "StripePayment"("organizationId", "customerId", "subscriptionId");

-- CreateIndex
CREATE INDEX "StripePayment_organizationId_syntheticDataset_idx" ON "StripePayment"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "StripePayment_organizationId_paymentDate_idx" ON "StripePayment"("organizationId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "StripePayment_organizationId_sourceSystem_sourceRecordId_key" ON "StripePayment"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StripePayment_organizationId_paymentId_key" ON "StripePayment"("organizationId", "paymentId");

-- CreateIndex
CREATE INDEX "QuickBooksInvoice_organizationId_customerId_idx" ON "QuickBooksInvoice"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "QuickBooksInvoice_organizationId_syntheticDataset_idx" ON "QuickBooksInvoice"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "QuickBooksInvoice_organizationId_invoiceDate_idx" ON "QuickBooksInvoice"("organizationId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksInvoice_organizationId_sourceSystem_sourceRecordI_key" ON "QuickBooksInvoice"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksInvoice_organizationId_invoiceId_key" ON "QuickBooksInvoice"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "QuickBooksExpense_organizationId_syntheticDataset_idx" ON "QuickBooksExpense"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "QuickBooksExpense_organizationId_expenseDate_idx" ON "QuickBooksExpense"("organizationId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksExpense_organizationId_sourceSystem_sourceRecordI_key" ON "QuickBooksExpense"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksExpense_organizationId_expenseId_key" ON "QuickBooksExpense"("organizationId", "expenseId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_customerId_idx" ON "SupportTicket"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_syntheticDataset_idx" ON "SupportTicket"("organizationId", "syntheticDataset");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_createdAt_idx" ON "SupportTicket"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_organizationId_sourceSystem_sourceRecordId_key" ON "SupportTicket"("organizationId", "sourceSystem", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_organizationId_ticketId_key" ON "SupportTicket"("organizationId", "ticketId");

-- AddForeignKey
ALTER TABLE "CRMCompany" ADD CONSTRAINT "CRMCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CRMContact" ADD CONSTRAINT "CRMContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CRMContact" ADD CONSTRAINT "CRMContact_organizationId_companyId_fkey" FOREIGN KEY ("organizationId", "companyId") REFERENCES "CRMCompany"("organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CRMDeal" ADD CONSTRAINT "CRMDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CRMDeal" ADD CONSTRAINT "CRMDeal_organizationId_companyId_fkey" FOREIGN KEY ("organizationId", "companyId") REFERENCES "CRMCompany"("organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GA4DailyMetric" ADD CONSTRAINT "GA4DailyMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_organizationId_companyId_fkey" FOREIGN KEY ("organizationId", "companyId") REFERENCES "CRMCompany"("organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "StripeCustomer"("organizationId", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "StripeCustomer"("organizationId", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_organizationId_customerId_subscriptionId_fkey" FOREIGN KEY ("organizationId", "customerId", "subscriptionId") REFERENCES "StripeSubscription"("organizationId", "customerId", "subscriptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksInvoice" ADD CONSTRAINT "QuickBooksInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksInvoice" ADD CONSTRAINT "QuickBooksInvoice_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "StripeCustomer"("organizationId", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksExpense" ADD CONSTRAINT "QuickBooksExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "StripeCustomer"("organizationId", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;
