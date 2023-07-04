-- CreateEnum
CREATE TYPE "CheckInActivity" AS ENUM ('ON_TIME', 'LATE');

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
    "roomScheduleId" INTEGER NOT NULL,
    "classRoomId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInType" "CheckInActivity" NOT NULL DEFAULT 'ON_TIME',

    CONSTRAINT "RoomCheckIng_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RoomCheckIng" ADD CONSTRAINT "RoomCheckIng_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCheckIng" ADD CONSTRAINT "RoomCheckIng_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
