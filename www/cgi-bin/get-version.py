#!/usr/bin/env python3
import cgitb
import subprocess
import sys

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.flush()

try:
    stdout = subprocess.check_output('git rev-parse --abbrev-ref HEAD',
                                     shell=True,
                                     stderr=subprocess.STDOUT)
    branch = stdout.decode().strip()

    stdout = subprocess.check_output('git rev-parse HEAD',
                                     shell=True,
                                     stderr=subprocess.STDOUT)
    sha1 = stdout.decode().strip()[:8]

    stdout = subprocess.check_output('git status --untracked-files=no --porcelain',
                                     shell=True,
                                     stderr=subprocess.STDOUT)
    if len(stdout.decode().strip()) > 0:
        sha1 += '-dirty'

    sys.stdout.write('{}@{}'.format(branch, sha1))

finally:
    sys.stdout.flush()
