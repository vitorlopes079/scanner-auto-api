-- CreateTable
CREATE TABLE "AutoscanImportBatchLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoscanImportBatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoscanImportBatchLog_createdAt_idx" ON "AutoscanImportBatchLog"("createdAt");
