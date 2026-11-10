#!/usr/bin/env python3
import base64
import io
import json
import os
import re
import shutil
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urljoin

import numpy as np
import requests

FEED = os.environ.get('ARXIV_FEED', 'astro-ph')
MAX_POOL = int(os.environ.get('MAX_POOL', '200'))
INCLUDE_TYPES = set(os.environ.get('ANNOUNCE_TYPES', 'new,cross').split(','))
OUT_DIR = os.environ.get('OUT_DIR', 'data')
KEEP_DAYS = int(os.environ.get('KEEP_DAYS', '3'))
FIG_MAX_PX = int(os.environ.get('FIG_MAX_PX', '1100'))
FIG_WORKERS = int(os.environ.get('FIG_WORKERS', '4'))
MAX_AUTHORS = 60

LLM_KEY = os.environ.get('LLM_API_KEY') or os.environ.get('GITHUB_TOKEN')
LLM_BASE = os.environ.get('LLM_BASE_URL', 'https://models.github.ai/inference')
LLM_MODEL = os.environ.get('LLM_MODEL', 'openai/gpt-4o-mini')
LLM_BATCH = int(os.environ.get('LLM_BATCH', '8'))

USER_AGENT = 'periodical/2.0 (daily astro-ph digest; static site build)'
XML_NS = {
    'arxiv': 'http://arxiv.org/schemas/atom',
    'dc': 'http://purl.org/dc/elements/1.1/',
}

GREEK_LETTERS = {
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ',
    'epsilon': 'ε', 'varepsilon': 'ε', 'zeta': 'ζ', 'eta': 'η',
    'theta': 'θ', 'vartheta': 'ϑ', 'iota': 'ι', 'kappa': 'κ',
    'lambda': 'λ', 'mu': 'μ', 'nu': 'ν', 'xi': 'ξ', 'pi': 'π',
    'rho': 'ρ', 'sigma': 'σ', 'tau': 'τ', 'upsilon': 'υ',
    'phi': 'φ', 'varphi': 'φ', 'chi': 'χ', 'psi': 'ψ', 'omega': 'ω',
    'Gamma': 'Γ', 'Delta': 'Δ', 'Theta': 'Θ', 'Lambda': 'Λ',
    'Xi': 'Ξ', 'Pi': 'Π', 'Sigma': 'Σ', 'Upsilon': 'Υ',
    'Phi': 'Φ', 'Psi': 'Ψ', 'Omega': 'Ω',
}

MATH_SYMBOLS = {
    'sim': '∼', 'approx': '≈', 'simeq': '≃', 'lesssim': '≲',
    'gtrsim': '≳', 'la': '≲', 'ga': '≳', 'leq': '≤', 'le': '≤',
    'geq': '≥', 'ge': '≥', 'neq': '≠', 'ne': '≠', 'pm': '±',
    'mp': '∓', 'times': '×', 'cdot': '·', 'odot': '☉', 'sun': '☉',
    'oplus': '⊕', 'earth': '⊕', 'star': '⋆', 'ast': '*',
    'prime': '′', 'infty': '∞', 'propto': '∝', 'rightarrow': '→',
    'to': '→', 'leftarrow': '←', 'Rightarrow': '⇒',
    'leftrightarrow': '↔', 'degree': '°', 'circ': '∘', 'AA': 'Å',
    'ell': 'ℓ', 'partial': '∂', 'nabla': '∇', 'langle': '⟨',
    'rangle': '⟩', 'ldots': '…', 'dots': '…', 'cdots': '⋯',
    'll': '≪', 'gg': '≫', 'in': '∈', 'sum': 'Σ', 'int': '∫',
    'equiv': '≡', 'perp': '⊥', 'parallel': '∥', 'hbar': 'ℏ',
    'dagger': '†', 'bullet': '•', 'deg': '°', 'arcsec': '″',
    'arcmin': '′', 'micron': 'μm', 'farcs': '″',
    ',': '\u2009', ';': ' ', ':': ' ', '!': '', ' ': ' ',
    'quad': ' ', 'qquad': '  ', '%': '%', '&': '&', '#': '#',
    '_': '_', '{': '{', '}': '}', '$': '$', 'textbackslash': '\\',
}

