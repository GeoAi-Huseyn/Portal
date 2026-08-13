const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Test DB Connection + Auto-fix sequences on startup
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error acquiring client', err.stack);
    return;
  }
  console.log('Connected to PostgreSQL successfully!');
  release();

  // Auto-fix sequences after CSV imports or manual DB inserts
  const tables = ['employees', 'departments', 'sectors', 'positions', 'portal_users', 'employee_edit_requests'];
  try {
    for (const t of tables) {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 1), 1))`
      );
    }
    console.log('Sequences auto-synced with max IDs.');
  } catch (e) {
    // Silently ignore if a table doesn't have a sequence (safe to skip)
    console.warn('Sequence sync warning:', e.message);
  }
});

/* ─── DOMAIN TABLES API ─── */

// POST /api/admin/sync-sequences — manually trigger sequence sync
app.post('/api/admin/sync-sequences', async (req, res) => {
  const tables = ['employees', 'departments', 'sectors', 'positions', 'portal_users', 'employee_edit_requests'];
  const results = {};
  try {
    for (const t of tables) {
      const r = await pool.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 1), 1))`
      );
      results[t] = r.rows[0].setval;
    }
    console.log('Manual sequence sync done:', results);
    res.json({ success: true, sequences: results });
  } catch (err) {
    console.error('Sequence sync error:', err.message);
    res.status(500).json({ error: 'Sequence sync failed', details: err.message });
  }
});

