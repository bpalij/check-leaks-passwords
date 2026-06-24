import checkPasswordsLeaks from './src/checkPasswordsLeaks';
import config from './config/config';

process.on('SIGINT', () => process.exit(1));

checkPasswordsLeaks(config).catch((e) => { console.error(e); });
