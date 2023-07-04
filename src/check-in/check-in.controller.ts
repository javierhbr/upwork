import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user.decorator';
import { UserAuthDto } from '../common/user-auth.dto';
import { CreateCheckInDto } from './dto/create-check-in.dto';

@Controller('check-in')
@ApiTags('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async userCheckIn(
    @AuthUser() user: UserAuthDto,
    @Body() checkInData: CreateCheckInDto,
  ) {
    await this.checkInService.performCheckIn(checkInData, user);
    return { message: 'Check-in successful.' };
  }
}
