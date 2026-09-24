const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

async function setupDatabase() {
    console.log('🚀 Starting database setup...\n');

    // Create connection without database selected
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    try {
        // Create database if it doesn't exist
        const dbName = process.env.DB_NAME || 'casino_platform';
        console.log(`📦 Creating database "${dbName}" if it doesn't exist...`);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await connection.query(`USE \`${dbName}\``);
        console.log('✅ Database ready\n');

        // Read and execute schema
        console.log('📋 Creating tables from schema...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await connection.query(schema);
        console.log('✅ Tables created\n');

        // Read and execute seed data
        console.log('🌱 Seeding initial data...');
        const seedPath = path.join(__dirname, 'seed.sql');
        const seed = fs.readFileSync(seedPath, 'utf8');
        await connection.query(seed);
        console.log('✅ Seed data inserted\n');

        // Create owner account
        console.log('👑 Creating owner account...');
        const ownerId = uuidv4();
        const ownerEmail = process.env.OWNER_EMAIL || 'owner@example.com';
        const ownerUsername = process.env.OWNER_USERNAME || 'owner';
        const ownerPassword = process.env.OWNER_PASSWORD || 'OwnerPassword123!';
        const passwordHash = await bcrypt.hash(ownerPassword, 12);
        const startingBalance = 100.00000000;

        await connection.query(`
            INSERT INTO users (id, username, email, password_hash, role, balance)
            VALUES (?, ?, ?, ?, 'owner', ?)
        `, [ownerId, ownerUsername, ownerEmail, passwordHash, startingBalance]);

        // Log the owner creation
        await connection.query(`
            INSERT INTO audit_logs (id, user_id, action, amount_change, balance_before, balance_after, reason)
            VALUES (?, ?, 'account_created', ?, 0, ?, 'Owner account created during setup')
        `, [uuidv4(), ownerId, startingBalance, startingBalance]);

        console.log('✅ Owner account created\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎰 DATABASE SETUP COMPLETE!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`\n📧 Owner Email: ${ownerEmail}`);
        console.log(`👤 Owner Username: ${ownerUsername}`);
        console.log(`🔐 Owner Password: ${ownerPassword}`);
        console.log(`💰 Starting Balance: ${startingBalance} credits\n`);
        console.log('⚠️  IMPORTANT: Change the owner password in .env file!\n');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

setupDatabase().catch(console.error);