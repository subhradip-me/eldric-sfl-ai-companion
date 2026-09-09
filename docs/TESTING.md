# Testing Guide: MVC Architecture with Authentication

## Pre-Testing Checklist

- [ ] PostgreSQL is running (`docker-compose up -d` or local service)
- [ ] `.env` file exists with `JWT_SECRET`, `GROQ_API_KEY`, `SUNFLOWER_API_KEY`
- [ ] Database schema is set up (`npm run setup` completed successfully)
- [ ] Node dependencies installed (`npm install`)
- [ ] Client dependencies installed (`cd client && npm install`)

## Test Scenarios

### 1. Authentication Flow

#### Register a New User
```powershell
# Test registration
curl -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "test123"
  }'

# Expected: 201 Created
# Response should include:
# - success: true
# - user object with id, username, email
# - token (JWT)
```

#### Login
```powershell
# Test login
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{
    "username": "testuser",
    "password": "test123"
  }'

# Expected: 200 OK
# Response should include token
# Save this token for subsequent requests
```

#### Get Current User Info
```powershell
# Replace <TOKEN> with your actual token
curl http://localhost:3000/api/auth/me `
  -H "Authorization: Bearer <TOKEN>"

# Expected: 200 OK
# Response should show user details
```

#### Set Farm ID
```powershell
# Replace <TOKEN> and <FARM_ID>
curl -X PUT http://localhost:3000/api/auth/farm `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"farmId": "12345"}'

# Expected: 200 OK
# Response: { "success": true, "message": "Farm ID updated successfully" }
```

### 2. Protected Endpoints

#### Test Without Token (Should Fail)
```powershell
curl http://localhost:3000/api/farm

# Expected: 401 Unauthorized
# Response: { "success": false, "error": "No token provided" }
```

#### Test With Invalid Token (Should Fail)
```powershell
curl http://localhost:3000/api/farm `
  -H "Authorization: Bearer invalid-token"

# Expected: 403 Forbidden
# Response: { "success": false, "error": "Invalid or expired token" }
```

#### Test With Valid Token (Should Succeed)
```powershell
# Replace <TOKEN>
curl http://localhost:3000/api/farm `
  -H "Authorization: Bearer <TOKEN>"

# Expected: 200 OK if farm_id is set
# Expected: 400 Bad Request if no farm_id
```

### 3. Farm Data Endpoints

#### Get Farm Data
```powershell
curl http://localhost:3000/api/farm `
  -H "Authorization: Bearer <TOKEN>"

# Expected: Farm canonical data with target info
```

#### Get Planner
```powershell
curl http://localhost:3000/api/planner `
  -H "Authorization: Bearer <TOKEN>"

# Expected: Optimized recipe plan
```

#### Get Activity
```powershell
curl http://localhost:3000/api/activity `
  -H "Authorization: Bearer <TOKEN>"

# Expected: Note about needing 2 snapshots
# (Refresh farm data twice, then retry to see actual delta)
```

#### Get XP Progression
```powershell
curl "http://localhost:3000/api/xp-progression?days=7" `
  -H "Authorization: Bearer <TOKEN>"

# Expected: XP progression data for last 7 days
```

### 4. Chat Endpoints

#### Send Chat Message
```powershell
curl -X POST http://localhost:3000/api/chat `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{
    "message": "What should I do today?",
    "sessionId": "test-session-1"
  }'

# Expected: AI response with answer and tool steps
```

#### List Chat Sessions
```powershell
curl http://localhost:3000/api/sessions `
  -H "Authorization: Bearer <TOKEN>"

# Expected: Array of user's chat sessions
```

#### Get Session Messages
```powershell
curl http://localhost:3000/api/sessions/test-session-1 `
  -H "Authorization: Bearer <TOKEN>"

# Expected: Array of messages in that session
```

### 5. Public Endpoints (No Auth Required)

#### Health Check
```powershell
curl http://localhost:3000/api/health

# Expected: { "ok": true }
```

#### Market Prices
```powershell
curl http://localhost:3000/api/market

