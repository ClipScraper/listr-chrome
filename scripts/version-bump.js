const fs = require('fs');

const manifestPath = './manifest.json';
const packageJsonPath = './package.json';

const branchName = process.env.BRANCH_NAME;
const commitMessages = process.env.COMMIT_MESSAGES;

// Read manifest.json to get the current version
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;

console.log(`Current version: ${currentVersion}`);

let [major, minor, patch] = currentVersion.split('.').map(Number);

let bumpType = 'patch'; // Default bump type

if (branchName && branchName.startsWith('feature/')) {
  bumpType = 'minor';
}

if (commitMessages && commitMessages.includes('[major]')) {
  bumpType = 'major';
}

console.log(`Determined bump type: ${bumpType}`);

if (bumpType === 'major') {
  major++;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor++;
  patch = 0;
} else {
  patch++;
}

const newVersion = `${major}.${minor}.${patch}`;
console.log(`New version: ${newVersion}`);

// Update manifest.json
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated ${manifestPath} to version ${newVersion}`);

// Update package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`Updated ${packageJsonPath} to version ${newVersion}`);

// Set output for the GitHub Action
console.log(`::set-output name=new_version::${newVersion}`);
