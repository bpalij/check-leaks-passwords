export interface OutputConfig {
  format: 'csv' | 'json',
  path: string,
}

export interface configInterface {
  inputPath: string,
  inputFormat: 'csv' | 'json',
  hashesOfLeaksPath: string,
  countLinesInHashesFile: boolean,
  outputs: Array<OutputConfig>,
}
