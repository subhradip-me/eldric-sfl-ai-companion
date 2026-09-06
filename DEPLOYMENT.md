# 🚀 Deployment Guide

This guide will help you deploy Sunflower AI to production.

## 📋 Pre-Deployment Checklist

- [ ] Change `JWT_SECRET` to a strong random value (use `openssl rand -base64 32`)
- [ ] Set up a production PostgreSQL database
- [ ] Obtain a Groq API key
- [ ] Configure domain and SSL certificates
- [ ] Set up environment variables on hosting platform
- [ ] Test the application locally first

## 🔧 Deployment Options

### Option 1: Heroku (Recommended for Beginners)

#### Backend Deployment

1. **Install Heroku CLI**
   ```bash
   # macOS
   brew tap heroku/brew && brew install heroku
   
   # Windows
   # Download from https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **Create Heroku App**
   ```bash
   heroku create sunflower-ai-backend
   ```

3. **Add PostgreSQL**
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

4. **Set Environment Variables**
   ```bash
   heroku config:set GROQ_API_KEY=your_key_here
   heroku config:set JWT_SECRET=$(openssl rand -base64 32)
   heroku config:set NODE_ENV=production
   ```

5. **Deploy**
   ```bash
   git push heroku feature/public-auth:main
   ```

6. **Run Database Setup**
   ```bash
   heroku run npm run setup
   ```

#### Frontend Deployment (Vercel)

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy from client directory**
   ```bash
   cd client
   vercel
   ```

3. **Set Environment Variable**
   ```bash
   vercel env add VITE_API_URL
   # Enter your Heroku backend URL
   ```

4. **Update client/src/api.js**
   ```javascript
   const API_URL = import.meta.env.VITE_API_URL || '/api';
   const get = (p) => fetch(`${API_URL}/${p}`, {
     headers: getAuthHeaders()
   }).then((r) => r.json());
   ```

### Option 2: Railway

1. **Sign up at railway.app**

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your repository

3. **Add PostgreSQL**
   - Click "+ New"
   - Select "Database" → "PostgreSQL"

4. **Configure Environment Variables**
   ```
   GROQ_API_KEY=your_key_here
   JWT_SECRET=your_random_secret
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

5. **Deploy**
   - Railway will auto-deploy on push

### Option 3: Render

#### Backend

1. **Create Web Service**
   - Go to render.com
   - New → Web Service
   - Connect your GitHub repo

2. **Configure**
   - Name: `sunflower-ai`
   - Build Command: `npm install`
   - Start Command: `npm start`

3. **Add PostgreSQL**
   - Dashboard → New → PostgreSQL
   - Copy the internal database URL

4. **Environment Variables**
   ```
   DATABASE_URL=your_internal_postgres_url
   GROQ_API_KEY=your_key
   JWT_SECRET=your_secret
   NODE_ENV=production
   ```

#### Frontend

1. **Create Static Site**
   - New → Static Site
   - Root Directory: `client`
   - Build Command: `npm install && npm run build`
   - Publish Directory: `dist`

2. **Environment Variable**
   ```
   VITE_API_URL=https://your-backend.onrender.com/api
   ```

### Option 4: Self-Hosted (VPS)

