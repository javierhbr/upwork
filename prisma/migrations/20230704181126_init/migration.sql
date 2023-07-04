-- CreateEnum
CREATE TYPE "CheckInActivity" AS ENUM ('ON_TIME', 'LATE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassRoom" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ClassRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomCheckIng" (
    "id" SERIAL NOT NULL,
    "roomScheduleId" TEXT NOT NULL,
    "classRoomId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInType" "CheckInActivity" NOT NULL DEFAULT 'ON_TIME',

    CONSTRAINT "RoomCheckIng_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRoom" (
    "scheduleId" UUID NOT NULL,
    "scheduleName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "totalMin" INTEGER NOT NULL DEFAULT 90,

    CONSTRAINT "ScheduleRoom_pkey" PRIMARY KEY ("scheduleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RoomCheckIng_roomScheduleId_classRoomId_userId_checkInAt_key" ON "RoomCheckIng"("roomScheduleId", "classRoomId", "userId", "checkInAt");

-- AddForeignKey
ALTER TABLE "RoomCheckIng" ADD CONSTRAINT "RoomCheckIng_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCheckIng" ADD CONSTRAINT "RoomCheckIng_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
