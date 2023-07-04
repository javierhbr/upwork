/* eslint-disable  @typescript-eslint/ban-ts-comment */
import { RoomActivitiesController } from './room-activities.controller';
import { RoomActivitiesService } from './room-activities.service';
import { CheckInActivityType } from '../check-in/dto/check-in-activity.type';
import { ActivityFilterDto } from './dto/activity-filter.dto';

describe('RoomActivitiesController', () => {
  let roomActivitiesController: RoomActivitiesController;
  let roomActivitiesServiceMock: jest.Mocked<RoomActivitiesService>;

  beforeEach(() => {
    // @ts-ignore
    roomActivitiesServiceMock = {
      getCurrentActivities: jest.fn(),
    } as jest.Mocked<RoomActivitiesService>;

    roomActivitiesController = new RoomActivitiesController(
      roomActivitiesServiceMock,
    );
  });

  describe('getCurrentActivities', () => {
    it('should get current activities using the provided filter', async () => {
      const filter: ActivityFilterDto = {
        roomId: 1,
        scheduleId: 'schedule-id',
        date: new Date(),
        checkInType: CheckInActivityType.LATE,
      };

      const activities = [
        {
          id: 1,
          classRoomId: 1000,
          roomScheduleId: 'scheduleId',
          userId: 1,
          checkInAt: new Date(),
          checkInType: CheckInActivityType.LATE,
        },
      ];
      roomActivitiesServiceMock.getCurrentActivities.mockResolvedValue(
        activities,
      );

      const result = await roomActivitiesController.getCurrentActivities(
        filter,
      );

      expect(result).toEqual({ activities });
      expect(
        roomActivitiesServiceMock.getCurrentActivities,
      ).toHaveBeenCalledWith(filter);
    });

    it('should throw an error if the service throws an error', async () => {
      const filter: ActivityFilterDto = {
        roomId: 1,
        scheduleId: 'schedule-id',
        date: new Date(),
        checkInType: CheckInActivityType.ON_TIME,
      };

      const errorMessage = 'Internal server error';
      roomActivitiesServiceMock.getCurrentActivities.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        roomActivitiesController.getCurrentActivities(filter),
      ).rejects.toThrowError(errorMessage);
      expect(
        roomActivitiesServiceMock.getCurrentActivities,
      ).toHaveBeenCalledWith(filter);
    });
  });
});
