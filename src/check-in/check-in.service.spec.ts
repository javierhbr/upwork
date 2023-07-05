/* eslint-disable  @typescript-eslint/ban-ts-comment */
import { CheckInService } from './check-in.service';
import { CheckInRepository } from './check-in.repository';
import { RoomScheduleService } from './room-schedule.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UserAuthDto } from '../common/user-auth.dto';
import { CheckInActivityType } from './dto/check-in-activity.type';
import { DateTime } from 'luxon';

describe('CheckInService', () => {
  let checkInService: CheckInService;
  let checkInRepositoryMock: jest.Mocked<CheckInRepository>;
  let scheduleServiceMock: jest.Mocked<RoomScheduleService>;

  beforeEach(() => {
    // @ts-ignore
    checkInRepositoryMock = {
      saveCheckIn: jest.fn(),
    } as jest.Mocked<CheckInRepository>;

    // @ts-ignore
    scheduleServiceMock = {
      getScheduleDetails: jest.fn(),
    } as jest.Mocked<RoomScheduleService>;

    checkInService = new CheckInService(
      checkInRepositoryMock,
      scheduleServiceMock,
    );
  });

  describe('performCheckIn', () => {
    it('should perform check-in and save check-in data', async () => {
      const checkInDate = DateTime.local(2023, 7, 4, 9, 30).toJSDate();
      const checkInData: CreateCheckInDto = {
        roomScheduleId: 'schedule-id',
        classRoomId: 100,
        checkInAt: checkInDate,
        userId: 1,
        checkInType: CheckInActivityType.ON_TIME,
      };

      const user: UserAuthDto = {
        id: 1,
        email: 'john@example.com',
        name: 'john',
      };

      const scheduleDetails = {
        scheduleId: 'scheduleId',
        scheduleName: 'scheduleName',
        startTime: '09:00',
        totalMin: 60,
      };

      scheduleServiceMock.getScheduleDetails.mockResolvedValue(scheduleDetails);

      await checkInService.performCheckIn(checkInData, user);

      expect(checkInData.checkInAt).toBeInstanceOf(Date);
      expect(scheduleServiceMock.getScheduleDetails).toHaveBeenCalledWith(
        checkInData.roomScheduleId,
      );
      expect(checkInRepositoryMock.saveCheckIn).toHaveBeenCalledWith(
        checkInData,
      );
    });

    it('should throw an error if the user is not allowed to perform check-in', async () => {
      const checkInDate = DateTime.local(2023, 7, 4, 9, 30).toJSDate();
      const checkInData: CreateCheckInDto = {
        roomScheduleId: 'schedule-id',
        classRoomId: 100,
        checkInAt: checkInDate,
        userId: 1,
        checkInType: CheckInActivityType.ON_TIME,
      };

      const user: UserAuthDto = {
        id: 2,
        email: 'john@example.com',
        name: 'john',
      };

      await expect(
        checkInService.performCheckIn(checkInData, user),
      ).rejects.toThrowError('User is not allowed to perform this action');

      expect(scheduleServiceMock.getScheduleDetails).not.toHaveBeenCalled();
      expect(checkInRepositoryMock.saveCheckIn).not.toHaveBeenCalled();
    });

    it('should throw an error if the schedule is not found', async () => {
      const checkInDate = DateTime.local(2023, 7, 4, 9, 30).toJSDate();
      const checkInData: CreateCheckInDto = {
        roomScheduleId: 'schedule-id-not-found',
        classRoomId: 100,
        checkInAt: checkInDate,
        userId: 1,
        checkInType: CheckInActivityType.ON_TIME,
      };

      const user: UserAuthDto = {
        id: 1,
        email: 'john@example.com',
        name: 'john',
      };

      scheduleServiceMock.getScheduleDetails.mockResolvedValue(null);

      await expect(
        checkInService.performCheckIn(checkInData, user),
      ).rejects.toThrowError('Schedule not found for this room');

      expect(scheduleServiceMock.getScheduleDetails).toHaveBeenCalledWith(
        checkInData.roomScheduleId,
      );
      expect(checkInRepositoryMock.saveCheckIn).not.toHaveBeenCalled();
    });

    it('should throw an error if the check-in type is "Cant check In, youre super late"', async () => {
      const checkInDate = DateTime.local(2023, 7, 4, 13, 30).toJSDate();
      const checkInData: CreateCheckInDto = {
        roomScheduleId: 'schedule-id',
        classRoomId: 100,
        checkInAt: checkInDate,
        userId: 1,
        checkInType: CheckInActivityType.ON_TIME,
      };

      const user: UserAuthDto = {
        id: 1,
        email: 'john@example.com',
        name: 'john',
      };

      const scheduleDetails = {
        scheduleId: 'scheduleId',
        scheduleName: 'scheduleName',
        startTime: '09:00',
        totalMin: 60,
      };

      scheduleServiceMock.getScheduleDetails.mockResolvedValue(scheduleDetails);

      await expect(
        checkInService.performCheckIn(checkInData, user),
      ).rejects.toThrowError('Cant check In, your super late');

      expect(scheduleServiceMock.getScheduleDetails).toHaveBeenCalledWith(
        checkInData.roomScheduleId,
      );
      expect(checkInRepositoryMock.saveCheckIn).not.toHaveBeenCalled();
    });

    it('should handle and log the error if saving check-in data throws an error', async () => {
      const checkInDate = DateTime.local(2023, 7, 4, 9, 20).toJSDate();
      const checkInData: CreateCheckInDto = {
        roomScheduleId: 'schedule-id',
        classRoomId: 100,
        checkInAt: checkInDate,
        userId: 1,
        checkInType: CheckInActivityType.ON_TIME,
      };

      const user: UserAuthDto = {
        id: 1,
        email: 'john@example.com',
        name: 'john',
      };
      const scheduleDetails = {
        scheduleId: 'scheduleId',
        scheduleName: 'scheduleName',
        startTime: '09:00',
        totalMin: 60,
      };

      scheduleServiceMock.getScheduleDetails.mockResolvedValue(scheduleDetails);
      checkInRepositoryMock.saveCheckIn.mockImplementation(() => {
        const error = new Error('Failed to save check-in data');
        (error as any).code = 'P2002';
        return Promise.reject(error);
      });
      await expect(
        checkInService.performCheckIn(checkInData, user),
      ).rejects.toThrowError('User has been checked-in previously');

      expect(scheduleServiceMock.getScheduleDetails).toHaveBeenCalledWith(
        checkInData.roomScheduleId,
      );
      expect(checkInRepositoryMock.saveCheckIn).toHaveBeenCalledWith(
        checkInData,
      );
    });
  });
});
