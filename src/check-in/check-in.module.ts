import { Module } from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { CheckInController } from './check-in.controller';
import { CheckInRepository } from './check-in.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomScheduleService } from './room-schedule.service';

@Module({
  controllers: [CheckInController],
  providers: [CheckInService, CheckInRepository, RoomScheduleService],
  imports: [PrismaModule],
})
export class CheckInModule {}
