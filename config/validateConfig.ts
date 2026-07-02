import { configInterface, OutputConfig } from './configInterface';
import { inputHandlers, outputHandlers } from '../src/handlers/index';

const validInputFormats = Object.keys(inputHandlers);
const validOutputFormats = Object.keys(outputHandlers);

export default function validateConfig(config: Readonly<configInterface>): void {
  if (typeof config.inputPath !== 'string' || !config.inputPath.trim()) {
    throw new Error('inputPath must be a non-empty string');
  }

  if (!validInputFormats.includes(config.inputFormat)) {
    throw new Error(
      `Unknown inputFormat "${config.inputFormat}". Valid: ${validInputFormats.join(', ')}`,
    );
  }

  if (!config.useHibpApi) {
    if (typeof config.hashesOfLeaksPath !== 'string' || !config.hashesOfLeaksPath.trim()) {
      throw new Error('hashesOfLeaksPath must be a non-empty string when useHibpApi is false');
    }
  }

  if (!Array.isArray(config.outputs) || config.outputs.length === 0) {
    throw new Error('At least one output must be configured in config.outputs');
  }
  config.outputs.forEach((output: OutputConfig, i: number) => {
    if (!validOutputFormats.includes(output.format)) {
      throw new Error(
        `outputs[${i}].format "${output.format}" is invalid. Valid: ${validOutputFormats.join(', ')}`,
      );
    }
    if (typeof output.path !== 'string' || !output.path.trim()) {
      throw new Error(`outputs[${i}].path must be a non-empty string`);
    }
  });

  if (typeof config.useHibpApi !== 'boolean') {
    throw new Error('useHibpApi must be a boolean');
  }
}
