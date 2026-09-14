-- CreateEnum
CREATE TYPE "ExplanationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Explanation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ExplanationStatus" NOT NULL DEFAULT 'RUNNING',
    "requestId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Explanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Explanation_organizationId_investigationId_createdAt_idx" ON "Explanation"("organizationId", "investigationId", "createdAt");

-- CreateIndex
CREATE INDEX "Explanation_organizationId_requestedByMembershipId_idx" ON "Explanation"("organizationId", "requestedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Explanation_organizationId_investigationId_inputHash_key" ON "Explanation"("organizationId", "investigationId", "inputHash");

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_organizationId_investigationId_fkey" FOREIGN KEY ("organizationId", "investigationId") REFERENCES "Investigation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_organizationId_requestedByMembershipId_fkey" FOREIGN KEY ("organizationId", "requestedByMembershipId") REFERENCES "Membership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
