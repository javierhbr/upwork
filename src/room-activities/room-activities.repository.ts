import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomActivitiesRepository {
  constructor(private prisma: PrismaService) {}

  async findRoomActivities(roomId: number, scheduleId: string, date?: Date) {
    const result = await this.prisma.roomCheckIng.findMany({
      where: {
        classRoomId: roomId,
        roomScheduleId: scheduleId,
        checkInAt: date ?? new Date(),
      },
    });
    return result;
  }
}
