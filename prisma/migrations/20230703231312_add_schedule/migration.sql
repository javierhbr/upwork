-- CreateTable
CREATE TABLE "Schedule" (
    "scheduleId" UUID NOT NULL,
    "scheduleName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("scheduleId")
);
