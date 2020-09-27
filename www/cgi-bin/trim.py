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
left = float(args['left'].value) if 'left' in args else None
right = float(args['right'].value) if 'right' in args else None

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    db.autocommit(True)
    cursor = db.cursor()

    if left is not None or right is not None:
        protect_dataset(cursor, dataset, protect_user=True, forbid_guest=True)

    replace_logger = False
    if left is not None:
        cursor.execute(f'DELETE FROM `dataset_{dataset}` WHERE `t` < {left}')
        cursor.execute(f'DELETE FROM `annotation_{dataset}` WHERE `t` < {left}')
        replace_logger = True

    if right is not None:
        cursor.execute(f'DELETE FROM `dataset_{dataset}` WHERE `t` > {right}')
        cursor.execute(f'DELETE FROM `annotation_{dataset}` WHERE `t` > {right}')
        replace_logger = True

    if replace_logger:
        # Force getting a new logger. Trimming the dataset can create an
        # inconsistent state in import.py.
        cursor.execute(f'UPDATE `datasets` SET `port` = NULL WHERE `id` = {dataset};')

    try:
        cursor.execute(f'SELECT MIN(`t`), MAX(`t`) FROM `dataset_{dataset}`;')
        row = cursor.fetchone()
    except MySQLdb.ProgrammingError:
        row = [0, 0]

    results = {
        'left': row[0],
        'right': row[1],
    }

    sys.stdout.write(json.dumps(results))

finally:
    sys.stdout.flush()
    db.close()
