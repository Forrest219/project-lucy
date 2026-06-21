CREATE TABLE IF NOT EXISTS superstore_orders (
  row_id INT PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  order_date DATE NOT NULL,
  ship_date DATE NOT NULL,
  ship_mode VARCHAR(64),
  customer_id VARCHAR(64),
  customer_name VARCHAR(255),
  segment VARCHAR(64),
  city VARCHAR(128),
  province VARCHAR(128),
  country_region VARCHAR(128),
  region VARCHAR(64),
  product_id VARCHAR(64),
  category VARCHAR(128),
  sub_category VARCHAR(128),
  product_name VARCHAR(255),
  sales DECIMAL(12, 4),
  quantity INT,
  discount DECIMAL(8, 4),
  profit DECIMAL(12, 4),
  postal_code VARCHAR(32),
  source_system VARCHAR(64) NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(128) NOT NULL,
  source_row_number INT NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  row_hash VARCHAR(128) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS superstore_people (
  region VARCHAR(64) PRIMARY KEY,
  regional_manager VARCHAR(128) NOT NULL,
  source_system VARCHAR(64) NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(128) NOT NULL,
  source_row_number INT NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  row_hash VARCHAR(128) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS superstore_returns (
  id INT PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  returned VARCHAR(8) NOT NULL,
  source_system VARCHAR(64) NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(128) NOT NULL,
  source_row_number INT NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  row_hash VARCHAR(128) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO superstore_orders (
  row_id, order_id, order_date, ship_date, ship_mode, customer_id, customer_name,
  segment, city, province, country_region, region, product_id, category,
  sub_category, product_name, sales, quantity, discount, profit, postal_code,
  source_system, source_file, source_sheet, source_row_number, batch_id, row_hash,
  is_deleted
) VALUES
  (1, 'D-1001', '2026-01-05', '2026-01-08', 'Standard', 'C-001', 'Alice Zhang', 'Consumer', 'Shanghai', 'Shanghai', 'China', 'East', 'P-001', 'Office Supplies', 'Paper', 'A4 Copy Paper', 1200.0000, 10, 0.1000, 260.0000, '200000', 'demo', 'demo.xlsx', 'orders', 2, 'demo-20260621', 'demo-hash-1', 0),
  (2, 'D-1002', '2026-02-14', '2026-02-17', 'Second Class', 'C-002', 'Bob Li', 'Small Business', 'Guangzhou', 'Guangdong', 'China', 'Central South', 'P-002', 'Furniture', 'Chairs', 'Ergonomic Chair', 2300.0000, 5, 0.2500, -120.0000, '510000', 'demo', 'demo.xlsx', 'orders', 3, 'demo-20260621', 'demo-hash-2', 0),
  (3, 'D-1003', '2026-03-20', '2026-03-22', 'First Class', 'C-003', 'Cathy Wang', 'Corporate', 'Shenyang', 'Liaoning', 'China', 'Northeast', 'P-003', 'Technology', 'Accessories', 'Wireless Keyboard', 800.0000, 8, 0.0500, 180.0000, '110000', 'demo', 'demo.xlsx', 'orders', 4, 'demo-20260621', 'demo-hash-3', 0),
  (4, 'D-1004', '2026-04-11', '2026-04-14', 'Standard', 'C-004', 'David Zhao', 'Consumer', 'Hangzhou', 'Zhejiang', 'China', 'East', 'P-004', 'Office Supplies', 'Storage', 'File Folder', 600.0000, 20, 0.0000, 150.0000, '310000', 'demo', 'demo.xlsx', 'orders', 5, 'demo-20260621', 'demo-hash-4', 0),
  (5, 'D-1005', '2026-05-02', '2026-05-06', 'Standard', 'C-005', 'Ellen Qian', 'Corporate', 'Chengdu', 'Sichuan', 'China', 'Southwest', 'P-005', 'Technology', 'Devices', 'Monitor', 3200.0000, 4, 0.1500, 540.0000, '610000', 'demo', 'demo.xlsx', 'orders', 6, 'demo-20260621', 'demo-hash-5', 0);

INSERT INTO superstore_people (
  region, regional_manager, source_system, source_file, source_sheet,
  source_row_number, batch_id, row_hash, is_deleted
) VALUES
  ('East', 'Alice', 'demo', 'demo.xlsx', 'people', 2, 'demo-20260621', 'demo-people-1', 0),
  ('Central South', 'Bob', 'demo', 'demo.xlsx', 'people', 3, 'demo-20260621', 'demo-people-2', 0),
  ('Northeast', 'Cathy', 'demo', 'demo.xlsx', 'people', 4, 'demo-20260621', 'demo-people-3', 0),
  ('Southwest', 'David', 'demo', 'demo.xlsx', 'people', 5, 'demo-20260621', 'demo-people-4', 0);

INSERT INTO superstore_returns (
  id, order_id, returned, source_system, source_file, source_sheet,
  source_row_number, batch_id, row_hash, is_deleted
) VALUES
  (1, 'D-1002', '是', 'demo', 'demo.xlsx', 'returns', 2, 'demo-20260621', 'demo-return-1', 0);