# Expected: Market prices data (no auth needed)
```

### 6. Data Isolation Testing

#### Create Two Users
```powershell
# User 1
curl -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{
    "username": "user1",
    "email": "user1@example.com",
    "password": "pass1"
  }'
# Save token as TOKEN1

# User 2
curl -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{
    "username": "user2",
    "email": "user2@example.com",
    "password": "pass2"
  }'
# Save token as TOKEN2
```

#### Set Different Farm IDs
```powershell
# User 1
curl -X PUT http://localhost:3000/api/auth/farm `
  -H "Authorization: Bearer <TOKEN1>" `
  -H "Content-Type: application/json" `
  -d '{"farmId": "11111"}'

# User 2
curl -X PUT http://localhost:3000/api/auth/farm `
  -H "Authorization: Bearer <TOKEN2>" `
  -H "Content-Type: application/json" `
  -d '{"farmId": "22222"}'
```

#### Send Chat Messages from Each User
```powershell
# User 1 chat
curl -X POST http://localhost:3000/api/chat `
  -H "Authorization: Bearer <TOKEN1>" `
  -H "Content-Type: application/json" `
  -d '{"message": "User 1 message", "sessionId": "user1-session"}'

# User 2 chat
curl -X POST http://localhost:3000/api/chat `
  -H "Authorization: Bearer <TOKEN2>" `
  -H "Content-Type: application/json" `
  -d '{"message": "User 2 message", "sessionId": "user2-session"}'
```

#### Verify Data Isolation
```powershell
# User 1 should only see their own sessions
curl http://localhost:3000/api/sessions `
  -H "Authorization: Bearer <TOKEN1>"
# Should show only user1-session

# User 2 should only see their own sessions
curl http://localhost:3000/api/sessions `
  -H "Authorization: Bearer <TOKEN2>"
# Should show only user2-session
```

### 7. UI Testing

#### Start Both Servers
```powershell
# Terminal 1: Backend
npm start

# Terminal 2: Frontend
cd client
npm run dev
```

#### Test in Browser

1. **Open** `http://localhost:5173`

2. **Test Login with Demo User**
   - Username: `demo`
   - Password: `demo123`
   - Should successfully log in and show user menu

3. **Test Registration**
   - Click "Register" link
   - Fill in form with unique username/email
   - Should create account and auto-login

