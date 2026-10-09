"""Create only this project's secret file; never emit or replace its contents."""
from pathlib import Path
import secrets

path = Path(__file__).resolve().parent / ".env"
if path.exists():
    print("Project environment already exists; left unchanged")
else:
    with path.open("x") as file:
        file.write("DATABASE_PASSWORD=" + secrets.token_hex(24) + "\n")
    path.chmod(0o600)
    print("Created project-only environment (mode 0600)")
