#!/usr/bin/env python3
import cgi
import cgitb
import json
import MySQLdb
import sys

from auth import protect_dataset
from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/json\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)
project = args['project'].value.lower() if 'project' in args else None
description = args['description'].value if 'description' in args else None

# TODO: Migrate to POST if possible.

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    db.autocommit(True)
    cursor = db.cursor()

    if project is not None or description is not None:
        protect_dataset(cursor, dataset, protect_user=True, forbid_guest=True)

        if project is not None:
            cursor.execute(f'UPDATE `datasets` SET `project` = %s WHERE `id` = {dataset};',
                           (project, ))
        if description is not None:
            cursor.execute(f'UPDATE `datasets` SET `description` = %s WHERE `id` = {dataset};',
                           (description, ))

    cursor.execute('SELECT `owner`, `description`, `project` FROM `datasets` ' +
                   f'WHERE `id` = {dataset};')
    row = cursor.fetchone()

    results = {
        'owner': row[0],
        'description': row[1],
        'project': row[2].lower(),
    }
    sys.stdout.write(json.dumps(results))

finally:
    sys.stdout.flush()
    db.close()
