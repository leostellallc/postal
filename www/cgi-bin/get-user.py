#!/usr/bin/env python3
import cgitb
import sys

from auth import get_username

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.write(get_username())
sys.stdout.flush()
