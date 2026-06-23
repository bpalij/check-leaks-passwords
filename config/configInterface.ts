export interface configInterface {
  inputPath: string,
  inputFormat: 'csv' | 'json',
  hashesOfLeaksPath: string,
  outputPath: string,
  outputFormat: 'csv' | 'json',
}
