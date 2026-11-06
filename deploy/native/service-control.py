#!/usr/bin/env python3
"""Root-only systemd backup handover; the snapshot itself runs unprivileged."""
import argparse
import os
from pathlib import Path
import stat
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'resume'])
    parser.add_argument('--service', required=True)
    parser.add_argument('--state', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Service handover requires root')
    folder = args.state
    if not folder.is_absolute() or folder.is_symlink():
        raise SystemExit('Use the private systemd runtime directory')
    info = folder.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        raise SystemExit('Runtime directory must be root-owned mode 700')
    marker = folder / 'resume'
    if args.action == 'prepare':
        marker.unlink(missing_ok=True)
        result = subprocess.run(['systemctl', 'is-active', '--quiet', args.service])
        if result.returncode:
            # ExecCondition exits1..254 skip work; ExecStopPost sees no marker.
            raise SystemExit(1)
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
    elif marker.exists():
        marker.unlink()
        subprocess.run(['systemctl', 'start', args.service], check=True)


if __name__ == '__main__':
    main()
