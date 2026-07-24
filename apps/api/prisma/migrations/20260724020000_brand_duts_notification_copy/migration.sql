-- Rewrite legacy GigFlow branding in stored notification copy (keep history rows).
UPDATE "Notification"
SET
  "title" = REPLACE(REPLACE(REPLACE(REPLACE("title", 'GigFlow', 'DUTS'), 'GIGFLOW', 'DUTS'), 'Gigflow', 'DUTS'), 'Gig Flow', 'DUTS'),
  "body" = REPLACE(REPLACE(REPLACE(REPLACE("body", 'GigFlow', 'DUTS'), 'GIGFLOW', 'DUTS'), 'Gigflow', 'DUTS'), 'Gig Flow', 'DUTS')
WHERE
  "title" ILIKE '%gig%flow%'
  OR "body" ILIKE '%gig%flow%';

-- Seed / demo profile display names that still show the old brand.
UPDATE "User"
SET "fullName" = REPLACE(REPLACE(REPLACE("fullName", 'GIGFLOW', 'DUTS'), 'GigFlow', 'DUTS'), 'Gigflow', 'DUTS')
WHERE "fullName" ILIKE '%gigflow%';

UPDATE "WorkerProfile"
SET "bio" = REPLACE(REPLACE(REPLACE("bio", 'GIGFLOW', 'DUTS'), 'GigFlow', 'DUTS'), 'Gigflow', 'DUTS')
WHERE "bio" ILIKE '%gigflow%';
