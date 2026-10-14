"""Offline and mocked Azure-login readback; never contacts Azure."""
import pathlib
import tempfile
import types
import unittest
from unittest import mock
import urllib.error

import synthetic_fixture as f
import verification_helpers as h


class ReaderContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.data = f.make_png()
        self.receipt = {'objectKey': 'run/attempt/shot.png', 'storageStatus': 'verified',
                        'bytes': len(self.data), 'sha256': h.digest(self.data)}

    def tearDown(self):
        self.temp.cleanup()

    def response(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = self.data
        return response

    def test_online_mode_uses_azure_login_and_read_only_fixed_storage_endpoint(self):
        reader = h.Reader(self.root / 'out')
        with mock.patch.object(h.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout='unit-test-token\n')) as login, \
             mock.patch.object(h.urllib.request, 'urlopen', return_value=self.response()) as get:
            path = reader.read(self.receipt, 'artifact')
        self.assertEqual(reader.identity, 'azure_cli_login')
        self.assertEqual(path.read_bytes(), self.data)
        self.assertEqual(login.call_args.args[0], ['az', 'account', 'get-access-token', '--resource',
            'https://storage.azure.com/', '--query', 'accessToken', '-o', 'tsv'])
        request = get.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.full_url, h.ROOT + self.receipt['objectKey'])
        self.assertEqual(request.get_header('Authorization'), 'Bearer unit-test-token')
        self.assertNotIn('?', request.full_url)
        self.assertEqual(reader.records[self.receipt['objectKey']]['png'], {'width': 1, 'height': 1})

    def test_login_failure_does_not_attempt_storage_request(self):
        reader = h.Reader(self.root / 'out')
        with mock.patch.object(h.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1, stdout='')), \
             mock.patch.object(h.urllib.request, 'urlopen') as get:
            with self.assertRaisesRegex(ValueError, 'login token unavailable'):
                reader.read(self.receipt, 'artifact')
            get.assert_not_called()

    def test_unauthorized_response_refreshes_login_token(self):
        reader = h.Reader(self.root / 'out')
        error = urllib.error.HTTPError(h.ROOT, 401, 'Unauthorized', {}, None)
        with mock.patch.object(h.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout='unit-test-token')) as login, \
             mock.patch.object(h.urllib.request, 'urlopen', side_effect=[error, self.response()]) as get:
            reader.read(self.receipt, 'artifact')
        self.assertEqual(login.call_count, 2)
        self.assertEqual(get.call_count, 2)

    def test_offline_cache_cannot_masquerade_as_azure_login_readback(self):
        source = self.root / 'source' / self.receipt['objectKey']
        source.parent.mkdir(parents=True)
        source.write_bytes(self.data)
        h.Reader(self.root / 'out', self.root / 'source').read(self.receipt, 'artifact')
        reader = h.Reader(self.root / 'out')
        with mock.patch.object(reader, 'fetch', return_value=self.data) as fetch:
            reader.read(self.receipt, 'artifact')
        fetch.assert_called_once()
        self.assertFalse(reader.records[self.receipt['objectKey']]['cacheReused'])

    def test_corrupt_cache_is_refetched_and_verified(self):
        source = self.root / 'source' / self.receipt['objectKey']
        source.parent.mkdir(parents=True)
        source.write_bytes(self.data)
        path = h.Reader(self.root / 'out', self.root / 'source').read(self.receipt, 'artifact')
        path.write_bytes(b'corrupt')
        reader = h.Reader(self.root / 'out', self.root / 'source')
        reader.read(self.receipt, 'artifact')
        self.assertEqual(path.read_bytes(), self.data)
        self.assertFalse(reader.records[self.receipt['objectKey']]['cacheReused'])

    def test_invalid_receipt_and_unsafe_key_fail_before_fetch(self):
        for changes in ({'bytes': True}, {'bytes': -1}, {'storageStatus': 'pending'}, {'sha256': 'bad'},
                        {'objectKey': '../escape'}, {'objectKey': 'run/shot.png?sig=forbidden'}):
            reader = h.Reader(self.root / 'out')
            with self.subTest(changes=changes), mock.patch.object(reader, 'fetch') as fetch:
                with self.assertRaises(ValueError):
                    reader.read({**self.receipt, **changes}, 'artifact')
                fetch.assert_not_called()

    def test_resigned_png_with_bad_crc_or_truncation_is_rejected(self):
        bad_crc = bytearray(self.data)
        bad_crc[-1] ^= 1
        for data in (bytes(bad_crc), self.data[:-3], self.data + b'extra'):
            with self.subTest(length=len(data)), self.assertRaisesRegex(ValueError, 'PNG'):
                h.png_check(data)


if __name__ == '__main__':
    unittest.main()
