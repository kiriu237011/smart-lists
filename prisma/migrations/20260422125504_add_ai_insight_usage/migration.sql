-- CreateTable
CREATE TABLE "AiInsightUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiInsightUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInsightUsage_userId_date_key" ON "AiInsightUsage"("userId", "date");

-- AddForeignKey
ALTER TABLE "AiInsightUsage" ADD CONSTRAINT "AiInsightUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
