# 🌻 Sunflower AI - Farm Assistant

An AI-powered assistant for Sunflower Land that helps you optimize your farm, plan your activities, and reach Level 100 efficiently.

## ✨ Features

- **📊 Farm Dashboard**: Real-time overview of your farm stats, XP, and progress
- **🗺️ Smart Planner**: AI-powered recipe recommendations optimized for XP gain
- **💰 Market Analysis**: Track your inventory value and item prices
- **📈 Activity Tracking**: Monitor your farm activities and progress over time
- **📜 Quest Management**: Keep track of chores, deliveries, and bounties
- **🤖 AI Chat Assistant**: Ask questions about your farm and get intelligent recommendations
- **🔐 User Authentication**: Secure accounts with personal farm data
- **🌙 Dark Mode**: Beautiful dark theme with custom color palette
- **💾 Session History**: Review past conversations with the AI

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Groq API key (for AI features)
- Sunflower Land account

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd sunflower-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your configuration:
   ```env
   # Required
   GROQ_API_KEY=your_groq_api_key_here
   JWT_SECRET=your_random_secret_key_here
   DATABASE_URL=postgres://user:password@localhost:5432/sunflower
   
   # Optional (for personal farm tracking)
   SUNFLOWER_API_KEY=your_api_key
   SUNFLOWER_FARM_ID=your_farm_id
   ```

4. **Set up the database**
   ```bash
   # Start PostgreSQL (if using Docker)
   docker-compose up -d
   
   # Run the schema
   psql $DATABASE_URL < server/db/schema.sql
   ```

5. **Start the application**
   ```bash
   # Terminal 1: Start the server
   npm run dev
   
   # Terminal 2: Start the client
   cd client && npm run dev
   ```

6. **Open your browser**
   Navigate to `http://localhost:5173`

## 🔐 Authentication

### Registration

1. Click "Create Account" on the login screen
2. Enter username, email, and password
3. Optionally add your Sunflower Farm ID
4. Click "Create Account"

### Login

Use your username and password to login. Demo credentials are also available:
- Username: `demo`
- Password: `demo123`

## 📖 Usage

### Dashboard
View your farm stats, current level, XP progress, and active plans.

### Planner
Get AI-powered recommendations for the best recipes to craft based on your inventory and available buildings.

### Market
Track your inventory's market value and sort items by value, price, or name.

### Activity
See changes in your farm between snapshots, including XP gained and inventory movements.

### Quests
Manage your chore board, deliveries, and animal bounties.

### Chat Assistant
Ask questions like:
- "What should I do today?"
- "Current bottleneck?"
- "How much FLOWER to reach Level 100?"
- "What do I need for my next expansion?"

## 🛠️ API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user (requires auth)
- `PUT /api/auth/farm` - Update farm ID (requires auth)
- `PUT /api/auth/password` - Change password (requires auth)

### Farm Data
- `GET /api/farm` - Get farm data
- `GET /api/market` - Get market prices
- `GET /api/planner` - Get optimized plan
- `GET /api/activity` - Get activity diff

### Chat
- `POST /api/chat` - Send message to AI
- `GET /api/sessions` - List chat sessions
- `GET /api/sessions/:id` - Get session messages

## 🎨 Dark Mode

The app includes a custom dark mode with a sleek color palette:
- Background: Pure Black (#000000)
- Cards: Dark Grey (#212121)
- Accents: Medium Grey (#303030)
- Borders: Light Grey (#424242)

Toggle between light and dark modes using the button in the sidebar.

## 🔒 Security

- Passwords are hashed using bcrypt with 10 salt rounds
- JWT tokens for stateless authentication
- Secure HTTP-only cookies (recommended for production)
- SQL injection protection via parameterized queries
- CORS configuration for production deployment

## 📝 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Your Groq API key for AI features |
| `JWT_SECRET` | Yes | Secret key for JWT token signing |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SUNFLOWER_API_KEY` | No | Your Sunflower Land API key |
| `SUNFLOWER_FARM_ID` | No | Your farm ID for personal tracking |
| `PORT` | No | Server port (default: 3000) |

## 🚢 Deployment

### Recommended Setup

1. **Database**: Use managed PostgreSQL (AWS RDS, Heroku Postgres, Supabase)
2. **Backend**: Deploy to Heroku, Railway, or Render
3. **Frontend**: Deploy to Vercel, Netlify, or Cloudflare Pages

### Production Checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Set up HTTPS/SSL certificates
- [ ] Configure CORS for your domain
- [ ] Set up database backups
- [ ] Enable rate limiting
- [ ] Monitor error logs
- [ ] Set up analytics (optional)

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Sunflower Land team for the amazing game
- Groq for the fast AI inference
- The open-source community

## 📧 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Join our Discord community (coming soon)

---

Made with 🌻 and ☕ for the Sunflower Land community
