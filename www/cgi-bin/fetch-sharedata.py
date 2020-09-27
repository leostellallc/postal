#!/usr/bin/env python3
import cgi
import cgitb
import MySQLdb
import sys

from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/json\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
shareid = args['s'].value

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    cursor = db.cursor()

    query = 'SELECT `sharedata` FROM `sharelinks` WHERE `id` = %s;'
    cursor.execute(query, (shareid,))
    sharedata = cursor.fetchone()[0]

    sys.stdout.write(sharedata)

finally:
    sys.stdout.flush()
    db.close()
