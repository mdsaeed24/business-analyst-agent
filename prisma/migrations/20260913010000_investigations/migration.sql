-- AlterTable
ALTER TABLE "Investigation" ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "findings" JSONB,
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "parameters" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_organizationId_inputHash_key" ON "Investigation"("organizationId", "inputHash");
