#!/usr/bin/env python3
import cgitb
import sys

from auth import is_admin

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.write('yes' if is_admin() else 'no')
sys.stdout.flush()
