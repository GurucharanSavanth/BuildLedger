import {randomBytes} from 'node:crypto';
import {access,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
const dest=path.resolve('.env');
try{await access(dest);console.log('Existing .env found; keeping it unchanged.');console.log('By default AUTH_MODE=local opens without a password on this computer.');process.exit(0)}catch{}
const secure=process.argv.includes('--secure');
const config=[
 '# BuildLedger configuration - keep private, do not commit to source control',
 '# SQLite server: retain SQLITE_PATH when upgrading an existing installation',
 'DATABASE_MODE=sqlite',
 'SQLITE_PATH=./data/buildledger.sqlite',
 'AUTH_MODE='+(secure?'owner':'local'),
 'HOST=127.0.0.1',
 'PORT=8080'
];
let password;
if(secure){password=randomBytes(20).toString('base64url');config.push('ADMIN_PASSWORD='+password,'APP_COOKIE_SECRET='+randomBytes(40).toString('base64url'))}
await writeFile(dest,config.join('\n')+'\n',{mode:0o600,flag:'wx'});try{await chmod(dest,0o600)}catch{}
console.log(secure?'Created .env with owner authentication enabled.':'Created .env: no password needed; access restricted to this computer (127.0.0.1).');
if(secure){console.log('Owner password:',password);console.log('Store this password securely.')}else console.log('Open http://127.0.0.1:8080 directly after npm run dev.');
console.log('Keep the local data/ folder private and back up regularly. Do NOT port-forward password-free mode.');
