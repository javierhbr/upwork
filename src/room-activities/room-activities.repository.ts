import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { RoomCheckIng } from '@prisma/client';

@Injectable()
export class RoomActivitiesRepository {
  constructor(private prisma: PrismaService) {}

  async findRoomActivities(roomId: number, scheduleId: string, date: Date) {
    const { yesterday, tomorrow } = this.findDates(date.toISOString());

    const result: RoomCheckIng[] = await this.prisma.roomCheckIng.findMany({
      where: {
        classRoomId: roomId,
        roomScheduleId: scheduleId,
        checkInAt: {
          lte: tomorrow,
          gte: yesterday,
        },
      },
    });
    return result;
  }

  private findDates(dateIsoString: string) {
    let yesterday = DateTime.fromISO(dateIsoString);
    let tomorrow = DateTime.fromISO(dateIsoString);
    tomorrow = tomorrow.set({ hour: 24, minute: 59, second: 59 });
    yesterday = yesterday.set({ hour: 0, minute: 0, second: 0 });
    return { yesterday: yesterday.toJSDate(), tomorrow: tomorrow.toJSDate() };
  }
}