WRAPPER_COMMANDS = {
    'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal',
    'mathbb', 'boldsymbol', 'bm', 'text', 'textrm', 'textbf',
    'textit', 'textsf', 'texttt', 'emph', 'mbox', 'hbox',
    'operatorname', 'mathring', 'overline', 'underline',
    'widetilde', 'tilde', 'hat', 'widehat', 'bar', 'vec',
    'dot', 'ddot', 'ensuremath', 'textsc', 'textup',
    'textnormal', 'mathnormal',
}

SWITCH_COMMANDS = {
    'rm', 'bf', 'it', 'sf', 'tt', 'cal', 'em',
    'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
    'displaystyle', 'textstyle', 'scriptstyle',
    'normalsize', 'small', 'footnotesize', 'noindent',
}

SUPERSCRIPTS = dict(zip(
    '0123456789+-−=()niabcdefghjklmoprstuvwxyz',
    '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ',
))
SUBSCRIPTS = dict(zip('0123456789+-−=()', '₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎'))

CODE_URL_RE = re.compile(
    r'https?://(?:www\.)?(?:github\.com|[\w-]+\.github\.io|gitlab\.com|'
    r'bitbucket\.org|zenodo\.org|codeberg\.org|pypi\.org|ascl\.net|'
    r'huggingface\.co)/[^\s)\]},;\x22\x27<>]+',
    re.I,
)
ACCEPTED_RE = re.compile(r'\b(accepted|in press|published|to appear)\b', re.I)

FINDING_CUE_RE = re.compile(
    r'\b(we (find|show|report|detect|measure|discover|demonstrate|'
    r'identify|obtain|derive|confirm|constrain|present)|'
    r'results? (show|indicate|suggest|reveal)|'
    r'reveal|indicat|suggest|constrain|detect|discover|first)\b',
    re.I,
)
FILLER_LEAD_RE = re.compile(
    r'^(?:(?:we|i|our (?:\w+ ){0,3}?'
    r'(?:results?|analysis|findings|simulations?|models?|observations?|data))\s+'
    r'(?:\w+ly\s+)?'
    r'(?:find|found|show|showed|shows|conclude|demonstrate|demonstrates|'
    r'indicate|indicates|suggest|suggests|reveal|reveals|confirm|argue|'
    r'report|establish)\s+that\s+)',
    re.I,
)

SUMMARY_SYSTEM_PROMPT = (
    'You write one-line digests of astrophysics preprints for researchers '
    'skimming a daily feed. For each paper write ONE sentence of at most '
    '24 words stating the main result or contribution concretely: what was '
    'found, measured, built or predicted, with the key number or comparison '
    'when the abstract gives one. Lead with substance; never start with '
    'phrases like This paper, We show, The authors, or In this work. '
    'Plain text only: no LaTeX, no markdown; Unicode symbols are fine '
    '(e.g. M☉, ≈, ∼, z≈7). Respond with a JSON object containing an '
    'items list of objects with id and summary keys.'
)

http = requests.Session()
http.headers['User-Agent'] = USER_AGENT


def log(*args):
    print(*args, flush=True)


