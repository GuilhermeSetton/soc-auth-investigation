"""Migration CLI: `down` needs the exact database name; nothing destructive runs on mismatch."""

import psycopg
from psycopg.conninfo import conninfo_to_dict

from app import migrate as cli


def events_table_exists(url: str) -> bool:
    with psycopg.connect(url) as conn:
        return conn.execute("SELECT to_regclass('public.events')").fetchone()[0] is not None


def test_down_without_confirmation_aborts_and_keeps_schema(db_url, capsys):
    assert cli.main(["migrate.py", "down"]) == 2
    assert events_table_exists(db_url)
    assert "--confirm-database" in capsys.readouterr().err


def test_down_with_different_database_name_aborts_without_leaking_secrets(db_url, capsys):
    password = conninfo_to_dict(db_url)["password"]
    assert cli.main(["migrate.py", "down", "--confirm-database", "soc_auth"]) == 3
    captured = capsys.readouterr()
    assert events_table_exists(db_url)
    assert password not in captured.out + captured.err
    assert "postgresql://" not in captured.out + captured.err


def test_down_with_exact_name_reverts_and_up_restores(db_url, capsys):
    assert cli.main(["migrate.py", "down", "--confirm-database", "soc_auth_test"]) == 0
    assert not events_table_exists(db_url)
    assert cli.main(["migrate.py", "up"]) == 0
    assert events_table_exists(db_url)


def test_up_is_idempotent_and_needs_no_confirmation(db_url, capsys):
    assert cli.main(["migrate.py", "up"]) == 0
    assert cli.main(["migrate.py", "up"]) == 0
    assert "already up to date" in capsys.readouterr().out


def test_missing_confirmation_value_is_a_clear_usage_error(db_url, capsys):
    assert cli.main(["migrate.py", "down", "--confirm-database"]) == 2
    assert "--confirm-database" in capsys.readouterr().err
    assert events_table_exists(db_url)


def test_connection_failure_prints_no_dsn(monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://soc:pw-marker-123@127.0.0.1:1/soc_auth_test")
    assert cli.main(["migrate.py", "up"]) == 1
    captured = capsys.readouterr()
    assert "pw-marker-123" not in captured.out + captured.err
