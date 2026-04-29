const axios = require('axios');

const API_URL = 'http://127.0.0.1:4000/api/v1';

async function testAuthFallback() {
  try {
    console.log('1. Attempting login to get a token...');
    // Note: We'll use the admin login endpoint
    // We need valid credentials. I'll search for an admin user in the DB if needed, 
    // but for this test we can just try to see if the server responds to the header.
    
    // Let's assume we have a token (you can replace this with a real one from your logs or browser)
    const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.s4a_...'; // Placeholder
    
    console.log('\n2. Testing /admin/me with Authorization header (NO cookies)...');
    try {
      const response = await axios.get(`${API_URL}/admin/me`, {
        headers: {
          'Authorization': `Bearer ${testToken}`
        }
      });
      console.log('Response Status:', response.status);
    } catch (error) {
      // We expect a 401 if the token is invalid, BUT we want to see 
      // if the backend logs "Token found in Authorization header".
      console.log('Response Status (Expected 401 if token invalid):', error.response?.status);
      console.log('Response Message:', error.response?.data?.message);
    }
    
    console.log('\nCheck your backend console logs for: "[Auth] ✅ Token found in Authorization header"');
  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

testAuthFallback();
