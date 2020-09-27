#!/usr/bin/env python3
'''
An object to remotely access data from Postal.
'''
import gc
import getpass
import json
import lzma
import os
import pandas
import psutil
import re
import struct
import sys
import urllib.parse
import urllib3
http = urllib3.PoolManager()

POSTAL_HOST = os.environ.get('POSTAL_HOST', 'http://postal.domain.com')
ENABLE_COMPRESSION = True

FROM_POSTAL_TYPE = {
    'u8': 'B',
    'u16': 'H',
    'u32': 'L',
    'u64': 'Q',
    's8': 'b',
    's16': 'h',
    's32': 'l',
    'float': 'f',
    'double': 'd',
}

MEM_LIMIT = 1500000000

def DataFrame(run, keys):
    '''Wrapper function to create a Pandas DataFrame

       Args:
          run (PostalRun): The run to fetch data from.
          keys (list): A list of keys to put in the DataFrame.

       Returns:
          (pandas.DataFrame): DataFrame of the selected data.
    '''
    series = {}
    for key in keys:
        series[key] = pandas.Series(dict(run[key]))
    return pandas.DataFrame(series)

class PostalRun:
    '''This object represents a Postal dataset.

       Public attributes:
         run_id: The run (dataset) ID.
         start_time: The requested start time for the data (or None).
         end_time: The requested end time for the data (or None).
         columns: A list of columns (keys).
         annotations: A dictionary of annotations.
    '''

    @classmethod
    def get_auth(cls):
        '''Query stored or cached authentication.

           Returns:
              A tuple (str, str) of username and password.
        '''
        def get_key(requested_key):
            try:
                HOME = os.environ['HOME'] if 'HOME' in os.environ else os.environ['USERPROFILE']
                with open(os.path.join(HOME, '.postal'), 'r') as f:
                    for line in f:
                        split = line.split('=')
                        key = split[0].strip()
                        value = split[1].strip()
                        if key == requested_key:
                            return value
            except (KeyError, FileNotFoundError):
                pass
            return None

        if not hasattr(cls, 'auth_user'):
            cls.auth_user = get_key('user')
            if cls.auth_user is None:
                default_user = getpass.getuser()
                cls.auth_user = input(f'User [{default_user}]: ')
            if cls.auth_user == "":
                cls.auth_user = default_user
        if not hasattr(cls, 'auth_password'):
            cls.auth_password = get_key('password')
            if cls.auth_password is None:
                cls.auth_password = getpass.getpass()
        return cls.auth_user, cls.auth_password

    def __init__(self, postal_run, start_time=None, end_time=None,
                 auth_user=None, auth_password=None):
        '''Initialize the state of the object.

           Args:
              postal_run (int): The ID of the run (dataset) in Postal.

           Returns:
              Nothing.
        '''
        self.run_id = postal_run
        self.start_time = start_time
        self.end_time = end_time

        if auth_user is None or auth_password is None:
            auth_user, auth_password = PostalRun.get_auth()
        self.headers = urllib3.util.make_headers(basic_auth=f'{auth_user}:{auth_password}')
        self._check_auth(auth_user)

        self._metadata = None
        self._fetch_metadata()

        self.columns = None
        self._fetch_columns()

        self.annotations = None
        self._fetch_annotations()

        self._fetched = dict()

        self._enable_translate = False

        self._filtered = dict()
        self._enable_filter = False

        self._valid_map = self._metadata.get('valid_map', dict())

        self._lru = list()

    def _check_auth(self, auth_user):
        '''Check that authentication works.

           Returns:
              Nothing.
        '''
        url = f'{POSTAL_HOST}/cgi-bin/get-user.py'
        request = http.request('GET', url, headers=self.headers)
        if request.data.decode('utf-8') != auth_user:
            if request.status != 200:
                print(request.data.decode('utf-8'), file=sys.stderr)
            assert False, 'Failed to authenticate'

    def _fetch_metadata(self):
        '''Populate the metadata from this run.

           Returns:
              Nothing.
        '''

        # Use cache.
        if self._metadata is not None:
            return

        params = {
            'd': self.run_id,
            'raw': 1,
        }
        encoded_params = urllib.parse.urlencode(params)
        url = f'{POSTAL_HOST}/cgi-bin/fetch-metadata.py?{encoded_params}'
        request = http.request('GET', url, headers=self.headers)

        self._metadata = json.loads(request.data.decode('utf-8'))
        if 'restricted' in self._metadata and self._metadata['restricted']:
            raise Exception('Error accessing dataset: you do not have permissions to access the dataset')

        # Translate enums that are indexed by strings to indexing by integers.
        for key, translation in self._metadata['enums'].items():
            if isinstance(translation, dict):
                new_translation = dict()
                for value, string in translation.items():
                    new_translation[int(value)] = string
                self._metadata['enums'][key] = new_translation

    def _fetch_columns(self):
        '''Populate the list of available columns (keys) from this run.

           Returns:
              Nothing.
        '''

        # Use cache.
        if self.columns is not None:
            return

        params = {
            'd': self.run_id,
        }
        encoded_params = urllib.parse.urlencode(params)
        url = f'{POSTAL_HOST}/cgi-bin/fetch-columns.py?{encoded_params}'
        request = http.request('GET', url, headers=self.headers)

        self.columns = json.loads(request.data.decode('utf-8'))

    def _fetch_annotations(self):
        '''Fetch annotations from the run.

           Returns:
              Nothing.
        '''

        # Use cache.
        if self.annotations is not None:
            return

        params = {
            'd': self.run_id,
        }
        encoded_params = urllib.parse.urlencode(params)
        url = f'{POSTAL_HOST}/cgi-bin/fetch-annotations.py?{encoded_params}'
        request = http.request('GET', url, headers=self.headers)

        self.annotations = json.loads(request.data.decode('utf-8'))

        # Trim to the requested interval.
        for t in list(self.annotations.keys()):
            if ((self.start_time and float(t) < self.start_time) or
                (self.end_time and float(t) >= self.end_time)):
                del self.annotations[t]

    def _fetch_data(self, key):
        '''Fetch data for a given column (key) from the run.

           Returns:
              Nothing.
        '''

        self._fetch_columns()
        assert key in self.columns

        # Use cache.
        if key in self._fetched:
            return

        # Keep memory under control.
        process = psutil.Process(os.getpid())
        while len(self._lru) >= 3 and process.memory_info().rss > MEM_LIMIT:
            # Kick out the least recently used piece of data.
            least_used_key = self._lru[-1]
            del self._fetched[least_used_key]
            if least_used_key in self._filtered:
                del self._filtered[least_used_key]
            self._lru.remove(least_used_key)
            gc.collect()

        params = {
            'd': self.run_id,
            'key': key,
        }
        if self.start_time:
            params['start'] = self.start_time
        if self.end_time:
            params['end'] = self.end_time
        encoded_params = urllib.parse.urlencode(params)
        url = f'{POSTAL_HOST}/cgi-bin/fetch.py?{encoded_params}'
        request = http.request('GET', url, headers=self.headers,
                               preload_content=False)

        if 'Content-Length' in request.headers:
            length = request.headers['Content-Length']
        else:
            length = 8192

        if ENABLE_COMPRESSION:
            decompressor = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE)

        # Fetch the data
        decoded_data = bytearray()
        while True:
            buf = request.read(length)
            if len(buf) == 0:
                break

            if ENABLE_COMPRESSION:
                decoded_data += decompressor.decompress(buf)
            else:
                decoded_data += buf

        offset = 0

        # Parse the data type.
        ty = ''
        while True:
            c = chr(decoded_data[offset])
            offset += 1
            if c == '\n':
                break
            ty += c

        unpacker = struct.Struct('<d{}'.format(FROM_POSTAL_TYPE[ty]))

        # Now decode the values.
        series = list()
        while offset < len(decoded_data):
            t, v = unpacker.unpack_from(decoded_data, offset=offset)
            offset += unpacker.size
            series.append((t, v))

        request.release_conn()

        self._fetched[key] = series

        # Add to the head of the LRU list.
        self._lru.insert(0, key)

    def _filter_data(self, key):
        '''Filter data for a given column (key) from the run.

           Returns:
              Nothing.
        '''

        self._fetch_columns()
        assert key in self.columns

        # Use cache.
        if key in self._filtered:
            return

        self._fetch_data(key)
        self._update_lru(key)

        validity_key = self.get_validity_key(key)
        if validity_key is None:
            series = self._fetched[key]
        else:
            # Filter the value accordingly.
            self._fetch_data(validity_key)
            self._update_lru(validity_key)

            series = list()

            valid_index = 0
            t_valid, v_valid = self._fetched[validity_key][valid_index]

            for t, v in self._fetched[key]:
                while t_valid < t:
                    valid_index += 1
                    assert valid_index < len(self._fetched[validity_key])
                    t_valid, v_valid = self._fetched[validity_key][valid_index]

                assert t == t_valid
                if v_valid == 0:
                    series.append((t, v))

        self._filtered[key] = series

    def _update_lru(self, key):
        '''Update the LRU list for the specified key.

           Returns:
               Nothing.
        '''
        # Move the key to the head of the list.
        assert key in self._lru
        self._lru.remove(key)
        self._lru.insert(0, key)

    def __getitem__(self, key):
        def translate(series):
            if self._enable_translate and key in self._metadata['enums']:
                translation = self._metadata['enums'][key]

                if isinstance(translation, dict):
                    return [(t, translation.get(v, f'Unknown value {v}'))
                            for (t, v) in series]
                else:
                    def translate_single(value):
                        if value < len(translation):
                            return translation[value]
                        return f'Unknown value {value}'
                    return [(t, translate_single(v)) for (t, v) in series]
            return series

        if not self._enable_filter:
            self._fetch_data(key)
            self._update_lru(key)
            return translate(self._fetched[key])
        else:
            self._filter_data(key)
            return translate(self._filtered[key])

    def __iter__(self):
        self._fetch_columns()
        return iter(self.columns)

    def set_translate(self, enable=True):
        '''Enable translation of enums when accessing data.

           Args:
               enable (bool): Whether to enable translation.

           Returns:
               The previous state.
        '''
        was_enabled = self._enable_translate
        self._enable_translate = enable
        return was_enabled

    def get_translation(self, key):
        '''Get the translation (list or dictionary) for a key.

           Args:
               key (str): The key to query the corresponding translation for.

           Returns:
               The translation (list or dict) or None.
        '''
        return self._metadata['enums'].get(key, None)

    def set_filter(self, enable=True):
        '''Enable filtering by validity key when accessing data.

           Args:
               enable (bool): Whether to enable filtering by validity key.

           Returns:
               The previous state.
        '''
        was_enabled = self._enable_filter
        self._enable_filter = enable
        return was_enabled

    def get_validity_key(self, key):
        '''Get the validity key corresponding to a key.

           Args:
               key (str): The key to query the corresponding validity key for.

           Returns:
               The validity key (str) or None.
        '''
        for that_key, validity_key in self._valid_map.items():
            if re.fullmatch(that_key, key):
                subbed = re.sub(that_key, validity_key, key)
                if subbed == key:
                    subbed = validity_key
                return subbed
        return None

    def get_sharelink(self, descr):
        '''Generate a sharelink.

           Args:
               descr (dict): Description of what to include in the sharelink:
                             'left' and 'right' contain list of columns to plot
                             on each respective axis, 'window' is a pair of
                             timestamps.

           Returns:
               The URL to the sharelink.
        '''
        sharedata = {
            'datasetId': self.run_id,
            'options': {
                'series': {},
            },
        }

        # TODO: check series exist in the dataset.

        if 'window' in descr:
            sharedata['options']['dateWindow'] = [descr['window'][0], descr['window'][1]]

        if 'left' in descr:
            for series in descr['left']:
                sharedata['options']['series'][series] = {
                    'axis': 'y',
                }

        if 'right' in descr:
            for series in descr['right']:
                sharedata['options']['series'][series] = {
                    'axis': 'y2',
                }

        url = f'{POSTAL_HOST}/cgi-bin/share.py'
        headers = {'Content-Type': 'application/json'}
        headers.update(self.headers)
        request = http.request('POST', url,
                               headers=headers,
                               body=json.dumps(sharedata).encode('utf-8'))
        output = json.loads(request.data.decode('utf-8'))

        return '{}/view.html?s={}'.format(POSTAL_HOST, output['share'])
