# 🔧 Troubleshooting Guide

## Common Issues and Solutions

### 1. "ERR_CONNECTION_REFUSED" or CORS Errors

**Symptoms:**
- Console shows connection refused errors
- API calls fail
- Red errors in browser console

**Solution:**
1. Make sure the backend server is running:
   ```powershell
   # In Terminal 1
   npm start
   # Should show: "sunflower-ai on :3000"
   ```

2. Make sure the client dev server is running:
   ```powershell
   # In Terminal 2
   cd client
   npm run dev
   # Should show: "Local: http://localhost:5173"
   ```

3. Access the app at `http://localhost:5173` (not :3000)

### 2. "relation users does not exist"

**Symptoms:**
- Login/Register fails with database error
- Server logs show table doesn't exist

**Solution:**
Run the setup script:
```powershell
npm run setup
```

### 3. Port Already in Use

**Symptoms:**
- `EADDRINUSE: address already in use :::3000`

**Solution:**
```powershell
# Find and kill the process
Get-Process -Name node | Stop-Process -Force

# Or use a different port
$env:PORT=3001
npm start
```

### 4. Environment Variables Not Loaded

**Symptoms:**
- JWT_SECRET errors
- Database connection fails
- API keys missing

**Solution:**
1. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` and add your values:
   ```env
   GROQ_API_KEY=your_key_here
   JWT_SECRET=your_random_secret
   DATABASE_URL=postgres://user:pass@localhost:5432/sunflower
   ```

### 5. PostgreSQL Not Running

**Symptoms:**
- Connection timeout
- `ECONNREFUSED` on port 5432

**Solution:**

**Using Docker:**
```powershell
docker-compose up -d
```

**Using Local PostgreSQL:**
```powershell
# Check if running
Get-Service -Name postgresql*

# Start if not running
Start-Service postgresql-x64-14
```

### 6. Client Not Building

**Symptoms:**
- Vite errors
- Module not found

**Solution:**
```powershell
cd client
Remove-Item -Recurse -Force node_modules
npm install
npm run dev
```

## Quick Checklist

Before starting the app, ensure:

- [ ] PostgreSQL is running
- [ ] `.env` file exists with correct values
- [ ] Database schema is set up (`npm run setup`)
- [ ] Dependencies are installed (`npm install`)
- [ ] Client dependencies are installed (`cd client && npm install`)

## Starting the Application

### Correct Order:

1. **Start PostgreSQL** (if using local)
   ```powershell
   # Docker
   docker-compose up -d
   
   # Or local service
   Start-Service postgresql-x64-14
   ```

2. **Run setup** (first time only)
   ```powershell
   npm run setup
   ```

3. **Start backend** (Terminal 1)
   ```powershell
   npm start
   # Wait for: "sunflower-ai on :3000"
   ```

4. **Start frontend** (Terminal 2)
   ```powershell
   cd client
   npm run dev
   # Wait for: "Local: http://localhost:5173"
   ```

5. **Open browser**
   - Navigate to `http://localhost:5173`
   - Use demo credentials: `demo` / `demo123`

## Development Mode

For better development experience:

```powershell
# Terminal 1: Backend with auto-reload
npm run dev

# Terminal 2: Frontend
cd client
npm run dev
```

## Verifying Everything Works

### Test Backend:
```powershell
curl http://localhost:3000/api/health
# Should return: {"ok":true}
```

### Test Frontend:
Open `http://localhost:5173` - should see login screen

### Test Database:
```powershell
psql $env:DATABASE_URL -c "SELECT count(*) FROM users;"
# Should show at least 1 (demo user)
```

## Console Errors Explained

### Normal (Can Ignore):
- Warnings about deprecated features
- Info messages about database connection

### Need Attention:
- ❌ `ERR_CONNECTION_REFUSED` - Backend not running
- ❌ `CORS policy` - Wrong origin or server not running
- ❌ `relation does not exist` - Run `npm run setup`
- ❌ `JWT secret` - Check `.env` file

## Getting Help

If issues persist:

1. Check all terminals for error messages
2. Verify all services are running
3. Check `.env` configuration
4. Try stopping all processes and restart
5. Check PostgreSQL logs

## Clean Restart

If everything is broken:

```powershell
# Stop all Node processes
Get-Process -Name node | Stop-Process -Force

# Stop database (if Docker)
docker-compose down

# Clean and reinstall
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force client/node_modules
npm install
cd client && npm install && cd ..

# Restart database
docker-compose up -d

# Setup
npm run setup

# Start servers
npm start  # Terminal 1
cd client && npm run dev  # Terminal 2
```

## Performance Tips

- Use `npm run dev` instead of `npm start` for auto-reload
- Keep DevTools console open to catch errors early
- Check Network tab if API calls are failing
- Monitor PostgreSQL connections if database seems slow
