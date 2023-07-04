import { Injectable, Logger } from '@nestjs/common';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UserAuthDto } from '../common/user-auth.dto';
import { CheckInRepository } from './check-in.repository';
import { CheckInException } from '../exceptions/check-in.exception';
import { RoomScheduleService } from './room-schedule.service';
import { ScheduleDetailsDto } from './dto/schedule-details.dto';
import { minutesDifference } from '../common/dates-utils';
import { CheckInActivityType } from './dto/check-in-activity.type';
import { DateTime } from 'luxon';

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);
  private intervalMinutes: number;
  constructor(
    private checkInRepository: CheckInRepository,
    private scheduleService: RoomScheduleService,
  ) {
    this.intervalMinutes = Number(process.env.INTERVAL_MINUTES ?? 15);
  }

  async performCheckIn(checkInData: CreateCheckInDto, user: UserAuthDto) {
    checkInData.checkInAt = checkInData.checkInAt ?? DateTime.utc().toJSDate();
    this.validateUser(user, checkInData);
    const schedule = await this.findSchedule(checkInData.roomScheduleId);
    this.calculateCheckInType(checkInData, schedule);

    try {
      await this.checkInRepository.saveCheckIn(checkInData);
    } catch (e) {
      if (e.code === 'P2002') {
        throw new CheckInException('User has been checked-in previously');
      }
      this.logger.error('performCheckIn error', e);
    }
  }

  private validateUser(user: UserAuthDto, checkInData: CreateCheckInDto) {
    if (user.id !== checkInData.userId) {
      throw new CheckInException('User is not allowed to perform this action');
    }
  }

  private async findSchedule(
    roomScheduleId: string,
  ): Promise<ScheduleDetailsDto> {
    const schedule = await this.scheduleService.getScheduleDetails(
      roomScheduleId,
    );
    if (!schedule) {
      throw new CheckInException('Schedule not found for this room');
    }
    return schedule;
  }

  private calculateCheckInType(
    checkInData: CreateCheckInDto,
    schedule: ScheduleDetailsDto,
  ) {
    const startScheduleTime = new Date();
    const time = schedule.startTime.split(':');
    startScheduleTime.setHours(Number(time[0]));
    startScheduleTime.setMinutes(Number(time[1]));
    startScheduleTime.setSeconds(0);

    const diffMin = minutesDifference(startScheduleTime, checkInData.checkInAt);
    if (diffMin >= schedule.totalMin) {
      throw new CheckInException('Cant check In, your super late');
    } else if (diffMin >= this.intervalMinutes) {
      checkInData.checkInType = CheckInActivityType.LATE;
    } else {
      checkInData.checkInType = CheckInActivityType.ON_TIME;
    }
  }
}
