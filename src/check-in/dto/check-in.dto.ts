import { CheckInActivityType } from './check-in-activity.type';
import { CheckInInterface } from './check-in.interface';

export class CheckInDto implements CheckInInterface {
  id?: number;
  roomScheduleId: string;
  // Id of the room schedule from external system
  // classRoom   ClassRoom @relation(fields: [classRoomId], references: [id])
  classRoomId: number;

  // user   User @relation(fields: [userId], references: [id])
  userId: number;

  checkInAt: Date;
  checkInType: CheckInActivityType;
}
