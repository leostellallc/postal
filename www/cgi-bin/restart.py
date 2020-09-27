#!/usr/bin/env python3
import cgi
import cgitb
import json
import MySQLdb
import os
import sys
import time

from db import HOST, USER, PASSWORD, DB

path = os.path.dirname(os.path.abspath(__file__))

cgitb.enable()
sys.stdout.write('Content-Type: application/json\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)
force = bool(args['force']) if 'force' in args else False

rpipe = -1
db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    db.autocommit(True)
    cursor = db.cursor()

    if force:
        update = f'UPDATE `datasets` SET `port` = NULL WHERE `id` = {dataset};'
        cursor.execute(update)

    query = f'SELECT `port` FROM `datasets` WHERE `id` = {dataset};'
    cursor.execute(query)
    row = cursor.fetchone()
    port = row[0]

    if port is None:
        rpipe, wpipe = os.pipe()
        pid = os.fork()
        if pid == 0:
            # This is an important line! CGI will hang if we don't close stdin.
            os.close(sys.stdin.fileno())

            os.close(rpipe)
            os.dup2(wpipe, sys.stdout.fileno())
            os.dup2(wpipe, sys.stderr.fileno())
            os.close(wpipe)
            os.setsid()
            os.execvp('python3.6', ['python3.6', os.path.join(path, 'import.py'),
                                    str(dataset)])
            sys.stdout.flush()
            sys.stderr.flush()
            sys.exit(1)
        os.close(wpipe)

    end_time = time.time() + 10
    while True:
        if time.time() > end_time:
            break

        query = f'SELECT `port` FROM `datasets` WHERE `id` = {dataset};'
        cursor.execute(query)
        port = cursor.fetchone()[0]

        if port is not None:
            break
        time.sleep(1)

    results = {
        'datasetId': dataset,
        'port': port,
    }

    if port is None and rpipe >= 0:
        pipef = os.fdopen(rpipe)
        results['error'] = pipef.read()

    sys.stdout.write(json.dumps(results))

finally:
    if rpipe != -1:
        os.close(rpipe)
    sys.stdout.flush()
    db.close()