4. **Test Farm ID Setting**
   - Click user menu (top right)
   - Should show current user info
   - Try setting a farm ID (can use demo farm ID if you don't have one)

5. **Test Dashboard**
   - Should show loading state then farm data
   - If no farm ID set, should show error message
   - After setting farm ID, should show farm stats

6. **Test Chat**
   - Click chat button (bottom right)
   - Send a message like "What should I do today?"
   - Should receive AI response with tool steps shown
   - Verify conversation is saved (check History tab)

7. **Test Data Isolation (Multi-Browser)**
   - Open Chrome: Login as user1
   - Open Firefox: Login as user2
   - Send different chat messages in each
   - Verify each user only sees their own history

8. **Test Logout/Login Persistence**
   - Logout
   - Login again
   - Should see previous chat sessions in History tab
   - Farm data should persist (based on user's farm_id)

### 8. Database Verification

#### Check User Table
```powershell
# Connect to PostgreSQL
docker exec -it sunflower-ai-db-1 psql -U postgres sunflower

# List users
SELECT id, username, email, farm_id, created_at FROM users;

# Should show demo user + any test users created
```

#### Check Data Association
```powershell
# In psql:

# Count snapshots per user
SELECT user_id, COUNT(*) 
FROM snapshots 
GROUP BY user_id;

# Count messages per user
SELECT user_id, COUNT(*) 
FROM chat_messages 
GROUP BY user_id;

# Should show data separated by user_id
```

## Expected Test Results

### ✅ Success Criteria

- [ ] Users can register and receive JWT token
- [ ] Users can login and receive JWT token
- [ ] Protected endpoints reject requests without token
- [ ] Protected endpoints reject requests with invalid token
- [ ] Users can set their farm_id
- [ ] Farm data fetches correctly for authenticated users
- [ ] Chat messages are saved with user_id
- [ ] Each user only sees their own chat history
- [ ] Snapshots are saved with user_id
- [ ] Activity deltas compute from user's own snapshots
- [ ] Market prices work without authentication
- [ ] UI shows login/register screens
- [ ] UI enforces authentication for protected features
- [ ] Logout clears token and returns to login

### ❌ Common Failures

1. **"relation users does not exist"**
   - Cause: Setup not run
   - Fix: Run `npm run setup`

2. **"No farm ID associated"**
   - Cause: User hasn't set farm_id
   - Fix: Call `PUT /api/auth/farm` with farmId

3. **"Invalid or expired token"**
   - Cause: Token expired (7 days) or malformed
   - Fix: Login again to get fresh token

4. **"Cannot fetch farm data"**
   - Cause: Invalid farm_id or Sunflower API issues
   - Fix: Check farm_id is correct, verify API key

5. **Chat shows other users' messages**
   - Cause: Data isolation bug
   - Fix: Check SQL queries have WHERE user_id = $X

## Performance Testing

### Load Test Chat Endpoint
```powershell
# Install k6 (load testing tool)
# Test with 10 concurrent users for 30 seconds
k6 run --vus 10 --duration 30s load-test.js
```

### Monitor Response Times
```powershell
# Add to load-test.js:
import http from 'k6/http';
import { check } from 'k6';

export default function() {
  const token = 'YOUR_TEST_TOKEN';
  const res = http.post('http://localhost:3000/api/chat',
    JSON.stringify({
      message: 'What should I do?',
      sessionId: 'load-test'
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 5s': (r) => r.timings.duration < 5000,
  });
}
```

## Security Testing

### Test SQL Injection
```powershell
# Try malicious input
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{
    "username": "admin'\'' OR 1=1--",
    "password": "anything"
  }'

# Should fail gracefully, not expose SQL
```

### Test Token Tampering
```powershell
# Modify token payload
# Should be rejected with 403
```

### Test CORS
```powershell
# Try from different origin
# Should work for localhost:5173
# Should reject from unknown origins (if CORS configured)
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: docker-compose up -d
      - run: npm run setup
      - run: npm test
      - run: npm run test:integration
```

## Manual Testing Checklist

Before releasing:

- [ ] All authentication flows work
- [ ] All protected endpoints require valid token
- [ ] Data isolation confirmed (multi-user test)
- [ ] UI authentication flows work
- [ ] Logout clears session properly
- [ ] Token expiry handled gracefully
- [ ] Farm data loads correctly
- [ ] Chat conversations save and load
- [ ] Activity deltas compute correctly
- [ ] Market prices work without auth
- [ ] Error messages are user-friendly
- [ ] No sensitive data in error responses
- [ ] Database queries use parameterized statements
- [ ] CORS configured appropriately
- [ ] Rate limiting (if implemented) works

## Test Coverage

Run test suite:
```powershell
npm test
```

Check coverage:
```powershell
npm run test:coverage
```

Target: >80% coverage for:
- Models (User, ChatMessage, Snapshot)
- Controllers (auth, farm, chat)
- Middleware (auth)

## Debugging Tips

### Enable Debug Logging
```env
# Add to .env
DEBUG=true
LOG_LEVEL=debug
```

### Check Server Logs
```powershell
# Server logs show:
# - Authentication attempts
# - Token validation
# - Database queries
# - API errors
```

### Check Client Console
```javascript
// In browser DevTools Console:
localStorage.getItem('auth_token')  // Check if token exists
// Check Network tab for API requests/responses
```

### Database Query Logging
```javascript
// In database.js, enable query logging:
const pool = new Pool({
  // ...
  logging: true
});
```

## Conclusion

After completing these tests:
- System should handle multi-user authentication
- Data isolation should be confirmed
- All endpoints should work as expected
- UI should enforce authentication properly
- Performance should be acceptable (< 5s for AI responses)

Report any failures in GitHub issues with:
- Test scenario that failed
- Expected vs actual behavior
- Error messages/logs
- Environment details
