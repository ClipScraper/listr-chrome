const fs = require('fs');
const { execSync } = require('child_process');

const manifestPath = './manifest.json';
const packageJsonPath = './package.json';
const commitMsgPath = process.argv[2];

if (!commitMsgPath) {
  console.log('No commit message path provided. Skipping version bump.');
  process.exit(0);
}

// Function to get file content from a specific branch
function getFileFromBranch(branch, path) {
  try {
    return execSync(`git show ${branch}:${path}`).toString();
  } catch (error) {
    console.error(`Error getting ${path} from branch ${branch}:`, error);
    return null;
  }
}

// 1. Get versions and compare
const masterManifestContent = getFileFromBranch('master', manifestPath) || getFileFromBranch('main', manifestPath);
if (!masterManifestContent) {
  console.log('Could not retrieve manifest from master/main branch. Skipping version bump.');
  process.exit(0);
}

const masterVersion = JSON.parse(masterManifestContent).version;
const currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = currentManifest.version;

console.log(`Version on master/main: ${masterVersion}`);
console.log(`Version on current branch: ${currentVersion}`);

if (masterVersion !== currentVersion) {
  console.log('Version already bumped in this branch. Skipping.');
  process.exit(0);
}

// 2. Bump version based on commit message and branch name
const commitMessage = fs.readFileSync(commitMsgPath, 'utf8');
const branchName = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

let [major, minor, patch] = currentVersion.split('.').map(Number);
let bumpType = 'patch'; // Default

if (branchName.startsWith('feature/')) {
  bumpType = 'minor';
}

if (commitMessage.includes('[major]')) {
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
console.log(`Bumping version to: ${newVersion}`);

// 3. Update manifest.json and package.json
currentManifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(currentManifest, null, 2) + '\n');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// 4. Add updated files to the commit
execSync(`git add ${manifestPath} ${packageJsonPath}`);

console.log('Version bumped and files staged successfully.');
