import { Injectable } from '@nestjs/common';
import { RoomActivitiesRepository } from './room-activities.repository';
import { ActivityFilterDto } from './dto/activity-filter.dto';

@Injectable()
export class RoomActivitiesService {
  constructor(private roomActivitiesRepository: RoomActivitiesRepository) {}
  async getCurrentActivities(activityFilter: ActivityFilterDto) {
    return await this.roomActivitiesRepository.findRoomActivities(
      activityFilter.roomId,
      activityFilter.scheduleId,
      activityFilter.date ?? new Date(),
    );
  }
}
