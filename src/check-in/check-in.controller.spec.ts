/* eslint-disable  @typescript-eslint/ban-ts-comment */

import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { UserAuthDto } from '../common/user-auth.dto';
import { CreateCheckInDto } from './dto/create-check-in.dto';

describe('CheckInController', () => {
  let checkInController: CheckInController;
  let checkInServiceMock: jest.Mocked<CheckInService>;

  beforeEach(() => {
    // Create a new instance of the CheckInController with mocked dependencies
    checkInServiceMock = {} as jest.Mocked<CheckInService>;
    checkInController = new CheckInController(checkInServiceMock);
  });

  describe('userCheckIn', () => {
    it('should call performCheckIn with the correct parameters', async () => {
      const user = {} as UserAuthDto;
      const checkInData = {} as CreateCheckInDto;

      // Mock the performCheckIn method of CheckInService
      checkInServiceMock.performCheckIn = jest.fn();

      // Call the userCheckIn method
      await checkInController.userCheckIn(user, checkInData);

      // Assert that the performCheckIn method was called with the correct parameters
      expect(checkInServiceMock.performCheckIn).toHaveBeenCalledWith(
        checkInData,
        user,
      );
    });

    it('should return a success message', async () => {
      const user = {} as UserAuthDto;
      const checkInData = {} as CreateCheckInDto;

      // Mock the performCheckIn method to resolve successfully
      checkInServiceMock.performCheckIn = jest.fn();

      // Call the userCheckIn method and store the returned value
      const result = await checkInController.userCheckIn(user, checkInData);

      // Assert that the result contains the success message
      expect(result).toEqual({ message: 'Check-in successful.' });
    });
  });
});
