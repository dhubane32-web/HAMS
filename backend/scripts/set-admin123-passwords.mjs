import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgres://127.0.0.1:5432/hams' });

try {
  const hash = await bcrypt.hash('Admin123!', 10);
  const emails = ['admin@hams.aero', 'finance@hams.aero', 'ops@hams.aero', 'agent@hams.aero', 'crew@hams.aero', 'mx@hams.aero'];
  const result = await pool.query('UPDATE users SET password_hash = $1 WHERE email = ANY($2)', [hash, emails]);
  console.log(`updated_rows=${result.rowCount}`);
} finally {
  await pool.end();
}
