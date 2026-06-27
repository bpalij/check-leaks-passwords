import { configInterface } from './configInterface';

export default {
  inputPath: '/inputDir/inputFile.csv',
  inputFormat: 'csv',
  // Single file (default HIBP download):
  hashesOfLeaksPath: '/inputDir/hashes.txt',
  // Split prefix files (PwnedPasswordsDownloader -s false):
  // hashesOfLeaksPath: '/inputDir/pwnedpasswords/',
  countLinesInHashesFile: true,
  outputs: [
    { format: 'csv', path: '/outputDir/outputFile.csv' },
    { format: 'json', path: '/outputDir/outputFile.json' },
  ],
} as Readonly<configInterface>;
