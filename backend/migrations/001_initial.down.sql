-- Reverts 001_initial. Destroys all imported data; used only by `python -m app.migrate down`.
DROP TABLE IF EXISTS investigations;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS imports;
