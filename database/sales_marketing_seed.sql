-- Sample sales & marketing data (idempotent). Run after sales_marketing.sql.

INSERT INTO sales_campaigns (name, channel, start_date, end_date, budget_amount, currency, utm_campaign, created_by)
SELECT 'Q2 East Africa digital', 'EMAIL', CURRENT_DATE - 30, CURRENT_DATE + 60, 50000.00, 'USD', 'q2_ea_digital', u.id
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM sales_campaigns WHERE name = 'Q2 East Africa digital');

INSERT INTO sales_campaigns (name, channel, start_date, end_date, budget_amount, currency, created_by)
SELECT 'Nairobi airport OOH', 'OOH', CURRENT_DATE - 14, CURRENT_DATE + 120, 12000.00, 'USD', u.id
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM sales_campaigns WHERE name = 'Nairobi airport OOH');

INSERT INTO sales_promo_codes (code, description, discount_type, discount_value, currency, valid_from, valid_until, usage_limit, used_count, active)
SELECT 'SUMMER10', 'Seed: 10% off published fares', 'PERCENT', 10, 'USD', CURRENT_DATE - 7, CURRENT_DATE + 365, 500, 3, TRUE
WHERE NOT EXISTS (SELECT 1 FROM sales_promo_codes WHERE upper(code) = 'SUMMER10');

INSERT INTO sales_promo_codes (code, description, discount_type, discount_value, currency, valid_from, valid_until, usage_limit, used_count, active)
SELECT 'FARE50', 'Seed: USD 50 off', 'FIXED_AMOUNT', 50, 'USD', CURRENT_DATE - 1, CURRENT_DATE + 180, 200, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM sales_promo_codes WHERE upper(code) = 'FARE50');

INSERT INTO sales_leads (company_name, contact_name, email, phone, source, status, expected_value, currency, campaign_id, notes)
SELECT 'Acme Tours Ltd', 'Jane Buyer', 'jane@acme-seed.test', '+254700000001', 'WEB', 'QUALIFIED', 45000, 'USD', c.id, 'Seed lead — qualified opportunity.'
FROM sales_campaigns c
WHERE c.name = 'Q2 East Africa digital'
  AND NOT EXISTS (SELECT 1 FROM sales_leads WHERE email = 'jane@acme-seed.test');

INSERT INTO sales_leads (company_name, contact_name, email, source, status, expected_value, currency, campaign_id)
SELECT NULL, 'Sam Prospect', 'sam@prospect-seed.test', 'REFERRAL', 'NEW', 12000, 'USD', c.id
FROM sales_campaigns c
WHERE c.name = 'Q2 East Africa digital'
  AND NOT EXISTS (SELECT 1 FROM sales_leads WHERE email = 'sam@prospect-seed.test');

INSERT INTO sales_leads (company_name, contact_name, email, source, status, expected_value, currency, campaign_id)
SELECT 'Coastal Holidays', 'Maria Lead', 'maria@coastal-seed.test', 'EVENT', 'PROPOSAL', 28000, 'USD', c.id
FROM sales_campaigns c
WHERE c.name = 'Nairobi airport OOH'
  AND NOT EXISTS (SELECT 1 FROM sales_leads WHERE email = 'maria@coastal-seed.test');

INSERT INTO sales_travel_agents (company_name, contact_name, email, phone, iata_code, user_id, commission_percent, notes)
SELECT 'Skylink Travel', 'Agent Desk', 'desk@skylink-seed.test', '+971500000000', 'SKY999', u.id, 7.5, 'Seed — linked to booking agent user when present.'
FROM users u
WHERE u.email = 'agent@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM sales_travel_agents WHERE company_name = 'Skylink Travel');

INSERT INTO sales_travel_agents (company_name, contact_name, email, phone, iata_code, commission_percent, notes)
SELECT 'Global Fares Desk', 'B2B Sales', 'b2b@globalfares-seed.test', NULL, 'GF-IA', 5.0, 'Seed travel agent (no linked user).'
WHERE NOT EXISTS (SELECT 1 FROM sales_travel_agents WHERE company_name = 'Global Fares Desk');

UPDATE bookings b
SET campaign_id = c.id
FROM sales_campaigns c
WHERE c.name = 'Q2 East Africa digital'
  AND b.pnr IN ('FNSEED1', 'FNSEED2')
  AND b.campaign_id IS NULL;
