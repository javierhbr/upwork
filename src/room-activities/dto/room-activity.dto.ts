import { ApiProperty } from '@nestjs/swagger';

export class RoomActivityDto {
  @ApiProperty()
  id: number;
  @ApiProperty()
  roomScheduleId: string;
  @ApiProperty()
  classRoomId: number;
  @ApiProperty()
  userId: number;
  @ApiProperty()
  checkInAt: Date;
  @ApiProperty()
  checkInType: string;
}
