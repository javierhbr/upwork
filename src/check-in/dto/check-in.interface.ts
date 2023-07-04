import { CheckInActivityType } from './check-in-activity.type';

export interface CheckInInterface {
  id?: number;
  roomScheduleId: string;
  // Id of the room schedule from external system
  // classRoom   ClassRoom @relation(fields: [classRoomId], references: [id])
  classRoomId: number;

  // user   User @relation(fields: [userId], references: [id])
  userId?: number;

  checkInAt?: Date;
  checkInType?: any;
}
