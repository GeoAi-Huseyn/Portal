-- ==========================================
-- Initial Seed Data for KYLTM Employee Portal
-- ==========================================

-- Insert default admin user if not exists
INSERT INTO portal_users (username, email, role, password, is_active)
VALUES ('Admin', 'admin@company.com', 'admin', 'Admin@Portal2026!', true)
ON CONFLICT (username) DO NOTHING;

-- Insert a few test employees to get started (Optional)
INSERT INTO employees (name, position, dept, sektor, email, intphone, mobile, room)
VALUES 
('Hüseyn Həsənov', 'Müdir', 'Rəhbərlik', NULL, 'huseyn@company.com', '1001', '+994 50-123-45-67', '401'),
('Aytən Məmmədova', 'Aparıcı Mütəxəssis', 'İnformasiya Texnologiyaları', 'Proqramlaşdırma Sektoru', 'ayten@company.com', '1045', '+994 55-987-65-43', '405')
ON CONFLICT DO NOTHING;
