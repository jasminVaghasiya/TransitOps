import 'dotenv/config';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';

const PORT = 5001;
const BASE_URL = `http://localhost:${PORT}/api/auth`;

// Helper to extract cookies from response headers
const getCookieValue = (response, name) => {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
};

async function runTests() {
  console.log('--- STARTING AUTHENTICATION FLOW INTEGRATION TESTS ---');

  let mongoServer;

  // 1. Start test server
  const server = app.listen(PORT, () => {
    console.log(`Test server listening on port ${PORT}`);
  });

  // 2. Start MongoMemoryServer and connect
  try {
    mongoServer = await MongoMemoryServer.create();
    const testDbUri = mongoServer.getUri();
    console.log(`Connecting to in-memory database: ${testDbUri}`);
    await mongoose.connect(testDbUri);
    console.log('Connected to in-memory MongoDB database.');
  } catch (err) {
    console.error('CRITICAL: Failed to start/connect in-memory MongoDB database.');
    console.error(err.message);
    server.close();
    process.exit(1);
  }

  // 3. Clear existing test data
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
  console.log('Cleared test collections.');

  let accessToken = '';
  let refreshTokenCookie = '';

  const testUser = {
    name: 'Hackathon Tester',
    email: 'test@example.com',
    password: 'password123Secure!',
  };

  try {
    // --- TEST 0: JOI VALIDATION CONSTRAINTS ---
    console.log('\n[TEST 0] Verifying Joi request validation constraints...');
    const invalidSignupRes = await fetch(`${BASE_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A', // too short (min 2)
        email: 'invalid-email-format', // invalid email
        password: 'short', // too short (min 8)
      }),
    });
    
    const invalidSignupData = await invalidSignupRes.json();
    if (invalidSignupRes.status === 400 && invalidSignupData.status === 'fail' && Array.isArray(invalidSignupData.errors)) {
      console.log('✓ Successfully blocked invalid signup payload with 400 Bad Request!');
      console.log('Joi error details:', invalidSignupData.errors);
    } else {
      throw new Error(`Expected Joi validation failure with 400 Bad Request, but got status ${invalidSignupRes.status}: ${JSON.stringify(invalidSignupData)}`);
    }

    // --- TEST 1: SIGNUP ---
    console.log('\n[TEST 1] Creating new user...');
    const signupRes = await fetch(`${BASE_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    
    const signupData = await signupRes.json();
    if (signupRes.status !== 201 || signupData.status !== 'success') {
      throw new Error(`Signup failed: ${JSON.stringify(signupData)}`);
    }
    console.log('✓ User signed up successfully!');
    console.log('User payload (should not contain password or __v):', signupData.data.user);
    
    // Save access token
    accessToken = signupData.data.accessToken;
    // Extract refresh token from Set-Cookie header
    refreshTokenCookie = getCookieValue(signupRes, 'refreshToken');
    console.log('✓ Access Token generated.');
    console.log('✓ Refresh Token cookie set:', refreshTokenCookie ? 'Yes (Secure Cookie)' : 'No (FAILED)');

    if (!refreshTokenCookie) {
      throw new Error('Refresh token cookie was not set in headers!');
    }

    // --- TEST 2: PROTECTED ROUTE (WITH ACCESS TOKEN) ---
    console.log('\n[TEST 2] Accessing protected route with valid Access Token...');
    const protectedRes = await fetch(`${BASE_URL}/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const protectedData = await protectedRes.json();
    if (protectedRes.status !== 200 || protectedData.status !== 'success') {
      throw new Error(`Protected route access failed: ${JSON.stringify(protectedData)}`);
    }
    console.log('✓ Access granted! Response user name:', protectedData.data.user.name);

    // --- TEST 3: PROTECTED ROUTE (WITHOUT ACCESS TOKEN) ---
    console.log('\n[TEST 3] Accessing protected route without Access Token...');
    const noTokenRes = await fetch(`${BASE_URL}/me`, { method: 'GET' });
    const noTokenData = await noTokenRes.json();
    if (noTokenRes.status === 401) {
      console.log('✓ Correctly denied access with 401 Unauthorized:', noTokenData.message);
    } else {
      throw new Error(`Expected 401 unauthorized but got ${noTokenRes.status}`);
    }

    // --- TEST 4: LOGIN ---
    console.log('\n[TEST 4] Logging in with credentials...');
    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200 || loginData.status !== 'success') {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✓ Logged in successfully!');
    accessToken = loginData.data.accessToken;
    refreshTokenCookie = getCookieValue(loginRes, 'refreshToken');
    console.log('✓ New Access Token generated.');
    console.log('✓ New Refresh Token cookie set.');

    // --- TEST 5: REFRESH TOKEN ROTATION (RTR) ---
    console.log('\n[TEST 5] Refreshing tokens (Normal Rotation)...');
    const refreshRes = await fetch(`${BASE_URL}/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${refreshTokenCookie}`,
      },
    });
    const refreshData = await refreshRes.json();
    if (refreshRes.status !== 200 || refreshData.status !== 'success') {
      throw new Error(`Refresh failed: ${JSON.stringify(refreshData)}`);
    }
    console.log('✓ Tokens rotated successfully!');
    const newAccessToken = refreshData.data.accessToken;
    const newRefreshTokenCookie = getCookieValue(refreshRes, 'refreshToken');
    console.log('✓ Old Access Token replaced with new Access Token.');
    console.log('✓ Old Refresh Token rotated to new Refresh Token cookie.');

    if (newRefreshTokenCookie === refreshTokenCookie) {
      throw new Error('Refresh token rotation failed: same token returned');
    }

    // --- TEST 6: RTR REUSE DETECTION (MALICIOUS REPLAY) ---
    console.log('\n[TEST 6] Simulating Refresh Token Reuse attack (using old revoked token)...');
    const reuseRes = await fetch(`${BASE_URL}/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${refreshTokenCookie}`, // Sending old token
      },
    });
    const reuseData = await reuseRes.json();
    if (reuseRes.status === 403) {
      console.log('✓ Security Check Successful! Access blocked with 403 Forbidden:', reuseData.message);
      
      // Let's verify that the new token (newRefreshTokenCookie) is also invalidated now
      const checkRevokedRes = await fetch(`${BASE_URL}/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${newRefreshTokenCookie}`,
        },
      });
      if (checkRevokedRes.status === 403 || checkRevokedRes.status === 401) {
        console.log('✓ Verified: All sessions for the user revoked in response to token reuse attempt.');
      } else {
        throw new Error('Expected secondary session to be revoked, but it is still active!');
      }
    } else {
      throw new Error(`Expected 403 Forbidden for reuse, but got ${reuseRes.status}`);
    }

    // Let's log in again to test Logout
    console.log('\n[LOG IN FOR LOGOUT TEST] Logging in again...');
    const reLoginRes = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    const reLoginData = await reLoginRes.json();
    const finalRefreshToken = getCookieValue(reLoginRes, 'refreshToken');

    // --- TEST 7: LOGOUT ---
    console.log('\n[TEST 7] Logging out...');
    const logoutRes = await fetch(`${BASE_URL}/logout`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${finalRefreshToken}`,
      },
    });
    const logoutData = await logoutRes.json();
    if (logoutRes.status !== 200 || logoutData.status !== 'success') {
      throw new Error(`Logout failed: ${JSON.stringify(logoutData)}`);
    }
    console.log('✓ Logged out successfully!');

    // Verify token cookie is cleared
    const clearedCookie = getCookieValue(logoutRes, 'refreshToken');
    if (clearedCookie === '' || !clearedCookie) {
      console.log('✓ Client refresh token cookie cleared.');
    } else {
      console.warn('Cookie was not cleared:', clearedCookie);
    }

    // Verify that the token is revoked in DB
    const checkDbToken = await RefreshToken.findOne({ token: finalRefreshToken });
    if (checkDbToken && checkDbToken.revokedAt) {
      console.log('✓ Database token status successfully marked as revoked.');
    } else {
      throw new Error('Database token status was not marked as revoked after logout.');
    }

    console.log('\n=========================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=========================================');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
  } finally {
    // Cleanup DB and close connections
    console.log('\nCleaning up database connection...');
    await mongoose.connection.close();
    if (mongoServer) {
      await mongoServer.stop();
      console.log('In-memory MongoDB database stopped.');
    }
    server.close();
    console.log('Test completed.');
  }
}

runTests();
