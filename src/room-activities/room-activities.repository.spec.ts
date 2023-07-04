/* eslint-disable  @typescript-eslint/ban-ts-comment */
import { RoomActivitiesRepository } from './room-activities.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('RoomActivitiesRepository', () => {
  let roomActivitiesRepository: RoomActivitiesRepository;
  let prismaServiceMock: jest.Mocked<PrismaService>;

  beforeEach(() => {
    // @ts-ignore
    prismaServiceMock = {
      roomCheckIng: {
        findMany: jest.fn(),
      },
    } as jest.Mocked<PrismaService>;

    roomActivitiesRepository = new RoomActivitiesRepository(prismaServiceMock);
  });

  describe('findRoomActivities', () => {
    it('should fetch room activities for a given roomId, scheduleId, and date', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const date = new Date();

      const result = [{ id: 1, checkInAt: new Date() }];
      // @ts-ignore
      prismaServiceMock.roomCheckIng.findMany.mockResolvedValue(result);

      const activities = await roomActivitiesRepository.findRoomActivities(
        roomId,
        scheduleId,
        date,
      );

      expect(activities).toEqual(result);
      expect(prismaServiceMock.roomCheckIng.findMany).toHaveBeenCalledWith({
        where: {
          classRoomId: roomId,
          roomScheduleId: scheduleId,
          checkInAt: {
            lte: expect.any(Date),
            gte: expect.any(Date),
          },
        },
      });
    });

    it('should return an empty array if no room activities are found', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const date = new Date();

      // @ts-ignore
      prismaServiceMock.roomCheckIng.findMany.mockResolvedValue([]);

      const activities = await roomActivitiesRepository.findRoomActivities(
        roomId,
        scheduleId,
        date,
      );

      expect(activities).toEqual([]);
      expect(prismaServiceMock.roomCheckIng.findMany).toHaveBeenCalledWith({
        where: {
          classRoomId: roomId,
          roomScheduleId: scheduleId,
          checkInAt: {
            lte: expect.any(Date),
            gte: expect.any(Date),
          },
        },
      });
    });

    it('should throw an error if the Prisma service throws an error', async () => {
      const roomId = 1;
      const scheduleId = 'schedule-id';
      const date = new Date();

      const errorMessage = 'Internal server error';
      // @ts-ignore
      prismaServiceMock.roomCheckIng.findMany.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        roomActivitiesRepository.findRoomActivities(roomId, scheduleId, date),
      ).rejects.toThrowError(errorMessage);
      expect(prismaServiceMock.roomCheckIng.findMany).toHaveBeenCalledWith({
        where: {
          classRoomId: roomId,
          roomScheduleId: scheduleId,
          checkInAt: {
            lte: expect.any(Date),
            gte: expect.any(Date),
          },
        },
      });
    });
  });
});
