#!/usr/bin/env python3
import cgi
import cgitb
import MySQLdb
import sys

from auth import protect_dataset
from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)
action = args['action'].value if 'action' in args else 'reset'

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    cursor = db.cursor()

    protect_dataset(cursor, dataset, protect_user=True, forbid_guest=True)

    if action in ['reset', 'delete']:
        cursor.execute(f'DROP TABLE IF EXISTS `dataset_{dataset}`;')
        cursor.execute(f'DROP TABLE IF EXISTS `annotation_{dataset}`;')
        cursor.execute(f'DELETE FROM `metadata` WHERE `id` = {dataset};')
    if action == 'delete':
        cursor.execute(f'DELETE FROM `datasets` WHERE `id` = {dataset};')
    elif action == 'reset':
        # Force getting a new logger.
        cursor.execute(f'UPDATE `datasets` SET `port` = NULL WHERE `id` = {dataset};')

finally:
    sys.stdout.flush()
    db.commit()
    db.close()
