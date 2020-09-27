#!/usr/bin/env python3
import argparse
import json
import math
import select
import socket
import sys
import syslog
import traceback
import uuid

import MySQLdb

from db import HOST, USER, PASSWORD, DB

SELECT_READONLY = select.POLLIN | select.POLLPRI | select.POLLHUP | select.POLLERR
'''Helper definition to program select() for read events.'''

INACTIVITY_TIMEOUT = 15 * 60 * 1000
'''The inactivity timeout before terminating the importer, in seconds.'''

TO_PYTHON_TYPE = {
    'BOOLEAN': lambda x: int(float(x)),
    'TINYINT UNSIGNED': lambda x: int(float(x)),
    'SMALLINT UNSIGNED': lambda x: int(float(x)),
    'INT UNSIGNED': lambda x: int(float(x)),
    'BIGINT UNSIGNED': lambda x: int(float(x)),
    'TINYINT': lambda x: int(float(x)),
    'SMALLINT': lambda x: int(float(x)),
    'INT': lambda x: int(float(x)),
    'FLOAT': lambda x: float(x),
    'DOUBLE': lambda x: float(x),
}
'''Conversion functions for CSV input.'''

class Importer:
    def __init__(self, dataset_id, db, use_syslog=False):
        '''Constructor.

           Args:
               dataset_id (int): The dataset unique identifier.
               db (MySQLConnection): The database to import the data into.
               use_syslog (bool): Whether to use syslog instead of stdout/err for logging.
        '''
        self._dataset_id = dataset_id
        self._db = db
        self._use_syslog = use_syslog

        # Objects for network I/O.
        self._poller = None
        self._accept_sock = None
        self._recv_sock = None

        # Objects for database access.
        self._annotations = dict()
        self._cursor = db.cursor()

        # Statistics.
        self.total_frames = 0

    def _auto_annotate_frame(self, ts, data_columns, last_data_values, data_values):
        '''Generate auto-annotations based on common events.

           Args:
               ts (float): The timestamp of the current data points.
               data_columns (list (str)): A list of columns (metrics).
               last_data_values (list): Last values for all columns (same order
                                        as data_columns)
               data_values (list): Current values for all columns (same order
                                        as data_columns)

           Returns:
               Nothing.
        '''
        def annotate(ts, label):
            '''Generate an annotation record and store it.

               Args:
                   ts (float): The timestamp for the annotation.
                   label (str): The label for the annotation.

               Returns:
                   Nothing.
            '''
            while ts in self._annotations:
                ts += 0.001
            uid = uuid.uuid4().hex
            self._annotations[ts] = uid

            query = f'INSERT INTO `annotation_{self._dataset_id}`(`id`, `t`, `text`) ' + \
                    f'VALUES(%s, {ts}, %s);'
            self._cursor.execute(query, (uid, label))
            self._db.commit()

        # TODO: Add auto-annotation code here!
        for i in range(len(data_columns)):
            if last_data_values is not None and last_data_values[i] is not None and \
               data_values[i] is not None and \
               last_data_values[i] < 100 and data_values[i] >= 100 and \
               data_values[i] != last_data_values[i]:
                annotate(ts, f'{data_columns[i]} climbs above $100')
            if last_data_values is not None and last_data_values[i] is not None and \
               data_values[i] is not None and \
               last_data_values[i] >= 100 and data_values[i] < 100 and \
               data_values[i] != last_data_values[i]:
                annotate(ts, f'{data_columns[i]} falls below $100')

    def _store_metadata(self):
        '''Generate and store metadata for the dataset.

           Returns:
               Nothing.
        '''
        metadata = dict()

        # TODO: Add enums translations here!
        metadata['enums'] = {
            'testEnumList': ['Zero', 'One', 'Two'],
            'testEnumDict': {
                10: 'Ten',
                20: 'Twenty',
            },
        }

        # TODO: Add validity mappings here!
        metadata['valid_map'] = {
            # The testValid metric is valid iff testValidFlag==0
            'testValid': 'testValidFlag',
        }

        # Now store the metadata.
        insert_into = f'INSERT INTO metadata(`id`, `metadata`) VALUES({self._dataset_id}, %s);'
        self._cursor.execute(insert_into, (json.dumps(metadata),))

    def finalize(self):
        '''Finalize the importer object before destruction.

           Returns:
               Nothing.
        '''
        # Clear out the port number before exiting.
        update = f'UPDATE `datasets` SET `port` = NULL WHERE `id` = {self._dataset_id};'
        self._cursor.execute(update)

    def _get_next_input_line(self):
        '''Wait for the input line.

           Returns:
               One full line worth of data, or None if there is no more data to return.
        '''
        buffer = ''
        while True:
            available = self._poller.poll(INACTIVITY_TIMEOUT)
            if not available:
                # Reached the timeout.
                return None

            # Accept new connections.
            if self._recv_sock is None:
                self._recv_sock, client_address = self._accept_sock.accept()
                if self._use_syslog:
                    syslog.syslog('Connection from {}:{}'.format(
                        client_address[0], client_address[1]))

                self._poller.register(self._recv_sock, SELECT_READONLY)
                self._poller.unregister(self._accept_sock)
                continue

            # Read 1 byte.
            # NOTE: This sample importer is not optimized. A better
            # implementation would use buffering.
            c = self._recv_sock.recv(1).decode('ascii')

            # Detect disconnection.
            if c == '':
                self._poller.unregister(self._recv_sock)
                self._poller.register(self._accept_sock, SELECT_READONLY)
                self._recv_sock.close()
                self._recv_sock = None
                if self._use_syslog:
                    syslog.syslog('Connection closed')
                buffer = ''

            # Process input characters.
            elif c == '\n':
                return buffer
            else:
                buffer += c

    def import_data(self):
        '''Import data into the Postal.

           Returns:
               Nothing.
        '''
        # Open our server socket first.
        self._accept_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._accept_sock.bind(('0.0.0.0', 0))
        _, port = self._accept_sock.getsockname()
        self._accept_sock.listen(1)
        print(f'Listening on port {port}')
        self._poller = select.poll()
        self._poller.register(self._accept_sock, SELECT_READONLY)

        update = f'UPDATE `datasets` SET `port` = {port} WHERE `id` = {self._dataset_id};'
        self._cursor.execute(update)
        self._db.commit()

        # Identify columns in the CSV.
        header_line = self._get_next_input_line()
        header = header_line.split(',')
        data_columns = list()
        data_types = list()

        # Assume the first column is always time.
        for column in header[1:]:
            head = column.split(':')
            data_columns.append(head[0])
            if len(head) > 1 and head[1] in TO_PYTHON_TYPE:
                data_types.append(head[1])
            else:
                data_types.append('DOUBLE')

        # Check whether the tables already exists or need to be created. We
        # assume that if the dataset_ table exists, all tables exist.
        describe = 'SELECT COUNT(*) FROM information_schema.tables ' + \
                   'WHERE `table_schema` = %s AND `table_name` = %s;'
        self._cursor.execute(describe, (DB, f'dataset_{self._dataset_id}'))
        if self._cursor.fetchone()[0] == 0:
            # Create the tables.
            columns = [f'`{column}` {data_type}' for column, data_type in
                       zip(data_columns, data_types)]
            columns = ', '.join(['`t` DOUBLE PRIMARY KEY'] + columns)
            create_table = f'CREATE TABLE `annotation_{self._dataset_id}`(' + \
                           '`id` VARCHAR(32) NOT NULL, `t` DOUBLE, `text` TEXT, PRIMARY KEY (`id`));'
            create_table += f'CREATE TABLE `dataset_{self._dataset_id}`({columns});'
            self._cursor.execute(create_table)

            # # Generate and store the metadata.
            self._store_metadata()

        last_raw_data_values = None
        while True:
            line = self._get_next_input_line()
            if line is None:
                if self._use_syslog:
                    syslog.syslog('Ending due to inactivity')
                else:
                    print('Ending due to inactivity')
                    break
            elif line == header_line:
                # Ignore a repeated header line.
                continue

            values = line.split(',')

            # Convert the timestamp to UTC.
            from datetime import datetime, timezone
            ts = datetime.strptime(values[0], '%b %d %Y').replace(
                tzinfo=timezone.utc).timestamp()
            data = dict()
            for i in range(1, len(header)):
                data[header[i]] = values[i]

            # Convert to the correct type to enable derivations.
            for index in range(len(data_columns)):
                key = data_columns[index]
                data_type = data_types[index]
                value = data.get(key, '')
                if value != '':
                    data[key] = TO_PYTHON_TYPE[data_type](value)
                else:
                    data[key] = None

            # Dump values.
            raw_data_values = list()
            data_values = list()
            for key in data_columns:
                value = data.get(key, None)
                if isinstance(value, float) and math.isnan(value):
                    value = None
                if isinstance(value, str):
                    if value.startswith('0x'):
                        value = int(value, 16)
                    elif value == '':
                        value = None
                raw_data_values.append(value)
                if value is not None:
                    data_values.append(str(value))
                else:
                    data_values.append('NULL')

            # NOTE: This sample importer is not optimized. A better implementation
            # would bundle several rows into a single request.
            insert_into = 'INSERT IGNORE INTO `dataset_{}` VALUES({})'.format(
                self._dataset_id, ', '.join([str(ts)] + data_values))
            self._cursor.execute(insert_into)

            # Update the "Last Updated" time for bookkeeping.
            # NOTE: Same comment as above.
            update = f'UPDATE `datasets` SET `updated` = NOW() WHERE `id` = {self._dataset_id};'
            self._cursor.execute(update)
            self._db.commit()

            # Generate auto-annotations.
            self._auto_annotate_frame(ts, data_columns, last_raw_data_values, raw_data_values)
            last_raw_data_values = raw_data_values

            self.total_frames += 1

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset_id')
    args = parser.parse_args()

    dataset_id = args.dataset_id

    syslog.openlog(f'postal_import_{dataset_id}')
    syslog.syslog('Started importer')

    try:
        # Connect to the Postal database and import the data.
        db = MySQLdb.connect(HOST, USER, PASSWORD, DB)
        importer = Importer(dataset_id, db, use_syslog=True)
        try:
            importer.import_data()
        except:
            # Reporting the frame with the error is useful for debugging.
            print(f'After {importer.total_frames} frames:', file=sys.stderr)
            etype, evalue, etb = sys.exc_info()
            for line in traceback.format_exception(etype, evalue, etb):
                for line in line.rstrip().split('\n'):
                    syslog.syslog(line)

        finally:
            importer.finalize()

            # Always commit, even on errors.
            db.commit()
            db.close()

    finally:
        syslog.closelog()
