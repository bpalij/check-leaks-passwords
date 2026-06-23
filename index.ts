import checkPasswordsLeaks from './src/checkPasswordsLeaks';

process.on('SIGINT', () => process.exit(1));

checkPasswordsLeaks().catch((e) => { console.error(e); });
