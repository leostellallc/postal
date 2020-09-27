#!/usr/bin/env python3
import cgi
import cgitb
import lzma
import MySQLdb
import MySQLdb.cursors as cursors
import struct
import sys

try:
    from config import ENABLE_COMPRESSION
except ImportError:
    ENABLE_COMPRESSION = True

from auth import protect_dataset
from db import HOST, USER, PASSWORD, DB

FROM_SQL_TYPE = {
    'BOOLEAN': ('u8', 'B'),
    'TINYINT UNSIGNED': ('u8', 'B'),
    'SMALLINT UNSIGNED': ('u16', 'H'),
    'INT UNSIGNED': ('u32', 'L'),
    'BIGINT UNSIGNED': ('u64', 'Q'),
    'TINYINT': ('s8', 'b'),
    'SMALLINT': ('s16', 'h'),
    'INT': ('s32', 'l'),
    'FLOAT': ('float', 'f'),
    'DOUBLE': ('double', 'd'),
}

cgitb.enable()
sys.stdout.write('Content-Type: application/octet-stream\n\n')
sys.stdout.flush()

args = cgi.FieldStorage()
dataset = int(args['d'].value)
key = args['key'].value if 'key' in args else ''
rate = float(args['rate'].value) if 'rate' in args else None
start = float(args['start'].value) if 'start' in args else None
end = float(args['end'].value) if 'end' in args else None

db = MySQLdb.connect(HOST, USER, PASSWORD, DB, cursorclass=cursors.SSCursor)
try:
    cursor = db.cursor()

    protect_dataset(cursor, dataset)

    pack_t = struct.Struct('<d')

    interval = ''
    if start is not None:
        interval += f' AND `t` >= {start}'
    if end is not None:
        interval += f' AND `t` < {end}'

    if key != '':
        query = 'SELECT `data_type`, `column_type` FROM INFORMATION_SCHEMA.COLUMNS WHERE ' + \
                '`table_name` = %s AND `column_name` = %s;'
        cursor.execute(query, (f'dataset_{dataset}', key))
        row = cursor.fetchone()
        sql_type = row[0] + (' unsigned' if row[1].endswith('unsigned') else '')
        type, struct_type = FROM_SQL_TYPE[sql_type.upper()]
        string_type = '{}\n'.format(type).encode('ascii')

        pack_value = struct.Struct('<' + struct_type)

        # TODO: Possible SQL injection through use of "key".
        query = 'SELECT `t`, `{0}` FROM `dataset_{1}` WHERE `{0}` IS NOT NULL {2};'.format(
            key, dataset, interval)
    else:
        query = f'SELECT `t` FROM `dataset_{dataset}`;'
        string_type = None

    if ENABLE_COMPRESSION:
        compressor = lzma.LZMACompressor(format=lzma.FORMAT_ALONE)
        if string_type:
            sys.stdout.buffer.write(compressor.compress(string_type))
    else:
        if string_type:
            sys.stdout.buffer.write(string_type)

    cursor.execute(query)

    last_t = 0
    while True:
        rows = cursor.fetchmany(size=1000)
        if not rows:
            break

        raw = bytes()
        for row in rows:
            t = row[0]

            if rate is not None and t - last_t < rate:
                continue

            raw += pack_t.pack(t)
            if key != '':
                raw += pack_value.pack(row[1])

            last_t = t

        if ENABLE_COMPRESSION:
            sys.stdout.buffer.write(compressor.compress(raw))
        else:
            sys.stdout.buffer.write(raw)

    if ENABLE_COMPRESSION:
        sys.stdout.buffer.write(compressor.flush())

finally:
    sys.stdout.flush()
    db.close()
