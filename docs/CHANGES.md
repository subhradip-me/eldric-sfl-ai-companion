# 📝 Sunflower AI Engineering Changelog

## 🚀 Branch: `refactor/js-to-ts-migration` (2026-09-09 / 2026-09-10)

### 🎯 Objective
Migrate the entire backend codebase from untyped JavaScript CommonJS/ESM to strongly-typed **TypeScript 5.9**, convert all functional controllers and services into **class-based object-oriented architectures**, modularize services into feature domains (`ai/`, `auth/`, `chat/`, `cooking/`, `farm/`), and fix critical AI pipeline calculation gaps.

---

### 1. TypeScript & Class-Based Architecture Migration
- **Runtime**: Switched server runtime to `tsx` for direct ESM TypeScript execution (`npm start`, `npm run dev`, and `npm test`).
- **Class-Based Controllers**:
  - `AuthController.ts`: Manages user credentials, registration, session rehydration, and farm linking.
  - `FarmController.ts`: Orchestrates farm state, market orderbooks, cooking pipelines, and snapshots.
  - `ChatController.ts`: Dispatches multi-turn conversational agent sessions.
- **Class-Based Modular Services (`server/services/`)**:
  - `farm/`: `SunflowerClient.ts` (tiered cache + in-flight deduplication), `FarmNormalizer.ts`, `SnapshotService.ts`, `ActivityService.ts`.
  - `cooking/`: `PlannerService.ts`, `RecipeService.ts`, `XpEngine.ts`.
  - `ai/`: `Orchestrator.ts` (12-tool autonomous agent loop), `GroqClient.ts`.
  - `auth/`: `AuthService.ts` (bcrypt hashing + JWT generation/verification).
  - `chat/`: `ChatStoreService.ts` (local ONNX vector embeddings + pgvector).
- **Type Safety**:
  - Created `server/types/index.ts` defining `CanonicalFarmState`, `CookingPlan`, `CookingPlanCandidate`, `RecipeDefinition`, `EffectiveRecipe`, `CostResult`, `SnapshotRecord`, `ChatMessageRecord`, `MarketPrice`, etc.
  - Resolved all TypeScript compiler errors (`npx tsc --noEmit` passes with 0 errors).
- **Backward Compatibility**:
  - Implemented legacy shims forwarding old file paths (`server/controllers/farmController.js`, `server/services/planner.js`, `server/services/xpEngine.js`, etc.) to the new modular TypeScript services.

---

### 2. AI Pipeline Bug Fixes & Validation
- **Swapped Snapshot Arguments (P0 Fix)**:
  - Fixed `snapshotService.latest(2, context.userId)` -> `snapshotService.latest(context.userId, 2)` in `Orchestrator.ts`. Previously, snapshots were queried for literal user #2 rather than the requesting user.
- **Building Ownership Verification Gate (P1 Fix)**:
  - Updated `compute_recipe_cost` in `Orchestrator.ts` to check `r.building in canonical.buildings`, returning `ownsBuilding: false` and a warning banner when the player lacks the required building.
- **In-Turn Tool Call Dedup Bypass (P1 Fix)**:
  - Added `force: true` support to tool arguments in `Orchestrator.ts`, allowing the agent to bypass the in-turn `seen` cache when new player constraints are introduced.

---

### 3. Documentation Overhaul
- Thoroughly updated `docs/` (`00_OVERVIEW.md` through `12_TODO_TRACKER.md`) with in-depth architecture diagrams, TypeScript domain contracts, and realistic code snippets illustrating end-to-end system mechanics.

---

## 📝 Historic Changes: `feature/public-auth` Branch

This branch transformed the Sunflower AI project from a personal tool to a public, multi-user application with authentication.

## 🎯 Main Goal
Enable multiple users to use Sunflower AI with their own accounts and farm data.

## ✨ New Features

### 🔐 Authentication System
- **User Registration**: Create accounts with username, email, and password
- **Login System**: Secure JWT-based authentication
- **Password Security**: Bcrypt hashing with 10 salt rounds
- **Token Management**: 7-day JWT tokens with auto-refresh
- **User Sessions**: Persistent login across browser sessions

### 👤 User Management
- **User Profiles**: Each user has their own profile and farm ID
- **Farm Linking**: Optional farm ID association during registration
- **Password Changes**: Users can update their passwords
- **User Menu**: Profile dropdown in sidebar with logout functionality

### 🗄️ Database Changes
- **Users Table**: Store user credentials and profile data
- **User Relationships**: Link chat history and farm snapshots to users
- **Database Schema**: Automated setup with `npm run setup`
- **Demo User**: Pre-configured demo account for testing

### 🎨 UI Improvements
- **Auth Screens**: Beautiful login and registration pages
- **Loading States**: Proper loading indicators during auth checks
- **User Avatar**: Initial-based avatar in sidebar
- **Dark Mode Support**: Full dark mode for auth screens
- **Error Handling**: Clear error messages for auth failures

