import { CheckInActivityType } from './check-in-activity.type';

export class CheckInDto {
  id?: number;
  roomScheduleId: string;
  classRoomId: number;
  userId: number;
  checkInAt: Date;
  checkInType: CheckInActivityType;
}
