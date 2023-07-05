import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}
