#!/usr/bin/env python3
import cgitb
import json
import MySQLdb
import sys
import uuid

from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.flush()

args = json.load(sys.stdin)

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    db.autocommit(True)
    cursor = db.cursor()

    uid = uuid.uuid4().hex
    sharedata = json.dumps(args)

    query = 'INSERT INTO `sharelinks`(`id`, `sharedata`) VALUES(%s, %s);'
    cursor.execute(query, (uid, sharedata))

    sys.stdout.write(json.dumps({
        'share': uid,
    }))

finally:
    sys.stdout.flush()
    db.close()
