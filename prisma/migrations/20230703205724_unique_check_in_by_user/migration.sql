/*
  Warnings:

  - A unique constraint covering the columns `[roomScheduleId,classRoomId,userId,checkInAt]` on the table `RoomCheckIng` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "RoomCheckIng_roomScheduleId_classRoomId_userId_checkInAt_key" ON "RoomCheckIng"("roomScheduleId", "classRoomId", "userId", "checkInAt");
