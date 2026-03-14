import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const sourceIcon = path.join(projectRoot, 'source/assets/logos/logo.png');
const destIcon = path.join(projectRoot, 'public/icon.png');

try {
  fs.copyFileSync(sourceIcon, destIcon);
  console.log('✓ Icon copied to public/icon.png');
} catch (error) {
  console.error('Failed to copy icon:', error.message);
  process.exit(1);
}