class TexReader:
    def __init__(self, source, in_math=False):
        self.source = source
        self.index = 0
        self.in_math = in_math

    def peek(self):
        if self.index < len(self.source):
            return self.source[self.index]
        return ''

    def read_command(self):
        self.index += 1
        match = re.match(r'[A-Za-z]+|.', self.source[self.index:], re.S)
        if not match:
            return ''
        token = match.group(0)
        self.index += len(token)
        return token

    def read_group(self):
        depth = 1
        start = self.index + 1
        self.index += 1
        while self.index < len(self.source) and depth > 0:
            char = self.source[self.index]
            if char == '\\':
                self.index += 2
                continue
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            self.index += 1
        return self.source[start:self.index - 1]

    def read_atom(self):
        while self.peek() == ' ':
            self.index += 1
        char = self.peek()
        if char == '{':
            return convert_tex_segment(self.read_group(), self.in_math)
        if char == '\\':
            return self.expand_command(self.read_command())
        self.index += 1
        return convert_tex_segment(char, self.in_math)

    def expand_command(self, name):
        if name in GREEK_LETTERS:
            return GREEK_LETTERS[name]
        if name in MATH_SYMBOLS:
            return MATH_SYMBOLS[name]
        if name in ('frac', 'dfrac', 'tfrac'):
            numerator = self.read_atom()
            denominator = self.read_atom()
            if len(numerator) > 1 and not numerator.isalnum():
                numerator = f'({numerator})'
            if len(denominator) > 1 and not denominator.isalnum():
                denominator = f'({denominator})'
            return f'{numerator}/{denominator}'
        if name == 'sqrt':
            return '√' + self.read_atom()
        if name in SWITCH_COMMANDS:
            if name in ('left', 'right') and self.peek() == '.':
                self.index += 1
            return ''
        if name in WRAPPER_COMMANDS:
            return self.read_atom()
        return name

    def format_script(self, table, prefix):
        body = self.read_atom().strip()
        if not body:
            return ''
        if body in ('∘', '°'):
            return '°'
        if prefix == '^' and body in ('′', '\''):
            return '′'
        can_map = all(ch in table for ch in body)
        is_short = len(body) <= 4 or body.lstrip('-−').isdigit()
        if can_map and is_short:
            return ''.join(table[ch] for ch in body)
        if prefix == '_':
            return body if len(body) <= 3 else f'_{body}'
        if re.fullmatch(r'[\w.−+]+', body):
            return f'^{body}'
        return f'^({body})'

    def parse(self):
        output = []
        while self.index < len(self.source):
            char = self.peek()
            if char == '\\':
                output.append(self.expand_command(self.read_command()))
            elif char == '{':
                output.append(convert_tex_segment(self.read_group(), self.in_math))
            elif char == '}':
                self.index += 1
            elif self.in_math and char == '^':
                self.index += 1
                output.append(self.format_script(SUPERSCRIPTS, '^'))
            elif self.in_math and char == '_':
                self.index += 1
                output.append(self.format_script(SUBSCRIPTS, '_'))
            elif self.in_math and char == '-':
                self.index += 1
                output.append('−')
            elif char == '~':
                self.index += 1
                output.append(' ' if self.in_math else '\u00a0')
            else:
                self.index += 1
                output.append(char)
        return ''.join(output)


def convert_tex_segment(text, in_math=False):
    return TexReader(text, in_math).parse()


def clean_tex(text):
    if not text:
        return ''
    normalized = re.sub(r'\s+', ' ', text).strip()
    parts = re.split(r'(?<!\\)(\$\$?)', normalized)
    output = []
    in_math = False
    for part in parts:
        if part in ('$', '$$'):
            in_math = not in_math
            continue
        output.append(convert_tex_segment(part, in_math))
    cleaned = ''.join(output)
    cleaned = cleaned.replace(' -> ', ' → ').replace(' <- ', ' ← ')
    cleaned = cleaned.replace('---', '—').replace('--', '–')
    cleaned = cleaned.replace('``', '“').replace('\'\'', '”')
    cleaned = re.sub(r'[ \t]{2,}', ' ', cleaned)
    cleaned = re.sub(r'\s+([,.;:)])', r'\1', cleaned)
    return cleaned.strip()


def fetch_rss_announcements():
    url = f'https://rss.arxiv.org/rss/{FEED}'
    log(f'Fetching {url}')
    response = http.get(url, timeout=60)
    response.raise_for_status()

    root = ET.fromstring(response.content)
    channel = root.find('channel')
    pub_date = channel.findtext('pubDate')
    if pub_date:
        day = parsedate_to_datetime(pub_date).date().isoformat()
    else:
        day = datetime.now(timezone.utc).date().isoformat()

    items = []
    pattern = re.compile(
        r'\s*arXiv:(\S+?)(v\d+)?\s+Announce Type:\s*\S+\s*Abstract:\s*(.*)',
        re.S,
    )
    for item in channel.findall('item'):
        announce_type = (item.findtext('arxiv:announce_type', '', XML_NS) or '').strip()
        if announce_type not in INCLUDE_TYPES:
            continue
        description = item.findtext('description', '') or ''
        match = pattern.match(description)
        if not match:
            continue
        creators = item.findtext('dc:creator', '', XML_NS) or ''
        authors = [
            name.strip()
            for name in re.split(r',\s*(?![^()]*\))', creators)
            if name.strip()
        ]
        categories = [
            cat.text
            for cat in item.findall('category')
            if cat.text
        ]
        version_text = match.group(2) or 'v1'
        items.append({
            'id': match.group(1),
            'v': int(version_text[1:]),
            'type': announce_type,
            'title': item.findtext('title', ''),
            'abstract': match.group(3),
            'authors': authors,
            'cats': categories,
            'doi': item.findtext('arxiv:DOI', None, XML_NS),
        })
    return day, items


