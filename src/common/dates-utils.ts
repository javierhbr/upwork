export function minutesDifference(dateFrom: Date, dateTo: Date) {
  const differenceInMilliseconds = dateTo.getTime() - dateFrom.getTime();
  return Math.floor(differenceInMilliseconds / (1000 * 60));
}
