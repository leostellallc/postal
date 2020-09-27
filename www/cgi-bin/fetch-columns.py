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

    describe = 'SELECT COLUMN_NAME FROM information_schema.columns ' + \
               'WHERE `table_schema` = %s AND `table_name` = %s;'
    cursor.execute(describe, (DB, f'dataset_{dataset}'))

    columns = []
    rows = cursor.fetchall()
    for row in rows:
        column = row[0]
        if column == 't':
            continue
        columns.append(column)

    sys.stdout.write(json.dumps(columns))

finally:
    sys.stdout.flush()
    db.close()
