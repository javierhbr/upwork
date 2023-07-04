import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CheckInActivity } from '.prisma/client';
import { DateTime } from 'luxon';

// initialize the Prisma Client
const prisma = new PrismaClient();

const roundsOfHashing = 10;

async function main() {
  // create two dummy users
  const globalPwd = await bcrypt.hash('zaq1@WSX', roundsOfHashing);

  const javierUser = await prisma.user.upsert({
    where: { email: 'javier@upwork.com' },
    update: {
      password: globalPwd,
    },
    create: {
      email: 'javier@upwork.com',
      name: 'Javier Benavides',
      password: globalPwd,
    },
  });

  const johnUser = await prisma.user.upsert({
    where: { email: 'john@upwork.com' },
    update: {
      password: globalPwd,
    },
    create: {
      email: 'john@upwork.com',
      name: 'John Smith',
      password: globalPwd,
    },
  });

  const jackUser = await prisma.user.upsert({
    where: { email: 'jack@upwork.com' },
    update: {
      password: globalPwd,
    },
    create: {
      email: 'jack@upwork.com',
      name: 'Jack Sparrow',
      password: globalPwd,
    },
  });

  const lab1MorningSched = await prisma.scheduleRoom.upsert({
    where: { scheduleId: 'bfedd044-381a-44f0-8c6d-ca9fb9aabf0b' },
    update: {},
    create: {
      scheduleId: 'bfedd044-381a-44f0-8c6d-ca9fb9aabf0b',
      scheduleName: 'Lab 1 Morning',
      startTime: '09:00',
      totalMin: 60,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: '588ca14a-7482-4610-a816-ba3be58410f7' },
    update: {},
    create: {
      scheduleId: '588ca14a-7482-4610-a816-ba3be58410f7',
      scheduleName: 'Lab 2 Morning',
      startTime: '09:00',
      totalMin: 90,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: '83ccd46c-3894-42c7-827c-484edef1022c' },
    update: {},
    create: {
      scheduleId: '83ccd46c-3894-42c7-827c-484edef1022c',
      scheduleName: 'Lab 3 Morning',
      startTime: '09:00',
      totalMin: 90,
    },
  });

  const lab1NoonSched = await prisma.scheduleRoom.upsert({
    where: { scheduleId: '2ade155c-a851-4574-9abe-2c1dd6d20878' },
    update: {},
    create: {
      scheduleId: '2ade155c-a851-4574-9abe-2c1dd6d20878',
      scheduleName: 'Lab 1 Noon',
      startTime: '12:00',
      totalMin: 90,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: '6b5a55ab-6afc-461c-b984-a2cbfe5b260f' },
    update: {},
    create: {
      scheduleId: '6b5a55ab-6afc-461c-b984-a2cbfe5b260f',
      scheduleName: 'Lab 2 Noon',
      startTime: '12:00',
      totalMin: 90,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: '3176c97b-b3b0-4008-b337-1456c5ff4761' },
    update: {},
    create: {
      scheduleId: '3176c97b-b3b0-4008-b337-1456c5ff4761',
      scheduleName: 'Lab 3 Noon',
      startTime: '12:00',
      totalMin: 90,
    },
  });

  const lab1EveningSched = await prisma.scheduleRoom.upsert({
    where: { scheduleId: '3625ff92-f3d3-4916-9403-a449b1c829ef' },
    update: {},
    create: {
      scheduleId: '3625ff92-f3d3-4916-9403-a449b1c829ef',
      scheduleName: 'Lab 1 Evening',
      startTime: '17:00',
      totalMin: 90,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: 'e2c763e0-08e4-4b75-b720-09b11c65d0db' },
    update: {},
    create: {
      scheduleId: 'e2c763e0-08e4-4b75-b720-09b11c65d0db',
      scheduleName: 'Lab 2 Evening',
      startTime: '17:00',
      totalMin: 90,
    },
  });

  await prisma.scheduleRoom.upsert({
    where: { scheduleId: 'd4aa75cc-6d68-4592-82ae-34bad3e2f358' },
    update: {},
    create: {
      scheduleId: 'd4aa75cc-6d68-4592-82ae-34bad3e2f358',
      scheduleName: 'Lab 3 Evening',
      startTime: '17:00',
      totalMin: 120,
    },
  });

  await prisma.classRoom.upsert({
    where: { id: 1000 },
    update: {},
    create: {
      id: 1000,
      name: 'Lab room 1',
      description: 'Lab room Linux env',
    },
  });

  await prisma.classRoom.upsert({
    where: { id: 1001 },
    update: {},
    create: {
      id: 1001,
      name: 'Lab room 2',
      description: 'Lab room Win env',
    },
  });

  await prisma.classRoom.upsert({
    where: { id: 1002 },
    update: {},
    create: {
      id: 1002,
      name: 'Lab room 3',
      description: 'Lab room Apple env',
    },
  });

  await prisma.classRoom.upsert({
    where: { id: 1002 },
    update: {},
    create: {
      id: 1002,
      name: 'Lab room 3',
      description: 'Lab room Apple env',
    },
  });

  let times = mockCheckInAtDate(lab1EveningSched.startTime);
  await prisma.roomCheckIng.create({
    data: {
      roomScheduleId: lab1EveningSched.scheduleId,
      classRoomId: 1000,
      userId: javierUser.id,
      checkInAt: times[0],
      checkInType: times[1],
    },
  });

  times = mockCheckInAtDate(lab1EveningSched.startTime);
  await prisma.roomCheckIng.create({
    data: {
      roomScheduleId: lab1MorningSched.scheduleId,
      classRoomId: 1000,
      userId: javierUser.id,
      checkInAt: times[0],
      checkInType: times[1],
    },
  });

  times = mockCheckInAtDate(lab1NoonSched.startTime);
  await prisma.roomCheckIng.create({
    data: {
      roomScheduleId: lab1NoonSched.scheduleId,
      classRoomId: 1000,
      userId: javierUser.id,
      checkInAt: times[0],
      checkInType: times[1],
    },
  });
  console.log({ javierUser, johnUser, jackUser, lab1MorningSched });
}

function mockCheckInAtDate(startTime: string): [Date, any] {
  let startScheduleTime = DateTime.utc();
  const time = startTime.split(':');
  startScheduleTime = startScheduleTime.set({
    hour: Number(time[0]),
    minute: Number(time[1]),
    second: 0,
  });
  return [startScheduleTime.toJSDate(), CheckInActivity.ON_TIME];
}
// execute the main function
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // close the Prisma Client at the end
    await prisma.$disconnect();
  });
