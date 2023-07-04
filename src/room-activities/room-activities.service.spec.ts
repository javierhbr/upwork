import { Test, TestingModule } from '@nestjs/testing';
import { RoomActivitiesService } from './room-activities.service';

describe('RoomActivitiesService', () => {
  let service: RoomActivitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoomActivitiesService],
    }).compile();

    service = module.get<RoomActivitiesService>(RoomActivitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
