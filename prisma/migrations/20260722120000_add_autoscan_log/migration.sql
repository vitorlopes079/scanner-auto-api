CREATE TABLE "AutoscanLog" (
    "id" TEXT NOT NULL,
    "autoscanId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoscanLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutoscanLog_autoscanId_createdAt_idx" ON "AutoscanLog"("autoscanId", "createdAt");
CREATE INDEX "AutoscanLog_eventType_createdAt_idx" ON "AutoscanLog"("eventType", "createdAt");