#### Requirements
- Ubuntu 20.04+ or similar
- Node.js 18+
- PostgreSQL 14+
- Nginx
- SSL certificate (Let's Encrypt)

#### Setup Steps

1. **Install Dependencies**
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install PostgreSQL
   sudo apt install postgresql postgresql-contrib -y
   
   # Install Nginx
   sudo apt install nginx -y
   ```

2. **Set up PostgreSQL**
   ```bash
   sudo -u postgres psql
   CREATE DATABASE sunflower;
   CREATE USER sfluser WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE sunflower TO sfluser;
   \q
   ```

3. **Clone and Setup Application**
   ```bash
   cd /var/www
   git clone <your-repo> sunflower-ai
   cd sunflower-ai
   npm install
   cd client && npm install && npm run build
   ```

4. **Create .env file**
   ```bash
   cat > .env << EOF
   DATABASE_URL=postgres://sfluser:your_password@localhost:5432/sunflower
   GROQ_API_KEY=your_key
   JWT_SECRET=$(openssl rand -base64 32)
   NODE_ENV=production
   PORT=3000
   EOF
   ```

5. **Run Database Setup**
   ```bash
   npm run setup
   ```

6. **Create systemd service**
   ```bash
   sudo nano /etc/systemd/system/sunflower-ai.service
   ```
   
   Add:
   ```ini
   [Unit]
   Description=Sunflower AI
   After=network.target
   
   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/sunflower-ai
   ExecStart=/usr/bin/node server/index.js
   Restart=on-failure
   Environment=NODE_ENV=production
   
   [Install]
   WantedBy=multi-user.target
   ```
   
   Enable and start:
   ```bash
   sudo systemctl enable sunflower-ai
   sudo systemctl start sunflower-ai
   ```

7. **Configure Nginx**
   ```bash
   sudo nano /etc/nginx/sites-available/sunflower-ai
   ```
   
   Add:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       # Frontend
       location / {
           root /var/www/sunflower-ai/client/dist;
           try_files $uri $uri/ /index.html;
       }
       
       # Backend API
       location /api {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   
   Enable site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/sunflower-ai /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

8. **Set up SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d your-domain.com
   ```

## 🔒 Security Best Practices

1. **Environment Variables**
   - Never commit `.env` file
   - Use strong, random `JWT_SECRET`
   - Rotate secrets periodically

2. **Database**
   - Use strong passwords
   - Enable SSL connections
   - Regular backups
   - Limit connection pool size

3. **CORS**
   Update `server/index.js`:
   ```javascript
   app.use(cors({
     origin: process.env.CLIENT_URL || 'http://localhost:5173',
     credentials: true
   }));
   ```

4. **Rate Limiting**
   ```bash
   npm install express-rate-limit
   ```
   
   Add to `server/index.js`:
   ```javascript
   import rateLimit from 'express-rate-limit';
   
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each IP to 100 requests per windowMs
   });
   
   app.use('/api/', limiter);
   ```

5. **Helmet**
   ```bash
   npm install helmet
   ```
   
   Add to `server/index.js`:
   ```javascript
   import helmet from 'helmet';
   app.use(helmet());
   ```

## 📊 Monitoring

### Option 1: PM2 (Self-hosted)
```bash
npm install -g pm2
pm2 start server/index.js --name sunflower-ai
pm2 startup
pm2 save
```

### Option 2: Sentry (Error Tracking)
```bash
npm install @sentry/node
```

## 🔄 Updates and Maintenance

1. **Pull latest changes**
   ```bash
   git pull origin main
   npm install
   cd client && npm install && npm run build
   ```

2. **Restart services**
   ```bash
   # Systemd
   sudo systemctl restart sunflower-ai
   
   # PM2
   pm2 restart sunflower-ai
   
   # Heroku
   git push heroku main
   ```

3. **Database migrations**
   - Always backup before migrations
   - Test migrations on staging first
   - Run migrations during low-traffic periods

## 🆘 Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Application Won't Start
```bash
# Check logs
sudo journalctl -u sunflower-ai -f

# Or with PM2
pm2 logs sunflower-ai
```

### CORS Errors
- Verify `CLIENT_URL` in environment variables
- Check CORS configuration in `server/index.js`

## 📝 Notes

- Always test in staging before production
- Keep dependencies updated
- Monitor logs regularly
- Set up automated backups
- Use environment-specific configs

## 🔗 Useful Links

- [Heroku Documentation](https://devcenter.heroku.com/)
- [Vercel Documentation](https://vercel.com/docs)
- [Railway Documentation](https://docs.railway.app/)
- [Render Documentation](https://render.com/docs)
- [Let's Encrypt](https://letsencrypt.org/)
- [PM2 Documentation](https://pm2.keymetrics.io/)
