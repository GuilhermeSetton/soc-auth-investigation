"""Command line for migrations (reads DATABASE_URL from the environment).

    python -m app.migrate up
    python -m app.migrate down --confirm-database <exact-database-name>

Exit codes: 0 success, 1 configuration/connection/SQL failure, 2 usage error, 3 confirmation mismatch.
Messages never include DATABASE_URL, the password or driver text.
"""

import sys

import psycopg

from app.db import ConfirmationError, DatabaseNotConfigured, database_url, migrate_down, migrate_up

USAGE = "usage: python -m app.migrate up | down --confirm-database <exact-database-name>"


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args or args[0] not in ("up", "down"):
        print(USAGE, file=sys.stderr)
        return 2
    command = args[0]
    if command == "up" and len(args) != 1:
        print(USAGE, file=sys.stderr)
        return 2
    if command == "down" and (len(args) != 3 or args[1] != "--confirm-database" or not args[2]):
        print("error: down requires --confirm-database <exact-database-name>; nothing was changed",
              file=sys.stderr)
        return 2

    try:
        url = database_url()
        if command == "up":
            applied = migrate_up(url)
            print("applied: " + (", ".join(applied) if applied else "none (already up to date)"))
        else:
            reverted = migrate_down(url, args[2])
            print("reverted: " + (reverted or "none"))
        return 0
    except DatabaseNotConfigured:
        print("error: DATABASE_URL is not set", file=sys.stderr)
        return 1
    except ConfirmationError:
        print("error: confirmation does not match the connected database; nothing was changed",
              file=sys.stderr)
        return 3
    except psycopg.Error as exc:
        # Only the exception class: driver text can contain connection details.
        print(f"error: database operation failed ({type(exc).__name__}); nothing was changed",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
