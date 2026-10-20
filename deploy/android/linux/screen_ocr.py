"""Full-screen OCR of one immutable PNG screenshot; emit text lines with screen-pixel bounds.

stdin:  {pngBase64, timeoutMs, languages:'eng+chi_sim+chi_tra', scale:2}
stdout: android-screen-ocr/v1 — the screenshot hash, engine identity and every
        recognized line (text, confidence, bounds) in top-to-bottom order.

The reader in src/android/screen-reader.ts turns these lines into result cards.
No remote service is used; Tesseract runs locally with the pinned language packs.
"""
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from PIL import Image

MAX_INPUT = 24 * 1024 * 1024
MAX_OUTPUT = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
DEFAULT_SCALE = 2
TSV_HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'


def parse_words(raw, scale, width, height):
    rows = raw.rstrip('\r\n').splitlines()
    if not rows or rows.pop(0) != TSV_HEADER:
        raise ValueError('Invalid Tesseract TSV header')
    words = []
    for row in rows:
        if not row:
            continue
        fields = row.split('\t')
        if len(fields) != 12:
            raise ValueError('Invalid Tesseract TSV row')
        if fields[0] != '5' or not fields[11].strip():
            continue
        block, paragraph, line, left, top, w, h = [int(fields[i]) for i in [2, 3, 4, 6, 7, 8, 9]]
        confidence = float(fields[10])
        if not math.isfinite(confidence) or not 0 <= confidence <= 100 or min(left, top) < 0 or min(w, h) <= 0:
            raise ValueError('Invalid Tesseract word geometry/confidence')
        if left + w > width * scale or top + h > height * scale:
            raise ValueError('Tesseract word lies outside the screenshot')
        words.append({'text': fields[11], 'confidence': confidence, 'block': block, 'paragraph': paragraph, 'line': line,
                      'bounds': {'left': left / scale, 'top': top / scale, 'right': (left + w) / scale, 'bottom': (top + h) / scale}})
    return words


def group_lines(words):
    """Group Tesseract words into lines in reading order; bounds are the union of their words."""
    groups = {}
    for word in words:
        groups.setdefault((word['block'], word['paragraph'], word['line']), []).append(word)
    lines = []
    for key, members in groups.items():
        members.sort(key=lambda w: w['bounds']['left'])
        bounds = {'left': min(w['bounds']['left'] for w in members), 'top': min(w['bounds']['top'] for w in members),
                  'right': max(w['bounds']['right'] for w in members), 'bottom': max(w['bounds']['bottom'] for w in members)}
        lines.append({'text': ' '.join(w['text'] for w in members), 'confidence': round(sum(w['confidence'] for w in members) / len(members), 2),
                      'bounds': bounds, 'words': [{'text': w['text'], 'confidence': w['confidence'], 'bounds': w['bounds']} for w in members]})
    lines.sort(key=lambda line: (line['bounds']['top'], line['bounds']['left']))
    return lines


def run_engine(args, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('OCR deadline exceeded')
    result = subprocess.run(args, capture_output=True, text=True, timeout=remaining, check=True)
    if len(result.stdout.encode()) + len(result.stderr.encode()) > MAX_OUTPUT:
        raise ValueError('OCR output budget exceeded')
    return result.stdout


def recognize(request):
    timeout_ms = request.get('timeoutMs', 20_000)
    if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, (int, float)) or not math.isfinite(timeout_ms) or not 1 <= timeout_ms <= 120_000:
        raise ValueError('Invalid OCR deadline')
    deadline = time.monotonic() + timeout_ms / 1000
    scale = request.get('scale', DEFAULT_SCALE)
    if isinstance(scale, bool) or type(scale) is not int or not 1 <= scale <= 3:
        raise ValueError('Invalid OCR scale')
    encoded = request.get('pngBase64', '')
    if not isinstance(encoded, str) or len(encoded) > MAX_INPUT:
        raise ValueError('PNG input budget exceeded')
    png = base64.b64decode(encoded, validate=True)
    if not png.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('PNG input required')
    with Image.open(io.BytesIO(png)) as source:
        if source.width * source.height * scale * scale > MAX_PIXELS:
            raise ValueError('PNG pixel budget exceeded')
        width, height = source.size
        source.verify()
    languages = request.get('languages', 'eng+chi_sim+chi_tra')
    if not isinstance(languages, str) or not re.fullmatch(r'(?:eng|chi_sim|chi_tra)(?:\+(?:eng|chi_sim|chi_tra))*', languages):
        raise ValueError('Unsupported OCR languages')
    version = run_engine(['tesseract', '--version'], deadline).splitlines()[0]
    available = set(run_engine(['tesseract', '--list-langs'], deadline).splitlines())
    if not set(languages.split('+')).issubset(available):
        raise ValueError('Required OCR languages unavailable')
    with Image.open(io.BytesIO(png)) as original, tempfile.TemporaryDirectory(prefix='android-screen-ocr-') as directory:
        image = original.convert('RGB')
        if scale != 1:
            image = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
        path = Path(directory) / 'screen.png'
        image.save(path)
        # psm 4: one column of text with lines of varying size, matching the result sheet.
        raw = run_engine(['tesseract', str(path), 'stdout', '-l', languages, '--psm', '4', 'tsv'], deadline)
    lines = group_lines(parse_words(raw, scale, width, height))
    result = {'schemaVersion': 'android-screen-ocr/v1', 'imageSha256': hashlib.sha256(png).hexdigest(),
              'imageWidth': width, 'imageHeight': height, 'engine': 'tesseract', 'engineVersion': version,
              'languages': languages, 'scale': scale, 'lines': lines}
    if len(json.dumps(result).encode()) > MAX_OUTPUT:
        raise ValueError('OCR response budget exceeded')
    return result


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError('OCR request budget exceeded')
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError('OCR request must be an object')
    print(json.dumps(recognize(request), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'OCR failed: {type(error).__name__}: {str(error)[:400]}', file=sys.stderr)
        sys.exit(1)
