#!/usr/bin/env python3
'''
A package to manipulate data from Postal.
'''
import postal

if __name__ == '__main__':
    import argparse
    import fnmatch
    import getpass
    import gzip
    import json
    import logging
    import os.path
    import platform
    import socket
    import sys
    import tarfile
    import traceback
    import urllib.parse
    import urllib3
    from zstandard import ZstdDecompressor
    http = urllib3.PoolManager()

    class CmdLine():
        '''A command-line tool to manipulate data from Postal.
        '''
        def __init__(self):
            '''Entry point for the application.
            '''
            parser = argparse.ArgumentParser(
                description='Postal command line data tool',
                usage=f'''{sys.argv[0]} <command> [<args>]

Available commands are:
   import     Import data into Postal
   export     Export data from Postal
''')
            parser.add_argument('command',
                                help='Subcommand to run')

            # On Windows, default to `import' if the first argument is a
            # file. This is to allow drag-and-drop imports.
            if platform.system() == 'Windows' and len(sys.argv) > 1:
                if os.path.isfile(sys.argv[1]):
                    sys.argv = sys.argv[0:1] + ['import'] + sys.argv[1:]

            args = parser.parse_args(sys.argv[1:2])
            if not hasattr(self, f'_{args.command}'):
                print('Unrecognized command', file=sys.stderr)
                parser.print_help()
                exit(1)

            self.sock = None
            self.verbose = False
            self.logger = logging.getLogger(__name__)
            self.stream_raw_last_path = ''
            logging.basicConfig(
                format='[%(asctime)s] %(levelname)s %(message)s',
                level='INFO')

            getattr(self, f'_{args.command}')()

        def _import(self):
            '''Handler for the "import" command.
            '''
            parser = argparse.ArgumentParser(
                description='Import data into Postal')
            parser.add_argument(
                '-v', '--verbose',
                action='store_true',
                help='Log all actions')
            parser.add_argument(
                '-C', '--create',
                metavar='DESCRIPTION',
                nargs='?',
                help='Create a new Postal dataset')
            parser.add_argument(
                '-p', '--project',
                nargs='?',
                default='',
                help='Specify a project when creating a new dataset')
            parser.add_argument(
                '-c', '--connection',
                nargs='?',
                help='Specify a Postal connection [ip:]port')
            parser.add_argument(
                'data_files',
                nargs='+',
                help='One or more data file to import')
            args = parser.parse_args(sys.argv[2:])

            if args.create and args.connection:
                print('Option -C (create) and -c (connect) are incompatible', file=sys.stderr)
                exit(1)

            self.verbose = args.verbose
            self.processed = list()

            ip = postal.POSTAL_HOST.split('/')[2]
            if args.create:
                auth_user, auth_password = postal.PostalRun.get_auth()
                params = {
                    'project': args.project,
                    'description': args.create,
                }
                encoded_params = urllib.parse.urlencode(params)
                url = f'{postal.POSTAL_HOST}/cgi-bin/new.py?{encoded_params}'
                headers = urllib3.util.make_headers(basic_auth=f'{auth_user}:{auth_password}')
                response = http.request('GET', url, headers=headers)
                if response.status != 200:
                    print(response.data.decode('utf-8'), file=sys.stderr)
                json_output = response.data.decode('utf-8')
                output = json.loads(json_output)
                dataset = output['datasetId']
                self.logger.info(f'Created dataset {dataset}...')
                port = output['port']

            else:
                # If no connection is specified, prompt for the
                # information. This is to allow drag-and-drop imports on
                # Windows.
                port = input('Postal dataset TCP port? ') if not args.connection \
                                                          else args.connection
                if ':' in port:
                    ip, port = port.split(':')

            if self.verbose:
                self.logger.info(f'Connecting to {ip}:{port}...')

            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.connect((ip, int(port)))

            if self.verbose:
                self.logger.info(f'Opened connection to {ip}:{port}')

            total_size = 0
            for filepath in args.data_files:
                if filepath.endswith('.csv'):
                    try:
                        with open(filepath, 'rb') as f:
                            # These files can get really big, let's do it in
                            # chunks.
                            while True:
                                contents = f.read(65536)
                                if not contents:
                                    break
                                total_size += self.stream_raw(filepath, contents)

                    except Exception:
                        traceback.print_exc(file=sys.stderr)
                        print(f'Failed to open {filepath}, skipping',
                              file=sys.stderr)
                else:
                    print(f'Unknown file {filepath}, skipping',
                          file=sys.stderr)

            if not self.verbose:
                print()
            print(f'Imported {total_size} bytes successfully.')

        def stream_raw(self, path, contents):
            '''Import a .log file into Postal.

               Args:
                 path (str): Path to the file to import.
                 contents (bytes): Contents of the file to import.

               Returns the number of bytes streamed to Postal.
            '''
            if not self.verbose:
                print('.', end='')
                sys.stdout.flush()
            elif self.stream_raw_last_path != path:
                self.logger.info(f'Pushing {path}...')

            self.stream_raw_last_path = path
            self.sock.send(contents)

            return len(contents)

        def _export(self):
            '''Handler for the "export" command.
            '''
            parser = argparse.ArgumentParser(
                description='Export data from Postal')
            parser.add_argument(
                '--start-time',
                type=float,
                default=None,
                help='The lowest epoch timestamp to include in the export')
            parser.add_argument(
                '--end-time',
                type=float,
                default=None,
                help='The highest epoch timestamp to include in the export')
            parser.add_argument(
                '-t', '--translate',
                action='store_true',
                help='Translate enum to strings')
            parser.add_argument(
                '-f', '--filter',
                action='store_true',
                help='Filter by validity')
            parser.add_argument(
                'dataset',
                help='The Postal dataset ID to export data from')
            parser.add_argument(
                'csv',
                help='The path to the output CSV file')
            parser.add_argument(
                'keys',
                nargs='+',
                help='One or more keys to export')
            args = parser.parse_args(sys.argv[2:])

            # Open the Postal run.
            run = postal.PostalRun(args.dataset,
                                   start_time=args.start_time,
                                   end_time=args.end_time)

            # Set the options.
            if args.translate:
                run.set_translate(True)
            if args.filter:
                run.set_filter(True)

            # Match the keys.
            columns = list()
            for column in run.columns:
                for match in args.keys:
                    if fnmatch.fnmatch(column, match):
                        if column not in columns:
                            columns.append(column)

            # Do the export.
            dataframe = postal.DataFrame(run, columns)
            dataframe.to_csv(args.csv)

    cmd = CmdLine()
