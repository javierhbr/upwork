import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckInActivityType } from '../../check-in/dto/check-in-activity.type';

export class ActivityFilterDto {
  @IsNumber()
  @Type(() => Number)
  roomId: number;

  @IsNotEmpty()
  @IsUUID()
  scheduleId: string;

  @IsOptional()
  @IsDate()
  @Type((type) => Date)
  date?: Date;

  @IsOptional()
  @IsEnum([CheckInActivityType.LATE, CheckInActivityType.ON_TIME])
  checkInType?: CheckInActivityType;
}
