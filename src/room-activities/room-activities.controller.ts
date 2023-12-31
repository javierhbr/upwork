import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { RoomActivitiesService } from './room-activities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ActivityFilterDto } from './dto/activity-filter.dto';
import { CheckInActivityType } from '../check-in/dto/check-in-activity.type';
import { RoomActivityDto } from './dto/room-activity.dto';

@Controller('activities')
@ApiTags('activities')
export class RoomActivitiesController {
  constructor(private readonly roomActivitiesService: RoomActivitiesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiQuery({
    name: 'roomId',
    type: Number,
    description: 'QR code decrypted by the Scan device',
  })
  @ApiQuery({
    name: 'scheduleId',
    type: String,
    description: 'scheduleId',
  })
  @ApiQuery({
    name: 'date',
    type: Date,
    required: false,
    description: 'optional date format yyyy-mm-dd',
  })
  @ApiOkResponse({
    description: 'Company Custom profile fields',
    type: [RoomActivityDto],
  })
  async getCurrentActivities(
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        forbidNonWhitelisted: true,
      }),
    )
    activityFilter: ActivityFilterDto,
  ) {
    const activities = await this.roomActivitiesService.getCurrentActivities(
      activityFilter,
    );
    return { activities };
  }
}
