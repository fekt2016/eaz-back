/**
 * Simple signup test to debug the actual error
 */
const http = require('http');
const { URL } = require('url');

const BASE_URL = 'http://localhost:4000';
const API_BASE = `${BASE_URL}/api/v1`;

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testSignup() {
  const testEmail = `test-${Date.now()}@example.com`;
  console.log(`\nTesting signup with email: ${testEmail}\n`);
  
  try {
    const response = await makeRequest(`${API_BASE}/users/signup`, {
      method: 'POST',
      body: {
        email: testEmail,
        password: 'TestPassword123!',
        passwordConfirm: 'TestPassword123!',
        name: 'Test User',
      },
    });

    console.log('Status Code:', response.statusCode);
    console.log('Response:', JSON.stringify(response.body, null, 2));
    
    if (response.statusCode === 201 || response.statusCode === 200) {
      console.log('\n✅ Signup successful!');
    } else {
      console.log('\n❌ Signup failed');
      if (response.body.error?.errors) {
        console.log('\nValidation Errors:');
        console.log(JSON.stringify(response.body.error.errors, null, 2));
      }
    }
  } catch (error) {
    console.error('Request Error:', error.message);
  }
}

testSignup();

