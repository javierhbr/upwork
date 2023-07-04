/* eslint-disable  @typescript-eslint/ban-ts-comment */
import { RoomActivitiesService } from './room-activities.service';
import { RoomActivitiesRepository } from './room-activities.repository';
import { CheckInActivityType } from '../check-in/dto/check-in-activity.type';

describe('RoomActivitiesService', () => {
  let roomActivitiesService: RoomActivitiesService;
  let roomActivitiesRepositoryMock: jest.Mocked<RoomActivitiesRepository>;

  beforeEach(() => {
    // @ts-ignore
    roomActivitiesRepositoryMock = {
      findRoomActivities: jest.fn(),
    } as jest.Mocked<RoomActivitiesRepository>;

    roomActivitiesService = new RoomActivitiesService(
      roomActivitiesRepositoryMock,
    );
  });

  describe('getCurrentActivities', () => {
    it('should get current activities using the provided filter', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const date = new Date();

      const filter = {
        roomId,
        scheduleId,
        date,
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
      roomActivitiesRepositoryMock.findRoomActivities.mockResolvedValue(
        activities,
      );

      const result = await roomActivitiesService.getCurrentActivities(filter);

      expect(result).toEqual(activities);
      expect(
        roomActivitiesRepositoryMock.findRoomActivities,
      ).toHaveBeenCalledWith(roomId, scheduleId, date);
    });

    it('should use the current date if no date is provided in the filter', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const currentDate = new Date();

      const filter = {
        roomId,
        scheduleId,
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
      roomActivitiesRepositoryMock.findRoomActivities.mockResolvedValue(
        activities,
      );

      const result = await roomActivitiesService.getCurrentActivities(filter);

      expect(result).toEqual(activities);
      expect(
        roomActivitiesRepositoryMock.findRoomActivities,
      ).toHaveBeenCalledWith(roomId, scheduleId, currentDate);
    });

    it('should throw an error if the repository throws an error', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const date = new Date();

      const filter = {
        roomId,
        scheduleId,
        date,
      };

      const errorMessage = 'Internal server error';
      roomActivitiesRepositoryMock.findRoomActivities.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        roomActivitiesService.getCurrentActivities(filter),
      ).rejects.toThrowError(errorMessage);
      expect(
        roomActivitiesRepositoryMock.findRoomActivities,
      ).toHaveBeenCalledWith(roomId, scheduleId, date);
    });
  });
});