// GET all domains in one call (departments + sectors + positions)
app.get('/api/domains', async (req, res) => {
  try {
    const [depts, sectors, positions] = await Promise.all([
      pool.query('SELECT * FROM departments ORDER BY id ASC'),
      pool.query('SELECT * FROM sectors ORDER BY id ASC'),
      pool.query('SELECT * FROM positions ORDER BY id ASC'),
    ]);
    res.json({
      departments: depts.rows,
      sectors: sectors.rows,
      positions: positions.rows,
      system_positions: []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Departments ──

app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departments ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO departments (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu şöbə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE departments SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu şöbə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE dept_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu şöbə əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Sectors ──

app.get('/api/sectors', async (req, res) => {
  const { dept_id } = req.query;
  try {
    let query = 'SELECT * FROM sectors';
    const params = [];
    if (dept_id) { query += ' WHERE dept_id = $1'; params.push(dept_id); }
    query += ' ORDER BY id ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/sectors', async (req, res) => {
  const { name, dept_id } = req.body;
  if (!name || !name.trim() || !dept_id) return res.status(400).json({ error: 'name and dept_id are required' });
  try {
    const result = await pool.query(
      'INSERT INTO sectors (name, dept_id) VALUES ($1, $2) RETURNING *',
      [name.trim(), dept_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu sektor artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/sectors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, dept_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE sectors SET name = $1, dept_id = COALESCE($2, dept_id) WHERE id = $3 RETURNING *',
      [name.trim(), dept_id || null, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu sektor artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/sectors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE sector_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu sektor əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM sectors WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Positions ──

app.get('/api/positions', async (req, res) => {
  const { sector_id, dept_id } = req.query;
  try {
    let result;
    if (sector_id) {
      result = await pool.query(
        'SELECT DISTINCT p.* FROM positions p JOIN employees e ON e.position_id = p.id WHERE e.sector_id = $1 ORDER BY p.id ASC',
        [sector_id]
      );
    } else if (dept_id) {
      result = await pool.query(
        'SELECT DISTINCT p.* FROM positions p JOIN employees e ON e.position_id = p.id WHERE e.dept_id = $1 ORDER BY p.id ASC',
        [dept_id]
      );
    } else {
      result = await pool.query('SELECT * FROM positions ORDER BY id ASC');
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/positions', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO positions (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu vəzifə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/positions/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    // Check if the current position is a system position
    const current = await pool.query('SELECT name FROM positions WHERE id = $1', [id]);
    if (current.rows.length > 0) {
      const systemPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];
      if (systemPositions.includes(current.rows[0].name.toUpperCase())) {
        return res.status(403).json({ error: 'Sistem vəzifəsi redaktə edilə bilməz!' });
      }
    }

    const result = await pool.query(
      'UPDATE positions SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu vəzifə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/positions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if the current position is a system position
    const current = await pool.query('SELECT name FROM positions WHERE id = $1', [id]);
    if (current.rows.length > 0) {
      const systemPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];
      if (systemPositions.includes(current.rows[0].name.toUpperCase())) {
        return res.status(403).json({ error: 'Sistem vəzifəsi silinə bilməz!' });
      }
    }

    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE position_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu vəzifə əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM positions WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── EMPLOYEES API ─── */

app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.*,
        d.name  AS dept_name,
        s.name  AS sector_name,
        p.name  AS position_name,
        s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      ORDER BY e.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Add new employee (accepts dept_id, sector_id, position_id)
app.post('/api/employees', async (req, res) => {
  const { name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate } = req.body;

  try {
    const normalizedEmail = (email && String(email).trim()) || null;
    const result = await pool.query(
      `INSERT INTO employees (name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, position_id || null, dept_id || null, sector_id || null, normalizedEmail, intphone || null, mobile || null, room || null, car_plate || null]
    );
    const full = await pool.query(`
      SELECT e.*, d.name AS dept_name, s.name AS sector_name, p.name AS position_name, s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      WHERE e.id = $1
    `, [result.rows[0].id]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23502') {
      return res.status(400).json({ error: 'Məcburi sahələr doldurulmalıdır', details: err.message });
    }
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update employee
app.patch('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const allowed = ['name', 'position_id', 'dept_id', 'sector_id', 'email', 'intphone', 'mobile', 'room', 'car_plate'];
  const setClauses = [];
  const values = [];
  let index = 1;

  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    let normalized = value === '' ? null : value;
    if (key === 'email') normalized = (value && String(value).trim()) || null;
    setClauses.push(`${key} = $${index}`);
    values.push(normalized);
    index++;
  }

  if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE employees SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${index} RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });

    const full = await pool.query(`
      SELECT e.*, d.name AS dept_name, s.name AS sector_name, p.name AS position_name, s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      WHERE e.id = $1
    `, [id]);
    res.json(full.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Delete employee
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM employees WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── EDIT REQUESTS API ─── */

// Get edit requests (supports filtering by status)
app.get('/api/employee_edit_requests', async (req, res) => {
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM employee_edit_requests';
    const params = [];
    if (status) { query += ' WHERE status = $1'; params.push(status); }
    query += ' ORDER BY requested_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Get pending request count
app.get('/api/employee_edit_requests/count', async (req, res) => {
  const { status } = req.query;
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM employee_edit_requests WHERE status = $1',
      [status || 'pending']
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Create edit request
app.post('/api/employee_edit_requests', async (req, res) => {
  const { employee_id, employee_name, old_data, new_data, status, requested_by, request_type } = req.body;
  try {
    if (employee_id) {
      const empRes = await pool.query('SELECT dept_id FROM employees WHERE id = $1', [employee_id]);
      if (empRes.rows.length > 0 && Number(empRes.rows[0].dept_id) === 1) {
        return res.status(403).json({ error: 'Rəhbərlik şöbəsindəki əməkdaşlar üçün redaktə sorğusu göndərilə bilməz!' });
      }
    }
    const result = await pool.query(
      `INSERT INTO employee_edit_requests (employee_id, employee_name, old_data, new_data, status, requested_by, request_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [employee_id || null, employee_name, JSON.stringify(old_data), JSON.stringify(new_data), status || 'pending', requested_by, request_type || 'edit']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update edit request status (approve/reject)
// If approving a new_employee request, the employee is automatically created.
app.patch('/api/employee_edit_requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status, resolved_at } = req.body;
  try {
    // Fetch the request to check its type
    const reqResult = await pool.query('SELECT * FROM employee_edit_requests WHERE id = $1', [id]);
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const editReq = reqResult.rows[0];

    // If approving a new_employee request, create the employee automatically
    if (status === 'approved' && editReq.request_type === 'new_employee') {
      const d = editReq.new_data || {};
      const normalizedEmail = (d.email && String(d.email).trim()) || null;
      await pool.query(
        `INSERT INTO employees (name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          d.name, d.position_id || null,
          d.dept_id || null, d.sector_id || null,
          normalizedEmail, d.intphone || null, d.mobile || null, d.room || null, d.car_plate || null
        ]
      );
    }

    const result = await pool.query(
      `UPDATE employee_edit_requests SET status = $1, resolved_at = $2 WHERE id = $3 RETURNING *`,
      [status, resolved_at || new Date().toISOString(), id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── PORTAL USERS API ─── */

// Get all portal users
app.get('/api/portal_users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_users ORDER BY username ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update user password
app.patch('/api/portal_users/:id', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    let hashedPassword = password;
    if (password) {
      const bcrypt = require('bcrypt');
      hashedPassword = await bcrypt.hash(password, 10);
    }
    
    const result = await pool.query(
      'UPDATE portal_users SET password = $1 WHERE id = $2 RETURNING *',
      [hashedPassword, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Authenticate Admin / Portal Users
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'İstifadəçi adı və şifrə daxil edilməlidir' });
  }
  try {
    const result = await pool.query(
      'SELECT id, username, role, password FROM portal_users WHERE LOWER(username) = LOWER($1) AND is_active = true',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'İstifadəçi adı və ya şifrə yanlışdır!' });
    }
    const user = result.rows[0];
    
    // Hash müqayisəsi
    const bcrypt = require('bcrypt');
    const isMatch = await bcrypt.compare(password, user.password);
    
    // Keçmişdə yaradılan düz (plain-text) şifrələrin müvəqqəti işləməsi üçün:
    if (!isMatch && user.password !== password) {
      return res.status(401).json({ error: 'Şifrə yanlışdır!' });
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

/* ─── CSV IMPORT API ─── */

// POST /api/import/:table — JSON rows import
// Accepts: { rows: [{col: val, ...}, ...] }
// Supported tables: departments, sectors, positions, employees
app.post('/api/import/:table', async (req, res) => {
  const { table } = req.params;
  const allowedTables = ['departments', 'sectors', 'positions', 'employees'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Yanlış cədvəl adı' });
  }

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows massivi boş və ya yanlışdır' });
  }

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const r of rows) {
      try {
        if (table === 'departments') {
          const rawId = r.id || r.NO || r.no;
          const rawName = r.name || r['ŞÖBƏ'] || r['Şöbə'] || r['şöbə'];
          const id = rawId ? parseInt(rawId) : null;
          const name = rawName ? String(rawName).trim() : null;
          if (!name) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO departments (id, name) VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
              [id, name]
            );
          } else {
            await client.query(
              `INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
              [name]
            );
          }
          imported++;

        } else if (table === 'sectors') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          const deptId = r.dept_id ? parseInt(r.dept_id) : null;
          if (!name || !deptId) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO sectors (id, name, dept_id) VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, dept_id = EXCLUDED.dept_id`,
              [id, name, deptId]
            );
          } else {
            await client.query(
              `INSERT INTO sectors (name, dept_id) VALUES ($1, $2)
               ON CONFLICT (name, dept_id) DO NOTHING`,
              [name, deptId]
            );
          }
          imported++;

        } else if (table === 'positions') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          if (!name) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO positions (id, name) VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
              [id, name]
            );
          } else {
            await client.query(
              `INSERT INTO positions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
              [name]
            );
          }
          imported++;

        } else if (table === 'employees') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          if (!name) { skipped++; continue; }

          const email = r.email && String(r.email).trim() ? String(r.email).trim() : null;
          const intphone = r.intphone && String(r.intphone).trim() ? String(r.intphone).trim() : null;
          const mobile = r.mobile && String(r.mobile).trim() ? String(r.mobile).trim() : null;
          const room = r.room && String(r.room).trim() ? String(r.room).trim() : null;
          const carPlate = r.car_plate && String(r.car_plate).trim() ? String(r.car_plate).trim().toUpperCase() : null;
          const deptId = r.dept_id ? parseInt(r.dept_id) : null;
          const sectorId = r.sector_id ? parseInt(r.sector_id) : null;
          const positionId = r.position_id ? parseInt(r.position_id) : null;

          if (id) {
            await client.query(
              `INSERT INTO employees (id, name, email, intphone, mobile, room, car_plate, dept_id, sector_id, position_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name, email = EXCLUDED.email,
                 intphone = EXCLUDED.intphone, mobile = EXCLUDED.mobile,
                 room = EXCLUDED.room, car_plate = EXCLUDED.car_plate,
                 dept_id = EXCLUDED.dept_id, sector_id = EXCLUDED.sector_id,
                 position_id = EXCLUDED.position_id, updated_at = now()`,
              [id, name, email, intphone, mobile, room, carPlate, deptId, sectorId, positionId]
            );
          } else {
            await client.query(
              `INSERT INTO employees (name, email, intphone, mobile, room, car_plate, dept_id, sector_id, position_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [name, email, intphone, mobile, room, carPlate, deptId, sectorId, positionId]
            );
          }
          imported++;
        }
      } catch (rowErr) {
        console.warn(`Import row skipped (${table}):`, rowErr.message);
        skipped++;
      }
    }

    // Sync sequences
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1))`
    );

    await client.query('COMMIT');
    console.log(`Import ${table}: ${imported} imported, ${skipped} skipped`);
    res.json({ success: true, imported, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Import ${table} error:`, err.message);
    res.status(500).json({ error: 'Import zamanı xəta baş verdi', details: err.message });
  } finally {
    client.release();
  }
});

/* ─── CSV EXPORT API ─── */
app.get('/api/export/:table', async (req, res) => {
  const { table } = req.params;
  const allowedTables = ['departments', 'sectors', 'positions', 'employees'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Yanlış cədvəl adı' });
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
    const rows = result.rows;
    
    if (rows.length === 0) {
      return res.status(200).send(''); // Empty CSV
    }

    // CSV header row
    const headers = Object.keys(rows[0]);
    let csvContent = headers.join(',') + '\n';

    // CSV data rows
    rows.forEach(row => {
      const values = headers.map(header => {
        let val = row[header];
        if (val === null || val === undefined) val = '';
        val = String(val).replace(/"/g, '""'); // escape quotes
        // wrap in quotes if contains comma, quote, or newline
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val}"`;
        }
        return val;
      });
      csvContent += values.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
    // Add BOM for Excel UTF-8 support
    res.send('\uFEFF' + csvContent);
  } catch (err) {
    console.error(`Export ${table} error:`, err.message);
    res.status(500).json({ error: 'Export zamanı xəta baş verdi', details: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
