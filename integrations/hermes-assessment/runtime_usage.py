"""Read cumulative usage from Relay's dedicated Hermes ledger without modifying it.

No credentials, conversations, reporter identity or external requests are read.
The table is cumulative per session/model: never sum repeated polling snapshots.
"""
import datetime as dt
import json
import math
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens')
MAX_INTEGER = 9_007_199_254_740_991


def read_usage(home):
    db = home / 'state.db'
    if not db.exists():
        return {'available': False, 'reason': 'No usage ledger yet. Complete a request with the Relay Hermes runtime.'}
    if db.is_symlink():
        raise ValueError('Unsupported ledger location.')
    with sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True, timeout=1) as connection:
        connection.execute('PRAGMA query_only=ON')
        columns = {r[1] for r in connection.execute('PRAGMA table_info(session_model_usage)')}
        if not {'model', *FIELDS}.issubset(columns):
            raise ValueError('This Hermes version does not expose the supported usage ledger.')
        optional = ['api_call_count', 'last_seen']
        selection = ['model', *FIELDS] + [c if c in columns else 'NULL' for c in optional]
        rows = connection.execute('SELECT ' + ','.join(selection) + ' FROM session_model_usage LIMIT 100001').fetchall()
    if len(rows) > 100000:
        raise ValueError('Usage ledger exceeds the local reader limit.')
    models = {}
    last_seen = None
    for model, *values in rows:
        counts, calls, observed = values[:4], values[4], values[5]
        if any(type(n) is not int or not 0 <= n <= MAX_INTEGER for n in counts):
            raise ValueError('Usage ledger contains incomplete or invalid token counters.')
        if calls is not None and (type(calls) is not int or not 0 <= calls <= MAX_INTEGER):
            raise ValueError('Usage ledger contains invalid request counters.')
        if not isinstance(model, str) or not model.strip() or len(model) > 160 or any(ord(c) < 32 for c in model):
            raise ValueError('Usage ledger contains an invalid model label.')
        item = models.setdefault(model, {'model': model, **dict.fromkeys(FIELDS, 0), 'model_calls': 0 if 'api_call_count' in columns else None})
        for field, n in zip(FIELDS, counts):
            item[field] += n
        if calls is None:
            item['model_calls'] = None
        elif item['model_calls'] is not None:
            item['model_calls'] += calls
        if isinstance(observed, (float, int)) and math.isfinite(observed) and 0 < observed < 253402300800:
            last_seen = max(last_seen or observed, observed)
    if len(models) > 200:
        raise ValueError('Too many model groups to display safely.')
    totals = {field: sum(m[field] for m in models.values()) for field in FIELDS}
    calls = [m['model_calls'] for m in models.values()]
    totals['model_calls'] = sum(calls) if calls and all(n is not None for n in calls) else None
    for item in [totals, *models.values()]:
        item['total_tokens'] = sum(item[f] for f in FIELDS)
        if any(n is not None and n > MAX_INTEGER for k, n in item.items() if k != 'model'):
            raise ValueError('Usage total exceeds the display range.')
    return {
        'available': True, 'source': 'hermes_session_model_usage', 'scope': 'dedicated_runtime_all_time',
        'observed_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'last_activity_at': dt.datetime.fromtimestamp(last_seen, dt.timezone.utc).isoformat() if last_seen else None,
        'totals': totals, 'models': sorted(models.values(), key=lambda m: m['model']),
        # Hermes may store default zero cost even when cost_status is unknown.
        'cost_usd': None,
    }


if __name__ == '__main__':
    try:
        print(json.dumps(read_usage(ROOT / '.data/hermes-assessment')))
    except (OSError, ValueError, sqlite3.Error):
        print(json.dumps({'available': False, 'reason': 'Runtime usage could not be read. Check the dedicated Hermes ledger and retry.'}))
