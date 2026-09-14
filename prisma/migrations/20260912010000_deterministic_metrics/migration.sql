-- CreateEnum
CREATE TYPE "MetricResultStatus" AS ENUM ('COMPUTED', 'NO_DATA');

-- AlterTable
ALTER TABLE "MetricValue" ADD COLUMN     "calculationDetails" JSONB,
ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "status" "MetricResultStatus" NOT NULL DEFAULT 'COMPUTED',
ADD COLUMN     "syntheticDataset" TEXT,
ALTER COLUMN "value" DROP NOT NULL;

-- Undefined ratios/averages must not be represented as numeric zero.
ALTER TABLE "MetricValue" ADD CONSTRAINT "MetricValue_status_value_check"
CHECK (("status" = 'COMPUTED' AND "value" IS NOT NULL) OR ("status" = 'NO_DATA' AND "value" IS NULL));
