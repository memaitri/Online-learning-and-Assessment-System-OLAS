#!/bin/bash

echo "🔄 OLAS - Migrating to MySQL"
echo "=============================="
echo ""

# Check if MySQL is installed
if ! command -v mysql &> /dev/null; then
    echo "❌ MySQL is not installed!"
    echo "Please install MySQL first:"
    echo "  - Windows: https://dev.mysql.com/downloads/mysql/"
    echo "  - macOS: brew install mysql"
    echo "  - Linux: sudo apt-get install mysql-server"
    exit 1
fi

echo "✅ MySQL is installed"
echo ""

# Prompt for MySQL credentials
read -p "Enter MySQL username (default: root): " MYSQL_USER
MYSQL_USER=${MYSQL_USER:-root}

read -sp "Enter MySQL password: " MYSQL_PASS
echo ""

read -p "Enter database name (default: olas): " DB_NAME
DB_NAME=${DB_NAME:-olas}

read -p "Enter MySQL host (default: localhost): " MYSQL_HOST
MYSQL_HOST=${MYSQL_HOST:-localhost}

read -p "Enter MySQL port (default: 3306): " MYSQL_PORT
MYSQL_PORT=${MYSQL_PORT:-3306}

echo ""
echo "📝 Configuration:"
echo "  User: $MYSQL_USER"
echo "  Host: $MYSQL_HOST"
echo "  Port: $MYSQL_PORT"
echo "  Database: $DB_NAME"
echo ""

# Test MySQL connection
echo "🔍 Testing MySQL connection..."
mysql -u "$MYSQL_USER" -p"$MYSQL_PASS" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -e "SELECT 1;" &> /dev/null

if [ $? -ne 0 ]; then
    echo "❌ Failed to connect to MySQL!"
    echo "Please check your credentials and try again."
    exit 1
fi

echo "✅ MySQL connection successful"
echo ""

# Create database
echo "📦 Creating database '$DB_NAME'..."
mysql -u "$MYSQL_USER" -p"$MYSQL_PASS" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Database created/verified"
else
    echo "⚠️  Database might already exist (this is OK)"
fi

echo ""

# Update .env file
DATABASE_URL="mysql://$MYSQL_USER:$MYSQL_PASS@$MYSQL_HOST:$MYSQL_PORT/$DB_NAME"

echo "📝 Updating .env file..."
if [ -f .env ]; then
    # Backup existing .env
    cp .env .env.backup
    echo "✅ Backed up existing .env to .env.backup"
    
    # Update DATABASE_URL
    if grep -q "^DATABASE_URL=" .env; then
        sed -i.tmp "s|^DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"|" .env
        rm -f .env.tmp
        echo "✅ Updated DATABASE_URL in .env"
    else
        echo "DATABASE_URL=\"$DATABASE_URL\"" >> .env
        echo "✅ Added DATABASE_URL to .env"
    fi
else
    echo "❌ .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "DATABASE_URL=\"$DATABASE_URL\"" >> .env
    echo "✅ Created .env file"
fi

echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npm run prisma:generate

if [ $? -ne 0 ]; then
    echo "❌ Failed to generate Prisma client"
    exit 1
fi

echo "✅ Prisma client generated"
echo ""

# Push schema to database
echo "🚀 Pushing schema to MySQL..."
npm run prisma:push

if [ $? -ne 0 ]; then
    echo "❌ Failed to push schema"
    exit 1
fi

echo "✅ Schema pushed to MySQL"
echo ""

# Seed database
read -p "Do you want to seed the database with sample data? (y/n): " SEED_DB

if [ "$SEED_DB" = "y" ] || [ "$SEED_DB" = "Y" ]; then
    echo "🌱 Seeding database..."
    npm run seed
    
    if [ $? -eq 0 ]; then
        echo "✅ Database seeded successfully"
        echo ""
        echo "📋 Default credentials:"
        echo "  Admin:   admin@olas.com / admin123"
        echo "  Faculty: faculty@olas.com / faculty123"
        echo "  Student: student@olas.com / student123"
    else
        echo "⚠️  Seeding failed (you can run 'npm run seed' later)"
    fi
fi

echo ""
echo "=============================="
echo "✅ Migration Complete!"
echo "=============================="
echo ""
echo "🚀 Next steps:"
echo "  1. Start the server: npm run dev"
echo "  2. Start the client: cd ../client && npm run dev"
echo "  3. Open http://localhost:5173"
echo ""
echo "📚 For more info, see MYSQL_SETUP.md"
