const checkArrayIsNotEmpty = (supposedlyArray: any): boolean => {
  if (!Array.isArray(supposedlyArray) || supposedlyArray.length === 0) {
    return false;
  }
  return true;
};

function modeSingle(arr: Status[]): Status {
  // Returns the mode of an array, works exactly like Excel MODE.SINGLE,
  // i.e. returns the FIRST mode if there are several ones.
  // Without this "order" trick it would return the smallest one
  // (the first key of the "count" object, and keys in objects are sorted
  // in ascending order).

  const count: { [key: string]: number } = {};
  const order: Status[] = [];

  arr.forEach((e) => {
    if (!(e in count)) {
      count[e] = 0;
      order.push(e);
    }
    count[e]++;
  });

  let bestElement: Status = arr[0];
  let bestCount = 0;

  Object.entries(count).forEach(([k, v]): void => {
    if (v > bestCount) {
      bestCount = v;
    }
  });
  for (let i = 0; i < order.length; i++) {
    if (count[order[i]] === bestCount) {
      bestElement = order[i];
      break;
    }
  }
  return bestElement;
}

export { checkArrayIsNotEmpty, modeSingle };
