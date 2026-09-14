DO $$
BEGIN
  IF current_database() <> 'agendita_owner_analytics_test' THEN
    RAISE EXCEPTION 'Track 5 teardown refused outside isolated local test database';
  END IF;
END $$;

DELETE FROM "PackageProduct" WHERE id = 'track5_pkg_20260913';
DELETE FROM "LoyaltyConfig" WHERE id = 'track5_loyalty_20260913';
UPDATE "Customer"
SET email = 'sofia.e2e@test.com', "userId" = NULL, "loyaltyToken" = NULL
WHERE id = 'cmu0c9hlc000o7wpyj3nmn6av'
  AND "businessId" = 'cmu0c9hjp00057wpyj8hlnckn';
UPDATE "Business"
SET "visualStyle" = 'balanced', "brandColor" = NULL
WHERE id = 'cmu0c9hjp00057wpyj8hlnckn';
