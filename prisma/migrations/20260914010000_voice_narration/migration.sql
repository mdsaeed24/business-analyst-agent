-- CreateEnum
CREATE TYPE "NarrationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AudioNarration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "explanationId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "transcriptVersion" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "NarrationStatus" NOT NULL DEFAULT 'RUNNING',
    "requestId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "audio" BYTEA,
    "errorCode" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AudioNarration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudioNarration_organizationId_explanationId_createdAt_idx" ON "AudioNarration"("organizationId", "explanationId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioNarration_organizationId_requestedByMembershipId_idx" ON "AudioNarration"("organizationId", "requestedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioNarration_organizationId_explanationId_inputHash_key" ON "AudioNarration"("organizationId", "explanationId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "Explanation_organizationId_id_key" ON "Explanation"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "AudioNarration" ADD CONSTRAINT "AudioNarration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioNarration" ADD CONSTRAINT "AudioNarration_organizationId_explanationId_fkey" FOREIGN KEY ("organizationId", "explanationId") REFERENCES "Explanation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioNarration" ADD CONSTRAINT "AudioNarration_organizationId_requestedByMembershipId_fkey" FOREIGN KEY ("organizationId", "requestedByMembershipId") REFERENCES "Membership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
