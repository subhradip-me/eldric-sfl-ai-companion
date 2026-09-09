# Migration Guide: MVC Architecture with User Authentication

## What Changed

This update refactors the server to use MVC (Model-View-Controller) architecture and adds multi-user support with authentication.

### Major Changes:
1. **User Authentication** - JWT-based authentication required for all farm/chat endpoints
2. **User-Scoped Data** - Each user has their own farm_id, snapshots, and chat history
3. **MVC Structure** - Clean separation: models/ controllers/ routes/ middleware/ services/
4. **Database Schema** - New `users` table, updated `snapshots` and `chat_messages` with `user_id`

## Migration Steps

### 1. Update Database Schema

Run the setup script to create the new tables:

```powershell
npm run setup
```

This will:
- Create `users` table
- Add `user_id` column to `snapshots` table
- Add `user_id` column to `chat_messages` table
- Create a demo user (username: `demo`, password: `demo123`)

### 2. Update Environment Variables

Add to your `.env` file:

```env
JWT_SECRET=your-random-secret-key-here
```

Generate a secure secret:
```powershell
# PowerShell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
```

### 3. Existing Data

**Snapshots and Chat Messages:**
- Old snapshots without `user_id` will be orphaned
- Old chat messages without `user_id` will be orphaned
- These records won't appear in the new system but won't break anything

**Clean Start (Optional):**
If you want a fresh database:

```powershell
# Drop and recreate database
docker-compose down -v
docker-compose up -d
npm run setup
```

### 4. Client Updates

The client already has authentication support. No changes needed!

### 5. API Changes

**Before (No Auth):**
```javascript
// Direct access
fetch('/api/farm')
  .then(r => r.json())
```

**After (With Auth):**
```javascript
// Include JWT token in headers
const token = localStorage.getItem('auth_token');
fetch('/api/farm', {
  headers: { 'Authorization': `Bearer ${token}` }
})
  .then(r => r.json())
```

The client `api.js` already handles this automatically!

## New Authentication Flow

### 1. Register a New User

```javascript
POST /api/auth/register
{
  "username": "farmplayer",
  "email": "player@example.com",
  "password": "password123",
  "farmId": "your-sunflower-farm-id" // optional
}

Response:
{
  "success": true,
  "user": { "id": 1, "username": "farmplayer", ... },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 2. Login

```javascript
POST /api/auth/login
{
  "username": "farmplayer",
  "password": "password123"
}

Response:
{
  "success": true,
  "user": { "id": 1, "username": "farmplayer", "farmId": "123" },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 3. Set Your Farm ID

After logging in, set your Sunflower Land farm ID:

```javascript
PUT /api/auth/farm
Headers: { "Authorization": "Bearer <token>" }
Body: { "farmId": "your-sunflower-farm-id" }
```

Your Sunflower Land farm ID is the number in your farm URL:
`https://sunflower-land.com/play/farm/12345` → Farm ID is `12345`

### 4. Access Protected Routes

All farm and chat endpoints now require:
- Valid JWT token in `Authorization` header
- User must have a `farm_id` set

```javascript
// Get your farm data
GET /api/farm
Headers: { "Authorization": "Bearer <token>" }

// Chat with AI
POST /api/chat
Headers: { "Authorization": "Bearer <token>" }
Body: { "message": "What should I do today?" }
```

## Breaking Changes

### Endpoints Now Requiring Auth:
- `/api/farm` - Get farm data
- `/api/planner` - Get optimized plan
- `/api/activity` - Get activity comparison
- `/api/xp-progression` - Get XP chart data
- `/api/chat` - Send chat message
- `/api/sessions` - List chat sessions
- `/api/sessions/:id` - Get session messages

### Endpoints Still Public:
- `/api/health` - Health check
- `/api/market` - Market prices
- `/api/auth/*` - All auth endpoints

## Data Isolation

Each user's data is completely isolated:

- **Farm Data**: Fetched using the user's own `farm_id`
- **Snapshots**: Only see your own snapshots
- **Chat History**: Only see your own conversations
- **Activity Deltas**: Computed from your own snapshots

Multiple users can use the same farm_id if they want to share farm data, but their chat history and snapshots remain separate.

## Troubleshooting

### "No farm ID associated with your account"

**Solution:** Set your farm ID:
```javascript
PUT /api/auth/farm
Body: { "farmId": "your-farm-id" }
```

### "Invalid token" or "No token provided"

**Solution:** 
1. Make sure you're logged in
2. Check token is in localStorage: `localStorage.getItem('auth_token')`
3. Token expires after 7 days - login again

### "relation users does not exist"

**Solution:** Run the setup script:
```powershell
npm run setup
```

### Old data not appearing

**Explanation:** Old snapshots and chat messages without `user_id` are orphaned.

**Solution:** They won't cause errors, just won't appear. For a clean start, drop and recreate the database.

## Testing the New System

### 1. Test with Demo User

```powershell
# Start the servers
npm start              # Terminal 1
cd client && npm run dev    # Terminal 2
```

Open `http://localhost:5173` and login:
- Username: `demo`
- Password: `demo123`

### 2. Create Your Own Account

1. Click "Register" in the UI
2. Enter your details
3. After registration, go to settings and add your Sunflower Land farm ID
4. Refresh farm data

### 3. Test Multi-User

1. Open two different browsers (e.g., Chrome and Firefox)
2. Register different users in each
3. Verify data isolation - each user only sees their own chat history and snapshots

## Rollback (If Needed)

If you need to rollback to the old version:

```powershell
git checkout main
npm install
npm start
```

Note: You'll lose user accounts and need to reconfigure for single-farm usage.

## Need Help?

Check `TROUBLESHOOTING.md` for common issues and solutions.
