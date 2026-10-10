"""Read-only digest inventory of the resources this deployment must preserve."""
import argparse
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


def compare(baseline, current):
    """Preserve baseline identities; additional deployment resources are allowed."""
    differences = []
    for directory, expected in baseline["directories"].items():
        if current["directories"].get(directory) != expected:
            differences.append("Protected directory changed: " + directory)
    for kind in ("images", "networks"):
        actual = dict(record.rsplit(" ", 1) for record in current[kind])
        for record in baseline[kind]:
            name, identifier = record.rsplit(" ", 1)
            if actual.get(name) != identifier:
                differences.append("Protected " + kind + " missing or replaced: " + name)
    if current["recorder_state"] != baseline["recorder_state"]:
        differences.append("Protected recorder service state changed")
    return {"status": "FAIL" if differences else "PASS", "differences": differences,
            "protected_directories": len(baseline["directories"]),
            "protected_images": len(baseline["images"]),
            "protected_networks": len(baseline["networks"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, help="Original protected-resource inventory; additions are allowed")
    args = parser.parse_args()
    current = inventory()
    if args.baseline:
        baseline_bytes = args.baseline.read_bytes()
        result = compare(json.loads(baseline_bytes), current)
        result["baseline_sha256"] = hashlib.sha256(baseline_bytes).hexdigest()
        print(json.dumps(result, sort_keys=True))
        raise SystemExit(0 if result["status"] == "PASS" else 1)
    print(json.dumps(current, sort_keys=True))
