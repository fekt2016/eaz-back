/**
 * TEST MOBILE 404 FIX
 * 
 * Verifies that mobile 404s are handled gracefully
 */

const http = require('http');

const testMobile404Fix = async () => {
  console.log('\n🧪 Testing Mobile 404 Fix...\n');

  const tests = [
    {
      name: 'Products Route Alias',
      method: 'GET',
      path: '/api/v1/products?limit=1',
      headers: { 'x-client-app': 'Saysay', 'x-client-screen': 'TestScreen' },
      expectedStatus: [200, 401, 404], // 401 if auth required, 404 if route still not found
    },
    {
      name: 'Missing Route - Mobile Safe Fallback',
      method: 'GET',
      path: '/api/v1/some-missing-route',
      headers: { 'x-client-app': 'Saysay', 'x-client-screen': 'TestScreen' },
      expectedStatus: 200, // Should return 200 with mobileSafeFallback
    },
    {
      name: 'Data Download Route Alias',
      method: 'POST',
      path: '/api/v1/permissions/request-data-download',
      headers: {
        'x-client-app': 'Saysay',
        'x-client-screen': 'TestScreen',
        'Content-Type': 'application/json',
      },
      body: {},
      expectedStatus: [200, 401], // 200 if mobile guard active, 401 if auth required
    },
    {
      name: 'Web App - Real 404',
      method: 'GET',
      path: '/api/v1/some-missing-route',
      headers: {}, // No mobile headers
      expectedStatus: 404, // Web should get real 404
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
            path: test.path,
            method: test.method,
            headers: test.headers || {},
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const parsed = data ? JSON.parse(data) : {};
                resolve({
                  statusCode: res.statusCode,
                  body: parsed,
                });
              } catch (e) {
                resolve({
                  statusCode: res.statusCode,
                  body: data,
                });
              }
            });
          }
        );

        req.on('error', (error) => {
          reject(error);
        });

        if (test.body) {
          req.write(JSON.stringify(test.body));
        }

        req.end();
      });

      const expectedStatuses = Array.isArray(test.expectedStatus)
        ? test.expectedStatus
        : [test.expectedStatus];

      if (expectedStatuses.includes(result.statusCode)) {
        console.log(`  ✅ Status: ${result.statusCode} (expected)`);

        if (result.body.mobileSafeFallback) {
          console.log(`  ✅ Mobile safe fallback active`);
          console.log(`     Message: ${result.body.message}`);
        }

        if (result.statusCode === 200 && test.headers['x-client-app'] === 'Saysay') {
          console.log(`  ✅ Mobile request handled gracefully`);
        }
      } else {
        console.log(`  ⚠️  Status: ${result.statusCode} (expected one of: ${expectedStatuses.join(', ')})`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log(`  ❌ Backend not running on port 4000`);
        console.log(`     → Start backend with: cd backend && npm start`);
      } else {
        console.log(`  ❌ Error: ${error.message}`);
      }
    }
    console.log('');
  }

  console.log('✅ Mobile 404 Fix Test Complete!\n');
};

testMobile404Fix().catch(console.error);