def enrich_from_arxiv_api(items):
    try:
        import arxiv
    except ImportError:
        return

    client = arxiv.Client(page_size=100, delay_seconds=3, num_retries=3)
    by_id = {paper['id']: paper for paper in items}
    all_ids = list(by_id.keys())

    for start in range(0, len(all_ids), 100):
        batch_ids = all_ids[start:start + 100]
        search = arxiv.Search(id_list=batch_ids, max_results=100)
        try:
            for result in client.results(search):
                raw_id = result.entry_id.rsplit('/abs/', 1)[-1]
                clean_id = re.sub(r'v\d+$', '', raw_id)
                paper = by_id.get(clean_id)
                if not paper:
                    continue
                author_names = [author.name for author in result.authors]
                if author_names:
                    paper['authors'] = author_names
                other_cats = [
                    cat for cat in result.categories
                    if cat != result.primary_category
                ]
                paper['cats'] = [result.primary_category] + other_cats
                paper['comment'] = result.comment or ''
                paper['journal'] = result.journal_ref or ''
                paper['doi'] = result.doi or paper.get('doi')
                paper['abstract'] = result.summary or paper['abstract']
        except Exception as err:
            log(f'  arXiv API enrichment failed for batch {start}: {err}')


def find_code_link(paper):
    combined = paper.get('abstract', '') + ' ' + paper.get('comment', '')
    matches = CODE_URL_RE.findall(combined)
    if not matches:
        return None
    return matches[0].rstrip('.')


class ArxivHtmlFigureParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.figures = []
        self.current = None
        self.figure_depth = 0
        self.caption_depth = 0
        self.math_depth = 0

    def handle_starttag(self, tag, attrs):
        attr_map = dict(attrs)
        classes = attr_map.get('class') or ''

        if tag == 'figure':
            is_figure = 'ltx_figure' in classes and 'ltx_table' not in classes
            if self.current is None and is_figure:
                self.current = {
                    'id': attr_map.get('id', ''),
                    'imgs': [],
                    'caption_parts': [],
                }
                self.figure_depth = 1
            elif self.current is not None:
                self.figure_depth += 1
            return

        if self.current is None:
            return

        if tag == 'img' and attr_map.get('src'):
            width_str = attr_map.get('width') or ''
            height_str = attr_map.get('height') or ''
            self.current['imgs'].append({
                'src': attr_map['src'],
                'w': int(width_str) if width_str.isdigit() else 0,
                'h': int(height_str) if height_str.isdigit() else 0,
            })
        elif tag == 'figcaption':
            self.caption_depth += 1
        elif tag == 'math' and self.caption_depth > 0:
            self.math_depth += 1
            if self.math_depth == 1:
                alt_tex = attr_map.get('alttext', '')
                self.current['caption_parts'].append(f' ${alt_tex}$ ')
        elif tag == 'span' and 'ltx_tag' in classes and self.caption_depth > 0:
            self.caption_depth += 100

    def handle_endtag(self, tag):
        if self.current is None:
            return
        if tag == 'math' and self.math_depth > 0:
            self.math_depth -= 1
        elif tag == 'span' and self.caption_depth >= 100:
            self.caption_depth -= 100
        elif tag == 'figcaption' and self.caption_depth > 0:
            self.caption_depth -= 1
        elif tag == 'figure':
            self.figure_depth -= 1
            if self.figure_depth == 0:
                self.figures.append(self.current)
                self.current = None

    def handle_data(self, data):
        in_caption = 0 < self.caption_depth < 100
        if self.current is not None and in_caption and self.math_depth == 0:
            self.current['caption_parts'].append(data)


