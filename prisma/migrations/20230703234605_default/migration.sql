/*
  Warnings:

  - You are about to drop the column `endTime` on the `ScheduleRoom` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ScheduleRoom" DROP COLUMN "endTime",
ADD COLUMN     "totalMin" INTEGER NOT NULL DEFAULT 90;
