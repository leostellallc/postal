#!/usr/bin/env python3
import cgi
import cgitb
import MySQLdb
import sys

from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)
action = args['action'].value
id = args['id'].value
t = float(args['t'].value) if 't' in args else 0.0
text = args['text'].value if 'text' in args else ''

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    db.autocommit(True)
    cursor = db.cursor()

    if action == 'add':
        query = f'INSERT INTO `annotation_{dataset}`(`id`, `t`, `text`) VALUES(%s, {t}, %s);'
        cursor.execute(query, (id, text))
    elif action == 'update':
        query = f'UPDATE `annotation_{dataset}` SET `t` = {t}, `text` = %s WHERE `id` = %s;'
        cursor.execute(query, (text, id))
    elif action == 'delete':
        query = f'DELETE FROM `annotation_{dataset}` WHERE `id` = %s;'
        cursor.execute(query, (id,))

finally:
    sys.stdout.flush()
    db.close()
