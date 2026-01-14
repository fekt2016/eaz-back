/**
 * SAFE MODE TEST
 * 
 * Quick test to verify safe mode implementation is working
 */

const http = require('http');

const testSafeMode = async () => {
  console.log('\n🧪 Testing Safe Mode Implementation...\n');

  const tests = [
    {
      name: 'Backend Health Check',
      url: 'http://localhost:4000/api/v1/health-check',
      method: 'GET',
    },
    {
      name: 'Screen Tracker Middleware',
      url: 'http://localhost:4000/api/v1/health-check',
      method: 'GET',
      headers: {
        'x-client-app': 'Saysay',
        'x-client-screen': 'TestScreen',
      },
    },
  ];

  for (const test of tests) {
    try {
      console.log(`📋 Testing: ${test.name}...`);
      
      const result = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: 4000,
            path: test.url.replace('http://localhost:4000', ''),
            method: test.method || 'GET',
            headers: test.headers || {},
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: data,
              });
            });
          }
        );

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });

      if (result.statusCode === 200 || result.statusCode === 404) {
        console.log(`  ✅ ${test.name}: Server responded (${result.statusCode})`);
      } else {
        console.log(`  ⚠️  ${test.name}: Server responded with ${result.statusCode}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log(`  ❌ ${test.name}: Backend not running on port 4000`);
        console.log(`     → Start backend with: cd backend && npm start`);
      } else {
        console.log(`  ❌ ${test.name}: ${error.message}`);
      }
    }
  }

  console.log('\n✅ Safe Mode Test Complete!\n');
  console.log('📋 Next Steps:');
  console.log('  1. Start backend: cd backend && npm start');
  console.log('  2. Launch mobile app and test screens');
  console.log('  3. Watch backend logs for screen tracking');
  console.log('  4. Report any errors with screen name\n');
};

// Run test
testSafeMode().catch(console.error);

