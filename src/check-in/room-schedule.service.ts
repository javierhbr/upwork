import { Injectable } from '@nestjs/common';
import { ScheduleDetailsDto } from './dto/schedule-details.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInException } from '../exceptions/check-in.exception';

@Injectable()
export class RoomScheduleService {
  constructor(private prisma: PrismaService) {}

  /**
   * mocking any sort of source of data about room schedule. it could be REST, GraphQL, DB, etc.
   * @param scheduleId
   * @private
   */
  async getScheduleDetails(scheduleId: string): Promise<ScheduleDetailsDto> {
    const schedule = await this.prisma.scheduleRoom.findUnique({
      where: { scheduleId },
    });
    if (!schedule) {
      throw new CheckInException('Schedule details not found');
    }

    return schedule as unknown as ScheduleDetailsDto;
  }
}
