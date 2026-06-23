import { configInterface } from './configInterface';

export default {
  inputPath: '/inputDir/inputFile.csv',
  inputFormat: 'csv',
  hashesOfLeaksPath: '/inputDir/hashes.txt',
  outputPath: '/outputDir/outputFile.csv',
  outputFormat: 'csv',
} as Readonly<configInterface>;
