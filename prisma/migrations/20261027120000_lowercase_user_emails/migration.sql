-- Normalize existing emails to match app-side lowercase/trim on signup and signin.
-- Fails (and rolls back) if two rows collapse to the same email; resolve duplicates first.
UPDATE "User" SET "email" = LOWER(TRIM("email"));
