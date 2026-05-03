import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || 'postgres://127.0.0.1:5432/hams';
const pool = new Pool({ connectionString });

try {
  const hash = await bcrypt.hash('Password@123', 10);
  const result = await pool.query("UPDATE users SET password_hash = $1 WHERE email LIKE '%@hams.aero'", [hash]);
  console.log(`updated_rows=${result.rowCount}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
