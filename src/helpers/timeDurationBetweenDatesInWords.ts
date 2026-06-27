const timeDurationBetweenDatesInWords = (date1: Date, date2: Date): string => {
  const absoluteDifferenceInMs = Math.floor(Math.abs(date1.getTime() - date2.getTime()));

  const msInSecond = 1000;
  const msInMinute = msInSecond * 60;
  const msInHour = msInMinute * 60;
  const msInDay = msInHour * 24;

  const spentDays = Math.floor(absoluteDifferenceInMs / msInDay);
  const diffWithoutDays = absoluteDifferenceInMs - spentDays * msInDay;
  const spentHours = Math.floor(diffWithoutDays / msInHour);
  const diffWithoutHours = diffWithoutDays - spentHours * msInHour;
  const spentMinutes = Math.floor(diffWithoutHours / msInMinute);
  const diffWithoutMinutes = diffWithoutHours - spentMinutes * msInMinute;
  const spentSeconds = Math.floor(diffWithoutMinutes / msInSecond);
  const spentMs = diffWithoutMinutes - spentSeconds * msInSecond;

  const unitDefinitions: Array<{ value: number; label: string }> = [
    { value: spentDays, label: 'd' },
    { value: spentHours, label: 'h' },
    { value: spentMinutes, label: 'min' },
    { value: spentSeconds, label: 'sec' },
    { value: spentMs, label: 'ms' },
  ];

  let foundNonZero = false;
  const parts: string[] = [];
  Array.from(unitDefinitions).forEach(({ value, label }) => {
    if (value !== 0 || foundNonZero) {
      foundNonZero = true;
      parts.push(`${value}${label}`);
    }
  });

  return foundNonZero ? parts.join(' ') : '0ms';
};

export default timeDurationBetweenDatesInWords;
