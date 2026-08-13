-- ==========================================
-- Initial Seed Data for KYLTM Employee Portal
-- ==========================================

-- Insert default admin user if not exists
INSERT INTO portal_users (username, email, role, password, is_active)
VALUES ('Admin', 'admin@company.com', 'admin', '$2b$10$32yZ41OruPsshdhsDugbI.edHDMpdxgmPkE37NO.OP2njSJtwngCS', true)
ON CONFLICT (username) DO NOTHING;

-- Insert initial department
INSERT INTO departments (id, name)
VALUES (1, 'İnformasiya Texnologiyaları')
ON CONFLICT DO NOTHING;

-- Insert initial sector
INSERT INTO sectors (id, name, dept_id)
VALUES (1, 'Proqramlaşdırma Sektoru', 1)
ON CONFLICT DO NOTHING;

-- Insert initial position
INSERT INTO positions (id, name)
VALUES (1, 'Aparıcı Mütəxəssis')
ON CONFLICT DO NOTHING;

-- Insert a few test employees to get started (Optional)
INSERT INTO employees (name, position_id, dept_id, sector_id, email, intphone, mobile, room)
VALUES 
('Hüseyn Həsənov', 1, 1, 1, 'huseyn@company.com', '1001', '+994 50-123-45-67', '401'),
('Aytən Məmmədova', 1, 1, 1, 'ayten@company.com', '1045', '+994 55-987-65-43', '405')
ON CONFLICT DO NOTHING;

