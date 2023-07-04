import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';

@Injectable()
export class CheckInRepository {
  constructor(private prisma: PrismaService) {}

  async saveCheckIn(checkInData: CreateCheckInDto) {
    return this.prisma.roomCheckIng.create({
      data: checkInData,
    });
  }
}