### 🔒 Security Features
- **JWT Tokens**: Stateless authentication
- **Password Hashing**: bcrypt with salt rounds
- **Protected Routes**: Middleware for authenticated endpoints
- **Optional Auth**: Some endpoints work with or without auth
- **CORS Configuration**: Secure cross-origin requests

### 📚 Documentation
- **README_PUBLIC.md**: Comprehensive public documentation
- **DEPLOYMENT.md**: Detailed deployment guide for various platforms
- **setup.js**: Automated database setup script
- **Environment Variables**: Updated .env.example with JWT_SECRET

## 🔧 Technical Changes

### Backend (`server/`)
1. **New Files**:
   - `services/auth.js` - Authentication service
   - `db/schema.sql` - Database schema with users table
   
2. **Modified Files**:
   - `index.js` - Added auth routes and middleware
   - Updated all API endpoints to support optional authentication

3. **New Dependencies**:
   - `bcryptjs` - Password hashing
   - `jsonwebtoken` - JWT token generation
   - `express-session` - Session management
   - `cookie-parser` - Cookie handling

### Frontend (`client/`)
1. **New Files**:
   - `src/authContext.jsx` - Auth context provider
   - `src/Auth.jsx` - Login/register components
   
2. **Modified Files**:
   - `src/main.jsx` - Wrapped app in AuthProvider
   - `src/App.jsx` - Added auth checks and user menu
   - `src/api.js` - Include auth tokens in requests

### Configuration
1. **Environment Variables**:
   - Added `JWT_SECRET` for token signing
   - Updated `.env.example`

2. **Scripts**:
   - Added `npm run setup` for database initialization

## 📊 Database Schema

### New Tables

#### `users`
```sql
- id (SERIAL PRIMARY KEY)
- username (VARCHAR, UNIQUE)
- email (VARCHAR, UNIQUE)
- password_hash (VARCHAR)
- farm_id (VARCHAR, NULLABLE)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- last_login (TIMESTAMP)
```

#### `sessions` (optional)
```sql
- sid (VARCHAR PRIMARY KEY)
- sess (JSON)
- expire (TIMESTAMP)
```

### Modified Tables
- `chat_history` - Added `user_id` foreign key
- `farm_snapshots` - Added `user_id` foreign key

## 🚀 API Changes

### New Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user (protected)
- `PUT /api/auth/farm` - Update farm ID (protected)
- `PUT /api/auth/password` - Change password (protected)

### Modified Endpoints
All existing endpoints now support optional authentication:
- Farm data is user-specific if authenticated
- Chat history is user-specific if authenticated
- Snapshots are user-specific if authenticated

## 🔄 Migration Path

### From Single User to Multi-User

1. **Backup existing data**
   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. **Run setup script**
   ```bash
   npm run setup
   ```

3. **Create your user account**
   - Use the registration screen
   - Or create via database

4. **Link existing data** (optional)
   ```sql
   UPDATE chat_history SET user_id = 1 WHERE user_id IS NULL;
   UPDATE farm_snapshots SET user_id = 1 WHERE user_id IS NULL;
   ```

## 📦 Installation for New Users

1. **Clone and install**
   ```bash
   git clone <repo>
   cd sunflower-ai
   git checkout feature/public-auth
   npm install
   cd client && npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Setup database**
   ```bash
   npm run setup
   ```

4. **Start application**
   ```bash
   # Terminal 1
   npm run dev
   
   # Terminal 2
   cd client && npm run dev
   ```

5. **Access application**
   - Open http://localhost:5173
   - Use demo/demo123 or create new account

## 🎓 Demo Account

For testing purposes, the setup script creates:
- **Username**: demo
- **Password**: demo123
- **Email**: demo@sunflower-ai.local

## 🔜 Future Enhancements

Potential additions for future releases:
- [ ] Email verification
- [ ] Password reset via email
- [ ] Social auth (Google, Discord)
- [ ] Two-factor authentication
- [ ] User settings page
- [ ] Admin dashboard
- [ ] User roles and permissions
- [ ] API rate limiting per user
- [ ] User activity logs
- [ ] Account deletion

## 📋 Testing Checklist

Before merging to main:
- [x] Registration works
- [x] Login works
- [x] Protected routes check auth
- [x] User menu displays correctly
- [x] Logout clears session
- [x] API includes auth headers
- [x] Dark mode works on auth screens
- [x] Setup script creates demo user
- [x] Database schema applies correctly
- [x] Error messages are user-friendly

## 🔗 Related Documentation

- [README_PUBLIC.md](./README_PUBLIC.md) - User-facing documentation
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment instructions
- [.env.example](./.env.example) - Environment configuration

## 🤝 Contributing

When contributing to this branch:
1. Follow existing auth patterns
2. Test with both authenticated and anonymous users
3. Update documentation for new features
4. Maintain backward compatibility where possible

---

**Branch**: `feature/public-auth`  
**Base**: `master`  
**Status**: ✅ Ready for review/merge  
**Created**: 2026-09-07
