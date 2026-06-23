export default (number: number): string => {
  if (number === Infinity || number === -Infinity) {
    return `${number}`;
  }
  const intPartNumber = Math.floor(number);
  const notIntPartNumber = number - intPartNumber;
  const notIntPartString = `${notIntPartNumber}`.replace(/^0/, '');
  const intPartString = `${intPartNumber}`;
  let beautifulIntPart = '';
  for (let i = 1; i <= intPartString.length; i += 1) {
    if ((i % 3) || !(intPartString.length - i)) {
      beautifulIntPart = `${intPartString[intPartString.length - i]}${beautifulIntPart}`;
    } else {
      beautifulIntPart = ` ${intPartString[intPartString.length - i]}${beautifulIntPart}`;
    }
  }
  return `${beautifulIntPart}${notIntPartString}`;
};
