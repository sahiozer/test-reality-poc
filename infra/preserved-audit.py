"""Read-only digest inventory of the resources this deployment must preserve."""
import hashlib
import json
from pathlib import Path
import subprocess

PROTECTED = ["/opt/binancebot", "/opt/liquidation-pilot-v1", "/opt/liquidation-recorder-v1"]


def inventory():
    directories = {}
    for directory in PROTECTED:
        root = Path(directory)
        digest = hashlib.sha256()
        count = 0
        for path in sorted([root, *root.rglob("*")]):
            stat = path.lstat()
            record = [str(path.relative_to(root)), stat.st_mode, stat.st_size, stat.st_mtime_ns]
            if path.is_symlink():
                record.append(str(path.readlink()))
            elif path.is_file():
                content = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        content.update(chunk)
                record.append(content.hexdigest())
            digest.update(json.dumps(record).encode())
            count += 1
        directories[directory] = {"entries": count, "sha256": digest.hexdigest()}
    networks = subprocess.check_output(["docker", "network", "ls", "--no-trunc", "--format", "{{.Name}} {{.ID}}"], text=True).splitlines()
    images = subprocess.check_output(["docker", "image", "ls", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}} {{.ID}}"], text=True).splitlines()
    return {"directories": directories, "networks": sorted(networks), "images": sorted(images),
            "recorder_state": subprocess.check_output(["systemctl", "show", "liquidation-recorder-v1.service", "--property=ActiveState,SubState,UnitFileState"], text=True).strip()}


if __name__ == "__main__":
    print(json.dumps(inventory(), sort_keys=True))
