import { Module } from '@nestjs/common';
import { RoomActivitiesService } from './room-activities.service';
import { RoomActivitiesController } from './room-activities.controller';
import { RoomActivitiesRepository } from './room-activities.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  controllers: [RoomActivitiesController],
  providers: [RoomActivitiesService, RoomActivitiesRepository],
  imports: [PrismaModule],
})
export class RoomActivitiesModule {}
