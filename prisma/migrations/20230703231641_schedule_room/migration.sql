/*
  Warnings:

  - You are about to drop the `Schedule` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Schedule";

-- CreateTable
CREATE TABLE "ScheduleRoom" (
    "scheduleId" UUID NOT NULL,
    "scheduleName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "ScheduleRoom_pkey" PRIMARY KEY ("scheduleId")
);
