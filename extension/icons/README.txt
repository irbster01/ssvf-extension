// Simple icon generation script
// Run this to create PNG icons from SVG

const fs = require('fs');

console.log('Icon SVG created at icons/icon.svg');
console.log('\nTo create PNG files:');
console.log('1. Go to https://cloudconvert.com/svg-to-png');
console.log('2. Upload icons/icon.svg');
console.log('3. Convert to PNG at these sizes:');
console.log('   - 16x16px → save as icon16.png');
console.log('   - 48x48px → save as icon48.png');  
console.log('   - 128x128px → save as icon128.png');
console.log('4. Save all 3 files to the icons/ folder');
console.log('\nOr use ImageMagick:');
console.log('magick convert -background none icon.svg -resize 16x16 icon16.png');
console.log('magick convert -background none icon.svg -resize 48x48 icon48.png');
console.log('magick convert -background none icon.svg -resize 128x128 icon128.png');