def select_best_figure(figures):
    candidates = []
    for rank, fig in enumerate(figures[:5]):
        raster_imgs = [
            img for img in fig['imgs']
            if not img['src'].lower().endswith('.svg')
        ]
        if not raster_imgs:
            continue
        largest = max(raster_imgs, key=lambda img: img['w'] * img['h'])
        if largest['w'] and largest['h']:
            aspect = largest['w'] / largest['h']
        else:
            aspect = 1.4
        score = -rank * 0.6
        if not (0.75 <= aspect <= 2.1):
            score -= 1.2
        if len(raster_imgs) > 4:
            score -= 0.8
        candidates.append((score, fig, largest))

    if not candidates:
        return None, None
    best = max(candidates, key=lambda item: item[0])
    return best[1], best[2]


def extract_first_sentence(text, limit=220):
    compact = re.sub(r'\s+', ' ', text).strip()
    match = re.match(r'(.+?[.!?])(\s+[A-Z(]|$)', compact)
    sentence = match.group(1) if match else compact
    if len(sentence) <= limit:
        return sentence
    return sentence[:limit].rsplit(' ', 1)[0] + '…'


def download_paper_figure(paper, fig_dir, rel_dir):
    from PIL import Image

    filename = paper['id'].replace('/', '_') + '.webp'
    target_path = os.path.join(fig_dir, filename)
    html_url = 'https://arxiv.org/html/' + paper['id'] + 'v' + str(paper['v'])

    try:
        response = http.get(html_url, timeout=30)
        if response.status_code != 200 or 'ltx_' not in response.text:
            return
        paper['html'] = True

        parser = ArxivHtmlFigureParser()
        parser.feed(response.text)
        figure, image_meta = select_best_figure(parser.figures)
        if not image_meta:
            return

        raw_caption = ''.join(figure['caption_parts'])
        caption = clean_tex(raw_caption)
        caption = re.sub(r'^\W*((Figure|Fig\.)\s*\d+\W*)?', '', caption)
        if caption:
            paper['caption'] = extract_first_sentence(caption)

        if os.path.exists(target_path):
            with Image.open(target_path) as existing:
                paper['fig'] = f'{rel_dir}/{filename}'
                paper['fig_w'] = existing.width
                paper['fig_h'] = existing.height
            return

        image_url = urljoin(response.url.rstrip('/'), image_meta['src'])
        image_response = http.get(image_url, timeout=30)
        image_response.raise_for_status()

        image = Image.open(io.BytesIO(image_response.content))
        image.seek(0)
        if image.width < 160 or image.height < 100:
            return

        if image.mode in ('RGBA', 'LA', 'P'):
            rgba = image.convert('RGBA')
            canvas = Image.new('RGB', rgba.size, (255, 255, 255))
            canvas.paste(rgba, mask=rgba.split()[-1])
            image = canvas
        else:
            image = image.convert('RGB')

        image.thumbnail((FIG_MAX_PX, FIG_MAX_PX), Image.LANCZOS)
        image.save(target_path, 'WEBP', quality=76, method=6)
        paper['fig'] = f'{rel_dir}/{filename}'
        paper['fig_w'] = image.width
        paper['fig_h'] = image.height
    except Exception as err:
        log('  figure failed for ' + paper['id'] + f': {err}')


def fetch_all_figures(papers, day):
    fig_dir = os.path.join(OUT_DIR, 'figs', day)
    os.makedirs(fig_dir, exist_ok=True)
    rel_dir = f'{OUT_DIR}/figs/{day}'

    with ThreadPoolExecutor(FIG_WORKERS) as executor:
        list(executor.map(lambda p: download_paper_figure(p, fig_dir, rel_dir), papers))

    stored_count = sum(1 for paper in papers if paper.get('fig'))
    log(f'  {stored_count}/{len(papers)} papers have a stored figure')


