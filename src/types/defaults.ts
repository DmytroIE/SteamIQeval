// The object that is used for initializing the retainedData object in the very beginning of the evaluation cycle
// This initialization happens in the code that call the eval function
// But it is also used as a helper for initializing some values in the eval function
// That is why it is left here
const defaultRetainedData: RetainedData = {
  //trapId: '',
  //trapName: '',
  //lastSampleTs: null,
  //nextQueryTime: null,
  //extNoiseFactor: 0,
  //lowCcImpactFactor: 0,
  //numExtNoiseSamplesInRow: 0,
  floodFactor: 0,
  prevStatus: Status.Undefined,
  totalLossesKg: 0,
  totalLossesKwh: 0,
  totalLossesCo2: 0,
  hoursOfLeaking: 0,
  prevTrapIndex: null,
  arrActSamples: [],
  arrLastSamples: [],
};

export { defaultRetainedData };