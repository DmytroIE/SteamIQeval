type Timestamp = number;
type ID = string;

// Set of statuses to be assigned to a trap
const enum Status {
  Undefined = 0,
  Good = 1,
  Warning = 2,
  Leaking = 3,
}

// Set of current states to be assigned to a trap, eight last samples are taken into account
const enum CurrentState {
  Undefined = 0,
  Cold = 1,
  LoActivity = 2,
  MidActivity = 3,
  HiActivity = 4,
  ExtraHiActivity = 5,
}

// Types of samples, used in the eval algorithm
const enum SampleTypes {
  Cold = 0,
  Flooded = 1,
  LoActive = 2,
  MidActive = 3,
  HiActive = 4,
  ExtraHiActive = 5,
}

// The array of these samples is fed into the eval function as a new data
type NewSample = {
  timestamp: Timestamp;
  activity: number;
  cycleCounts: number;
  temperature: number|null;
  battery: number|null;
};

// The array of these entities is retained between function evaluations
type RetainedSample = {
  timestamp: Timestamp;
  activity: number;
  cycleCounts: number;
  stype: SampleTypes;
  inTripletHiCc: 0 | 1;
  loCcScore: number;
  temperature: number|null;
};

// The common information about a trap, needed for the status evaluation
// When the trap has been fixed or replaced with a new one, an new entity of this type needs to be added in arrTrapInfo variable
type TrapInfo = {
  validFrom: Timestamp;
  trapName: string; //doesn't reset the statistic collected so far
  orifDiam: number; // resets the statistic collected so far
  pressure: number; // resets the statistic collected so far
  steamEnthalpy: number; //doesn't reset the statistic collected so far
  efficiency: number; //doesn't reset the statistic collected so far
  co2factor: number; //doesn't reset the statistic collected so far
  isModulating: boolean; // resets the statistic collected so far
  siqDevId: string; // the ID of the device connected to this steam trap. If it is changed, no new trapInfo is created (therefore, doesn't reset the statistic collected so far)
  reset: boolean;
};

// The object of this shape is retained between function evaluations (can call it "state")
type RetainedData = {
  floodFactor: number;
  prevStatus: Status;
  totalLossesKg: number;
  totalLossesKwh: number;
  totalLossesCo2: number;
  hoursOfLeaking: number;
  prevTrapIndex: number | null;
  arrActSamples: RetainedSample[];
  arrLastSamples: RetainedSample[];
};

// The shape of a typical output of each invocation of the eval function.
// Can be considered as a result that can be stored into a DB or reflected in STRATA dashboards
type SampleForStoringInDb = {
  ts: Timestamp;
  activity: number;
  cycleCounts: number;
  stype: number;
  status: Status;
  trapIndex: number;
  totalLossesKg: number;
  totalLossesKwh: number;
  totalLossesCo2: number;
  meanIntLeak: number;
  extNoiseFactor: number;
  floodFactor: number;
  temperature: number|null;
  battery: number|null;
};

type OutputSample = {
  time: number,
  [key: string]: number|string;
}

// The shape of a typical output of each invocation of the eval function
type SteamIqFuncOutput = {
  arrSamplesForStoring: SampleForStoringInDb[];
  newRetainedData: RetainedData;
};

type ProxyObj = {[key: string]: number|string|null};