def prune_old_figures(current_day):
    root = os.path.join(OUT_DIR, 'figs')
    if not os.path.isdir(root):
        return
    cutoff_date = datetime.fromisoformat(current_day) - timedelta(days=KEEP_DAYS)
    cutoff_str = cutoff_date.date().isoformat()
    for folder in os.listdir(root):
        if re.match(r'\d{4}-\d{2}-\d{2}$', folder) and folder < cutoff_str:
            shutil.rmtree(os.path.join(root, folder), ignore_errors=True)


def compute_embeddings(papers):
    from fastembed import TextEmbedding

    cache_dir = os.environ.get('FASTEMBED_CACHE', os.path.join('.cache', 'fastembed'))
    model = TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir=cache_dir)
    texts = [paper['title'] + '. ' + paper['abstract'] for paper in papers]
    vectors = np.array(list(model.embed(texts)), dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
    vectors = vectors / norms

    for paper, vec in zip(papers, vectors):
        scale = np.abs(vec).max() + 1e-9
        quantized = np.clip(np.round(vec / scale * 127), -127, 127).astype(np.int8)
        paper['vec'] = base64.b64encode(quantized.tobytes()).decode('ascii')


def split_into_sentences(text):
    protected = re.sub(
        r'\b(e\.g|i\.e|et al|cf|approx|vs|Fig|Eq|resp)\.',
        lambda m: m.group(0).replace('.', '§'),
        text,
    )
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9(\[])', protected)
    return [part.replace('§', '.').strip() for part in parts if part.strip()]


def build_heuristic_summary(abstract):
    sentences = split_into_sentences(abstract)
    if not sentences:
        return ''

    def score_sentence(item):
        idx, sentence = item
        cue_bonus = 2.0 if FINDING_CUE_RE.search(sentence) else 0.0
        position_bonus = (idx / max(1, len(sentences))) * 0.8
        length_penalty = 1.5 if len(sentence.split()) > 45 else 0.0
        return cue_bonus + position_bonus - length_penalty

    best = max(enumerate(sentences), key=score_sentence)[1]
    best = re.sub(
        r'^(Here|In this (paper|work|study|letter)|Finally|Overall|'
        r'In summary|Thus|Therefore|Moreover|Furthermore),?\s+',
        '',
        best,
        flags=re.I,
    )
    best = FILLER_LEAD_RE.sub('', best).strip()

    words = best.split()
    if len(words) > 30:
        truncated = ' '.join(words[:28])
        clause_match = re.match(r'(.{60,}?)[,;:]\s', truncated)
        if clause_match:
            best = clause_match.group(1) + '…'
        else:
            best = truncated.rstrip(',;:') + '…'

    return best[0].upper() + best[1:]


def generate_summaries(papers, previous_papers):
    pending = []
    for paper in papers:
        cached = previous_papers.get(paper['id'])
        if cached and cached.get('micro_src') == 'llm' and cached.get('micro'):
            paper['micro'] = cached['micro']
            paper['micro_src'] = 'llm'
        else:
            paper['micro'] = build_heuristic_summary(paper['abstract'])
            paper['micro_src'] = 'heuristic'
            pending.append(paper)

    if not LLM_KEY or not pending:
        reason = 'no API key' if not LLM_KEY else 'all cached'
        log(f'  LLM summaries skipped ({reason})')
        return

    from openai import OpenAI

    client = OpenAI(base_url=LLM_BASE, api_key=LLM_KEY, max_retries=0)
    completed = 0

    for start in range(0, len(pending), LLM_BATCH):
        batch = pending[start:start + LLM_BATCH]
        prompt_blocks = [
            'id: ' + p['id'] + '\ntitle: ' + p['title'] + '\nabstract: ' + p['abstract']
            for p in batch
        ]
        user_payload = '\n\n'.join(prompt_blocks)

        for attempt in range(4):
            try:
                response = client.chat.completions.create(
                    model=LLM_MODEL,
                    messages=[
                        {'role': 'system', 'content': SUMMARY_SYSTEM_PROMPT},
                        {'role': 'user', 'content': user_payload},
                    ],
                    temperature=0.2,
                    max_tokens=90 * len(batch),
                    response_format={'type': 'json_object'},
                )
                content = response.choices[0].message.content
                parsed_items = json.loads(content).get('items', [])
                by_id = {
                    str(entry.get('id', '')).strip(): str(entry.get('summary', '')).strip().strip('\x22')
                    for entry in parsed_items
                }
                for paper in batch:
                    summary = by_id.get(paper['id'])
                    if summary and 6 <= len(summary.split()) <= 40:
                        paper['micro'] = clean_tex(summary)
                        paper['micro_src'] = 'llm'
                        completed += 1
                break
            except Exception as err:
                status = getattr(err, 'status_code', None)
                wait_seconds = 20 * (attempt + 1) if status == 429 else 4
                batch_num = start // LLM_BATCH
                log(f'  LLM batch {batch_num} failed ({status or type(err).__name__}); retry in {wait_seconds}s')
                if status in (401, 403):
                    log('  LLM credentials rejected; using heuristic summaries')
                    return
                time.sleep(wait_seconds)
        time.sleep(4.5)

    log(f'  {completed}/{len(pending)} micro-summaries written by {LLM_MODEL}')


def load_previous_feed(path):
    try:
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        papers = data['papers'] if isinstance(data, dict) else data
        return {paper['id']: paper for paper in papers}
    except Exception:
        return {}


def write_github_output(key, value):
    output_file = os.environ.get('GITHUB_OUTPUT')
    if output_file:
        with open(output_file, 'a', encoding='utf-8') as handle:
            handle.write(f'{key}={value}\n')


def main():
    start_time = time.time()
    output_path = os.path.join(OUT_DIR, 'today.json')
    day, items = fetch_rss_announcements()

    kinds = ', '.join(sorted(INCLUDE_TYPES))
    log(f'Announcement {day}: {len(items)} papers ({kinds})')
    if not items:
        log('Nothing announced (weekend or holiday); keeping the existing feed.')
        write_github_output('updated', 'false')
        return

    type_priority = {'new': 0, 'cross': 1, 'replace': 2, 'replace-cross': 3}
    items.sort(key=lambda paper: type_priority.get(paper['type'], 9))
    items = items[:MAX_POOL]

    enrich_from_arxiv_api(items)
    for paper in items:
        paper['code'] = find_code_link(paper)
        paper['title'] = clean_tex(paper['title'])
        paper['abstract'] = clean_tex(paper['abstract'])
        paper['comment'] = clean_tex(paper.get('comment', ''))
        paper['journal'] = clean_tex(paper.get('journal', ''))
        paper['n_authors'] = len(paper['authors'])
        paper['authors'] = paper['authors'][:MAX_AUTHORS]
        has_venue = bool(paper['journal'] or ACCEPTED_RE.search(paper['comment']))
        paper['accepted'] = has_venue

    log('Fetching figures from arXiv HTML…')
    fetch_all_figures(items, day)

    log('Embedding…')
    compute_embeddings(items)

    log('Summarizing…')
    generate_summaries(items, load_previous_feed(output_path))

    exported_keys = [
        'id', 'v', 'type', 'title', 'micro', 'micro_src', 'abstract',
        'authors', 'n_authors', 'cats', 'comment', 'journal', 'doi',
        'accepted', 'code', 'html', 'fig', 'fig_w', 'fig_h', 'caption', 'vec',
    ]
    papers = [
        {key: paper[key] for key in exported_keys if paper.get(key) not in (None, '', [], False)}
        for paper in items
    ]
    document = {
        'date': day,
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'feed': FEED,
        'count': len(papers),
        'papers': papers,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    temp_path = output_path + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as handle:
        json.dump(document, handle, ensure_ascii=False, separators=(',', ':'))
    os.replace(temp_path, output_path)

    prune_old_figures(day)
    write_github_output('updated', 'true')

    size_kb = os.path.getsize(output_path) / 1024
    elapsed = time.time() - start_time
    log(f'Wrote {output_path} ({size_kb:.0f} KB, {len(papers)} papers) in {elapsed:.0f}s')


if __name__ == '__main__':
    try:
        main()
    except requests.RequestException as err:
        log(f'Network failure: {err}')
        sys.exit(1)
