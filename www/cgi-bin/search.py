#!/usr/bin/env python3
import cgi
import cgitb
import json
import MySQLdb
import sys

from datetime import timezone

from db import HOST, USER, PASSWORD, DB

cgitb.enable()
sys.stdout.write('Content-Type: application/json\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
regex = args['regex'].value if 'regex' in args else ''
start = int(args['start'].value) if 'start' in args else 0
count = int(args['count'].value) if 'count' in args else 50

def utc_to_local(utc_dt):
    return utc_dt.replace(tzinfo=timezone.utc).astimezone(tz=None)

db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
try:
    cursor = db.cursor()

    query = 'SELECT `id`, `owner`, `updated`, `description`, `flags`, `project` FROM `datasets` '
    if regex != '':
        # TODO: Possible SQL injection through use of "regex".
        query += 'WHERE `owner` LIKE \'%{0}%\' OR `description` LIKE \'%{0}%\''.format(regex)
    query += f'ORDER BY `updated` DESC LIMIT {start}, {count};'

    cursor.execute(query)
    rows = cursor.fetchall()

    results = []
    for row in rows:
        query = 'SELECT DATA_LENGTH + INDEX_LENGTH AS `size` FROM INFORMATION_SCHEMA.TABLES ' + \
                'WHERE `table_name` = %s;'
        cursor.execute(query, (f'dataset_{row[0]}',))
        other_row = cursor.fetchone()

        entry = {
            'datasetId': row[0],
            'owner': row[1],
            'updated': utc_to_local(row[2]).strftime("%Y-%m-%d %H:%M:%S"),
            'description': row[3],
            'flags': row[4],
            'project': row[5].lower(),
            'size': '{:.1f}'.format(other_row[0] / (1024 * 1024)) if other_row else '-',
        }
        results.append(entry)

    sys.stdout.write(json.dumps(results))

finally:
    sys.stdout.flush()
    db.close()
