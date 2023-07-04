import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CheckInModule } from './check-in/check-in.module';
import { RoomActivitiesModule } from './room-activities/room-activities.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    CheckInModule,
    RoomActivitiesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
