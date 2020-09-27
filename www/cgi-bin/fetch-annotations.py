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

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    cursor = db.cursor()

    protect_dataset(cursor, dataset)

    query = f'SELECT `t`, `id`, `text` FROM `annotation_{dataset}`;'
    cursor.execute(query)

    results = {}
    rows = cursor.fetchall()
    for row in rows:
        results[row[0]] = {
            'id': row[1],
            'text': row[2],
        }

    sys.stdout.write(json.dumps(results))

finally:
    sys.stdout.flush()
    db.close()
