import { Test, TestingModule } from '@nestjs/testing';
import { RoomActivitiesController } from './room-activities.controller';
import { RoomActivitiesService } from './room-activities.service';

describe('RoomActivitiesController', () => {
  let controller: RoomActivitiesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomActivitiesController],
      providers: [RoomActivitiesService],
    }).compile();

    controller = module.get<RoomActivitiesController>(RoomActivitiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
