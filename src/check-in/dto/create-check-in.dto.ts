import { CheckInActivityType } from './check-in-activity.type';
import { IsDate, IsEnum, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCheckInDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  checkInAt?: Date;

  @ApiPropertyOptional({
    enum: [CheckInActivityType.LATE, CheckInActivityType.ON_TIME],
  })
  @IsOptional()
  @IsEnum([CheckInActivityType.LATE, CheckInActivityType.ON_TIME])
  checkInType: CheckInActivityType;

  @ApiProperty()
  @IsNumber()
  classRoomId: number;

  @ApiProperty()
  @IsUUID()
  roomScheduleId: string;

  @ApiPropertyOptional()
  @IsNumber()
  userId: number;
}
