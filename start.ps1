# Sunflower AI Startup Script for Windows
Write-Host "🌻 Starting Sunflower AI..." -ForegroundColor Yellow
Write-Host ""

# Check if PostgreSQL is running
Write-Host "Checking PostgreSQL..." -ForegroundColor Cyan
try {
    $pgProcess = Get-Process postgres -ErrorAction SilentlyContinue
    if ($pgProcess) {
        Write-Host "✅ PostgreSQL is running" -ForegroundColor Green
    } else {
        Write-Host "⚠️  PostgreSQL might not be running" -ForegroundColor Yellow
        Write-Host "   Start it with: docker-compose up -d" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️  Could not check PostgreSQL status" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Starting servers..." -ForegroundColor Cyan
Write-Host "⚠️  This will open TWO terminal windows:" -ForegroundColor Yellow
Write-Host "   1. Backend Server (port 3000)" -ForegroundColor Gray
Write-Host "   2. Frontend Dev Server (port 5173)" -ForegroundColor Gray
Write-Host ""
Write-Host "📝 Access the app at: http://localhost:5173" -ForegroundColor Green
Write-Host "🔑 Demo login: demo / demo123" -ForegroundColor Green
Write-Host ""

# Start backend in new window
Write-Host "Starting backend server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm start"

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start frontend in new window
Write-Host "Starting frontend dev server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\client'; npm run dev"

Write-Host ""
Write-Host "✅ Servers are starting!" -ForegroundColor Green
Write-Host "   Wait a few seconds, then open: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
