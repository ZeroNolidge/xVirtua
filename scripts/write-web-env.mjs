// Writes web/.env.production.local with the Firebase web config for $PROJECT_ID.
// Registers a Web app in the project first if none exists. Used by the deploy workflow.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const project = process.env.PROJECT_ID;
if (!project) throw new Error('PROJECT_ID is not set');

const fb = (...args) =>
  JSON.parse(
    execFileSync('npx', ['firebase', ...args, '--project', project, '--json'], {
      encoding: 'utf8',
    }),
  );

let apps = fb('apps:list', 'WEB').result ?? [];
if (apps.length === 0) {
  console.log('No web app registered; creating "PlainSpeak Web".');
  fb('apps:create', 'WEB', 'PlainSpeak Web');
  apps = fb('apps:list', 'WEB').result ?? [];
}
const appId = apps[0]?.appId;
if (!appId) throw new Error('Could not find or create a web app');

const res = fb('apps:sdkconfig', 'WEB', appId).result;
const cfg = res.sdkConfig ?? res;
const lines = {
  VITE_FIREBASE_API_KEY: cfg.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: cfg.authDomain,
  VITE_FIREBASE_PROJECT_ID: cfg.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: cfg.storageBucket,
  VITE_FIREBASE_APP_ID: cfg.appId,
  VITE_USE_EMULATORS: 'false',
};
for (const [k, v] of Object.entries(lines)) if (!v) throw new Error(`Missing ${k} in sdkconfig`);
writeFileSync(
  'web/.env.production.local',
  Object.entries(lines)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
);
console.log(`Wrote web config for ${cfg.projectId} (app ${appId}).`);
