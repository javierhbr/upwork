/* eslint-disable  @typescript-eslint/ban-ts-comment */
import { CheckInRepository } from './check-in.repository';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInActivityType } from './dto/check-in-activity.type';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    roomCheckIng: {
      create: jest.fn(),
    },
  })),
}));

describe('CheckInRepository', () => {
  let checkInRepository: CheckInRepository;
  let prismaServiceMock: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prismaServiceMock = new PrismaService() as jest.Mocked<PrismaService>;
    checkInRepository = new CheckInRepository(prismaServiceMock);
  });

  it('should save check-in data', async () => {
    const checkInData = {
      roomScheduleId: 'schedule-id',
      classRoomId: 100,
      checkInAt: new Date(),
      userId: 1,
      checkInType: CheckInActivityType.ON_TIME,
    };
    // @ts-ignore
    prismaServiceMock.roomCheckIng.create.mockResolvedValue({});
    await checkInRepository.saveCheckIn(checkInData);
    expect(prismaServiceMock.roomCheckIng.create).toHaveBeenCalledWith({
      data: checkInData,
    });
  });
});
