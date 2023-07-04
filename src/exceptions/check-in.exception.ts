import { UnprocessableEntityException } from '@nestjs/common';

export class CheckInException extends UnprocessableEntityException {
  constructor(message: string) {
    super(message);
  }
}
