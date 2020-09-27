#!/usr/bin/env python3
import cgi
import cgitb
import MySQLdb
import sys

from auth import protect_dataset, RestrictedAccess
from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/json\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    cursor = db.cursor()

    try:
        protect_dataset(cursor, dataset)

        query = f'SELECT `metadata` FROM `metadata` WHERE `id` = {dataset};'
        cursor.execute(query)
        metadata = cursor.fetchone()
        if metadata is not None:
            metadata = metadata[0]
        else:
            metadata = '{}'

    except RestrictedAccess:
        metadata = '{"restricted": 1}'

    sys.stdout.write(metadata)

finally:
    sys.stdout.flush()
    db.close()
