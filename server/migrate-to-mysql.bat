@echo off
setlocal enabledelayedexpansion

echo ========================================
echo OLAS - Migrating to MySQL (Windows)
echo ========================================
echo.

REM Check if MySQL is installed
where mysql >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] MySQL is not installed!
    echo Please install MySQL first:
    echo   https://dev.mysql.com/downloads/mysql/
    echo.
    pause
    exit /b 1
)

echo [OK] MySQL is installed
echo.

REM Prompt for MySQL credentials
set /p MYSQL_USER="Enter MySQL username (default: root): "
if "%MYSQL_USER%"=="" set MYSQL_USER=root

set /p MYSQL_PASS="Enter MySQL password: "

set /p DB_NAME="Enter database name (default: olas): "
if "%DB_NAME%"=="" set DB_NAME=olas

set /p MYSQL_HOST="Enter MySQL host (default: localhost): "
if "%MYSQL_HOST%"=="" set MYSQL_HOST=localhost

set /p MYSQL_PORT="Enter MySQL port (default: 3306): "
if "%MYSQL_PORT%"=="" set MYSQL_PORT=3306

echo.
echo Configuration:
echo   User: %MYSQL_USER%
echo   Host: %MYSQL_HOST%
echo   Port: %MYSQL_PORT%
echo   Database: %DB_NAME%
echo.

REM Test MySQL connection
echo Testing MySQL connection...
mysql -u %MYSQL_USER% -p%MYSQL_PASS% -h %MYSQL_HOST% -P %MYSQL_PORT% -e "SELECT 1;" >nul 2>nul

if %errorlevel% neq 0 (
    echo [ERROR] Failed to connect to MySQL!
    echo Please check your credentials and try again.
    pause
    exit /b 1
)

echo [OK] MySQL connection successful
echo.

REM Create database
echo Creating database '%DB_NAME%'...
mysql -u %MYSQL_USER% -p%MYSQL_PASS% -h %MYSQL_HOST% -P %MYSQL_PORT% -e "CREATE DATABASE IF NOT EXISTS %DB_NAME%;" 2>nul

if %errorlevel% equ 0 (
    echo [OK] Database created/verified
) else (
    echo [WARNING] Database might already exist (this is OK)
)

echo.

REM Update .env file
set DATABASE_URL=mysql://%MYSQL_USER%:%MYSQL_PASS%@%MYSQL_HOST%:%MYSQL_PORT%/%DB_NAME%

echo Updating .env file...
if exist .env (
    REM Backup existing .env
    copy .env .env.backup >nul
    echo [OK] Backed up existing .env to .env.backup
    
    REM Create new .env with updated DATABASE_URL
    powershell -Command "(Get-Content .env) -replace '^DATABASE_URL=.*', 'DATABASE_URL=\"%DATABASE_URL%\"' | Set-Content .env.tmp"
    move /y .env.tmp .env >nul
    echo [OK] Updated DATABASE_URL in .env
) else (
    echo [ERROR] .env file not found!
    echo Creating .env from .env.example...
    copy .env.example .env >nul
    echo DATABASE_URL="%DATABASE_URL%" >> .env
    echo [OK] Created .env file
)

echo.

REM Install dependencies
echo Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo [OK] Dependencies installed
echo.

REM Generate Prisma client
echo Generating Prisma client...
call npm run prisma:generate

if %errorlevel% neq 0 (
    echo [ERROR] Failed to generate Prisma client
    pause
    exit /b 1
)

echo [OK] Prisma client generated
echo.

REM Push schema to database
echo Pushing schema to MySQL...
call npm run prisma:push

if %errorlevel% neq 0 (
    echo [ERROR] Failed to push schema
    pause
    exit /b 1
)

echo [OK] Schema pushed to MySQL
echo.

REM Seed database
set /p SEED_DB="Do you want to seed the database with sample data? (y/n): "

if /i "%SEED_DB%"=="y" (
    echo Seeding database...
    call npm run seed
    
    if %errorlevel% equ 0 (
        echo [OK] Database seeded successfully
        echo.
        echo Default credentials:
        echo   Admin:   admin@olas.com / admin123
        echo   Faculty: faculty@olas.com / faculty123
        echo   Student: student@olas.com / student123
    ) else (
        echo [WARNING] Seeding failed (you can run 'npm run seed' later)
    )
)

echo.
echo ========================================
echo Migration Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Start the server: npm run dev
echo   2. Start the client: cd ..\client ^&^& npm run dev
echo   3. Open http://localhost:5173
echo.
echo For more info, see MYSQL_SETUP.md
echo.
pause
