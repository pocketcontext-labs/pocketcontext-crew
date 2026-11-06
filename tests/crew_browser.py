#!/usr/bin/env python3
"""Real-browser Crew workflow on an isolated synthetic server."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
from e2e import Project, PASSWORD


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve()
    with tempfile.TemporaryDirectory(prefix='crew-browser-') as temp:
        pc = Project(binary, Path(temp))
        try:
            pc.json('init', '--port', str(pc.port), '--password-stdin', stdin=PASSWORD + '\n')
            pc.json('open', '--no-browser')
            env = {**os.environ, 'CREW_TEST_URL': pc.url, 'CREW_TEST_PASSWORD': PASSWORD}
            if args.screenshots:
                args.screenshots.mkdir(parents=True, exist_ok=True)
                env['CREW_SCREENSHOTS'] = str(args.screenshots.resolve())
            subprocess.run(['node', str(Path(__file__).with_suffix('.mjs'))], env=env, check=True, timeout=240)
        finally:
            subprocess.run([str(binary), '--db', str(pc.db), 'stop'], env=pc.env, capture_output=True, timeout=60)

if __name__ == '__main__':
    main()
