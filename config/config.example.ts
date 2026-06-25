import { configInterface } from './configInterface';

export default {
  inputPath: '/inputDir/inputFile.csv',
  inputFormat: 'csv',
  hashesOfLeaksPath: '/inputDir/hashes.txt',
  countLinesInHashesFile: true,
  outputs: [
    { format: 'csv', path: '/outputDir/outputFile.csv' },
    { format: 'json', path: '/outputDir/outputFile.json' },
  ],
} as Readonly<configInterface>;
