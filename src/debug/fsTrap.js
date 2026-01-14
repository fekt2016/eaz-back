/**
 * FORENSIC FS/PATH TRAP
 * 
 * Monkey-patches ALL fs + path entry points to catch when objects
 * are passed instead of strings, providing exact stack traces.
 * 
 * This is a debugging tool - remove after fixing the issue.
 */

const fs = require('fs');
const path = require('path');

/**
 * Trap function that detects objects being passed to fs/path functions
 */
function trap(name, fn) {
  return function (...args) {
    // Find any argument that is an object (but not null, Buffer, or Error)
    const bad = args.find(a => 
      typeof a === 'object' && 
      a !== null && 
      !(a instanceof Buffer) && 
      !(a instanceof Error) &&
      !(a instanceof Date) &&
      !Array.isArray(a)
    );
    
    if (bad) {
      console.error('\n🚨🚨🚨 FS/PATH TRAP HIT 🚨🚨🚨');
      console.error('================================================');
      console.error('Function:', name);
      console.error('Bad arg type:', typeof bad);
      console.error('Bad arg:', JSON.stringify(bad, null, 2));
      console.error('Bad arg keys:', Object.keys(bad));
      console.error('All args:', args.map((a, i) => ({
        index: i,
        type: typeof a,
        isObject: typeof a === 'object' && a !== null,
        value: typeof a === 'string' ? a.substring(0, 100) : a instanceof Buffer ? 'Buffer' : a,
      })));
      console.error('\n📋 STACK TRACE:');
      console.error(new Error().stack);
      console.error('================================================\n');
      
      // Throw a distinctive error so we can identify it
      const error = new Error('FS_TRAP_OBJECT_PATH');
      error.trapFunction = name;
      error.badArg = bad;
      error.stack = new Error().stack;
      throw error;
    }
    return fn.apply(this, args);
  };
}

// Trap all fs functions that take path arguments
const fsFunctions = [
  'readFileSync',
  'writeFileSync',
  'unlinkSync',
  'existsSync',
  'statSync',
  'mkdirSync',
  'readdirSync',
  'rmdirSync',
  'accessSync',
  'chmodSync',
  'chownSync',
  'lstatSync',
  'readlinkSync',
  'realpathSync',
  'symlinkSync',
  'truncateSync',
  'utimesSync',
  'appendFileSync',
  'openSync',
  'readSync',
  'writeSync',
  'closeSync',
  'createReadStream',
  'createWriteStream',
];

fsFunctions.forEach(fn => {
  if (fs[fn] && typeof fs[fn] === 'function') {
    const original = fs[fn];
    fs[fn] = trap(`fs.${fn}`, original);
  }
});

// Trap all path functions
const pathFunctions = [
  'join',
  'resolve',
  'normalize',
  'relative',
  'dirname',
  'basename',
  'extname',
  'format',
  'parse',
];

pathFunctions.forEach(fn => {
  if (path[fn] && typeof path[fn] === 'function') {
    const original = path[fn];
    path[fn] = trap(`path.${fn}`, original);
  }
});

console.log('✅ [fsTrap] FS/PATH trap activated');
console.log(`   Trapping ${fsFunctions.length} fs functions`);
console.log(`   Trapping ${pathFunctions.length} path functions`);
console.log('   🚨 Will catch objects passed as paths\n');

module.exports = { fs, path };
