import base64
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import screen_ocr  # noqa: E402

HEADER = screen_ocr.TSV_HEADER


def word(block, par, line, left, top, width, height, conf, text):
    return f'5\t1\t{block}\t{par}\t{line}\t1\t{left}\t{top}\t{width}\t{height}\t{conf}\t{text}'


class ParseWordsTest(unittest.TestCase):
    def test_groups_words_into_lines_in_reading_order_at_screen_scale(self):
        raw = '\n'.join([HEADER,
                         word(1, 1, 2, 80, 900, 200, 50, 91.5, '4.6%'), word(1, 1, 2, 300, 900, 100, 50, 88, '(9)'),
                         word(1, 1, 1, 80, 800, 400, 60, 95, 'KEKE'), word(1, 1, 1, 500, 800, 300, 60, 93, 'DELI'),
                         '4\t1\t1\t1\t1\t0\t0\t0\t10\t10\t-1\t'])
        lines = screen_ocr.group_lines(screen_ocr.parse_words(raw, 2, 720, 1280))
        self.assertEqual([line['text'] for line in lines], ['KEKE DELI', '4.6% (9)'])
        self.assertEqual(lines[0]['bounds'], {'left': 40, 'top': 400, 'right': 400, 'bottom': 430})
        self.assertEqual(lines[1]['confidence'], 89.75)
        self.assertEqual(len(lines[0]['words']), 2)

    def test_engine_uses_one_thread_and_reports_timeout_without_engine_text(self):
        from unittest.mock import patch
        import time, contextlib
        output = io.StringIO()
        with patch.object(screen_ocr.subprocess, 'run', side_effect=subprocess.TimeoutExpired('private-command', 0.01, stderr='private-secret')) as run, contextlib.redirect_stderr(output):
            with self.assertRaises(subprocess.TimeoutExpired):
                screen_ocr.run_engine(['tesseract', 'private.png', 'stdout', '--psm', '4'], time.monotonic()+1)
        self.assertEqual(run.call_args.kwargs['env']['OMP_THREAD_LIMIT'], '1')
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(events[-1]['stage'], 'full_screen')
        self.assertTrue(events[-1]['timedOut'])
        self.assertEqual(events[-1]['errorClass'], 'TimeoutExpired')
        self.assertNotIn('private-', output.getvalue())

    def test_rejects_geometry_outside_the_screenshot(self):
        with self.assertRaises(ValueError):
            screen_ocr.parse_words('\n'.join([HEADER, word(1, 1, 1, 1400, 10, 100, 10, 50, 'x')]), 2, 720, 1280)

    def test_rejects_bad_header_or_row(self):
        with self.assertRaises(ValueError):
            screen_ocr.parse_words('wrong header', 2, 720, 1280)
        with self.assertRaises(ValueError):
            screen_ocr.parse_words('\n'.join([HEADER, '5\t1\t1']), 2, 720, 1280)


class RecognizeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        shim = Path(self.directory.name) / 'tesseract'
        shim.write_text('#!/bin/sh\n'
                        'case "$1" in\n'
                        '  --version) echo "tesseract 5.3.0 (test)";;\n'
                        '  --list-langs) printf "List of available languages (3):\\neng\\nchi_sim\\nchi_tra\\n";;\n'
                        '  *) printf "' + HEADER.replace('\t', '\\t') + '\\n"; printf "5\\t1\\t1\\t1\\t1\\t1\\t20\\t20\\t100\\t30\\t90\\tHello\\n";;\n'
                        'esac\n')
        shim.chmod(shim.stat().st_mode | stat.S_IEXEC)
        self.environment = dict(os.environ, PATH=f'{self.directory.name}:{os.environ["PATH"]}')
        from PIL import Image
        buffer = io.BytesIO()
        Image.new('RGB', (100, 100), 'white').save(buffer, format='PNG')
        self.png = buffer.getvalue()

    def tearDown(self):
        self.directory.cleanup()

    def run_script(self, request):
        return subprocess.run([sys.executable, str(Path(__file__).resolve().parent / 'screen_ocr.py')], input=json.dumps(request).encode(),
                              capture_output=True, env=self.environment)

    def test_full_screen_ocr_returns_lines_with_provenance(self):
        result = self.run_script({'pngBase64': base64.b64encode(self.png).decode(), 'timeoutMs': 5000, 'languages': 'eng+chi_sim', 'scale': 2})
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload['schemaVersion'], 'android-screen-ocr/v1')
        self.assertEqual(payload['imageWidth'], 100)
        self.assertEqual(payload['scale'], 2)
        self.assertEqual(payload['lines'][0]['text'], 'Hello')
        self.assertEqual(payload['lines'][0]['bounds'], {'left': 10, 'top': 10, 'right': 60, 'bottom': 25})
        self.assertEqual(payload['imageSha256'], __import__('hashlib').sha256(self.png).hexdigest())

    def test_rejects_non_png_unsupported_language_and_bad_scale(self):
        for request in [{'pngBase64': base64.b64encode(b'notpng').decode()},
                        {'pngBase64': base64.b64encode(self.png).decode(), 'languages': 'jpn'},
                        {'pngBase64': base64.b64encode(self.png).decode(), 'scale': 9}]:
            result = self.run_script(request)
            self.assertEqual(result.returncode, 1)
            self.assertIn(b'OCR failed', result.stderr)


class RatingRereadTest(unittest.TestCase):
    def setUp(self):
        from PIL import Image
        self.image = Image.new('RGB', (720, 1280), 'white')
        self.line = {'text': '4.19% (18) - Chinese', 'bounds': {'left': 40, 'top': 520, 'right': 400, 'bottom': 550}}

    def test_reads_same_bounded_crop_with_two_modes_and_keeps_primary(self):
        from unittest.mock import patch
        import copy, time
        lines = [copy.deepcopy(self.line)]
        raw = '\n'.join([HEADER, word(1, 1, 1, 18, 18, 240, 60, 90, '4.1%'), word(1, 1, 1, 270, 18, 120, 60, 90, '(18)')])
        with tempfile.TemporaryDirectory() as d, patch.object(screen_ocr, 'run_engine', return_value=raw) as engine:
            result = screen_ocr.reread_ratings(self.image, lines, 3, Path(d), time.monotonic()+10)
        self.assertEqual(lines, [self.line])
        self.assertEqual([p['psm'] for p in result[0]['passes']], [7, 13])
        self.assertEqual(result[0]['passes'][0]['lines'][0]['text'], '4.1% (18)')
        self.assertEqual(result[0]['passes'][0]['lines'][0]['bounds']['left'], 40)
        self.assertEqual(engine.call_count, 2)

    def test_limits_candidates_and_does_not_reread_valid_ratings_or_prose(self):
        from unittest.mock import patch
        import time
        lines = [{'text': text, 'bounds': self.line['bounds']} for text in ['4.1% (18)', '4.1 stars (18)', 'open at 4.19', '4.19% (18)', '49% (55)', '3.88% (20)']]
        with tempfile.TemporaryDirectory() as d, patch.object(screen_ocr, 'run_engine', return_value=HEADER) as engine:
            result = screen_ocr.reread_ratings(self.image, lines, 3, Path(d), time.monotonic()+10)
        self.assertEqual([r['lineIndex'] for r in result], [3, 4])
        self.assertEqual(engine.call_count, 4)

    def test_optional_timeout_keeps_primary_and_records_bounded_failure(self):
        from unittest.mock import patch
        import time
        with tempfile.TemporaryDirectory() as d, patch.object(screen_ocr, 'run_engine', side_effect=subprocess.TimeoutExpired('private-command', 1)):
            result = screen_ocr.reread_ratings(self.image, [self.line], 3, Path(d), time.monotonic()+10)
        self.assertEqual(result[0]['error'], 'TimeoutExpired')
        self.assertNotIn('private-command', json.dumps(result))
        self.assertEqual(result[0]['passes'], [])


if __name__ == '__main__':
    unittest.main()
