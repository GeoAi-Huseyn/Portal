const fs = require('fs');
const path = require('path');
const { Pool, Client } = require('pg');
require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = parseInt(process.env.DB_PORT || '5432');
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || 'portal_db';

async function main() {
  console.log(`Connecting to PostgreSQL server at ${dbHost}:${dbPort} as user "${dbUser}"...`);

  // Step 1: Connect to default postgres DB to ensure target database exists
  const sysClient = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: 'postgres',
  });

  try {
    await sysClient.connect();
    console.log('Connected to PostgreSQL system instance.');

    // Check if database exists
    const dbCheck = await sysClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (dbCheck.rows.length === 0) {
      console.log(`Database "${dbName}" does not exist. Creating...`);
      await sysClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created successfully!`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.error('System connection error:', err.message);
    process.exit(1);
  } finally {
    await sysClient.end();
  }

  // Step 2: Connect to target database and apply schema + seed
  const pool = new Pool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  });

  try {
    const schemaSqlPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      console.log('Applying schema.sql...');
      const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
      await pool.query(schemaSql);
      console.log('schema.sql executed successfully!');
    }

    const seedSqlPath = path.join(__dirname, 'seed.sql');
    if (fs.existsSync(seedSqlPath)) {
      console.log('Applying seed.sql...');
      const seedSql = fs.readFileSync(seedSqlPath, 'utf8');
      await pool.query(seedSql);
      console.log('seed.sql executed successfully!');
    }

    console.log('\n✅ Database import completed successfully!');
  } catch (err) {
    console.error('Import error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
